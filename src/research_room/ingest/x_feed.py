"""X news feed: injury, availability and lineup news -> status events for the overrides.

Inputs: config/x_accounts.yaml (verified handles, team, tier), today's games, X API v2 recent search
(X_BEARER_TOKEN), a small Anthropic model (LLM_API_KEY), settings.x_feed.
Outputs: status_events rows {player, team, status, minutes_cap, starting, out_days_min/max (a stated
time frame, in days from the post), confidence, account, authority_rank, ts, game_id, game_date,
game_basis}; x_feed_log (posts read per query, for the daily budget and to read only newer posts
next time). Tables: writes status_events, x_feed_log, player_xref, unresolved_names; reads
games, teams, players.

How it reads (pay-per-use, so every read counts against settings.x_feed.daily_read_budget):
- On days when a game is today or tomorrow (pre-game polls and the nightly run). Accounts
  watched: league and insider and aggregator accounts, plus the official and beat accounts of
  teams playing today or tomorrow. Verified handles only (failed lookups are skipped).
- Handles are batched into `from:` recent-search queries (no retweets). Each query reads from
  the earliest point its accounts were last read completely (x_feed_cursor, less a small
  overlap for late-indexed posts; at most catchup_hours back), following result pages, the
  least recently read query first. Post ids already read (x_feed_seen) are not parsed again.
- Reads are logged as soon as a page arrives (the budget is a hard cap even if parsing fails);
  an account's cursor moves only once its query was read to the end and its posts parsed and
  stored, so nothing between polls is skipped (round-3 audit X01-X03).
How it parses (build prompt): posts that mention availability words go to a small model with a
forced tool, so the reply is always the fixed schema, a few posts per call; a reply cut off at
the output limit is split and retried, never dropped (audit X15). Each post carries the next
seven dates by weekday, so the model doesn't count weekdays. Every event is checked before use
(names, limits, days, confidence; X13, X14). The raw text is discarded after parsing and never
stored. Status values are the overrides' own (Out ... Available). Unmatched
player names are quarantined, never guessed. Authority: official 1, insider 2, beat 3, aggregator 4.
Which game (audit B10): a status is about one game, not the day it was posted. The model gives the
game's date only when the post says it ("tomorrow", "Friday", a date), from the post's Eastern
time; the code then ties the status to his team's game that day after the post (`game_basis`
stated), or to his team's next game after the post (`next_game`), so a late-night post about the
next game never lands on tonight's. No team or no game after the post: no game (the overrides then
date it by the post, as before).
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime, timedelta
from typing import Protocol

import duckdb
import pandas as pd
import yaml

from research_room import store
from research_room.config import CONFIG_DIR, Secrets, Settings, settings
from research_room.ingest.market_common import ET, RateLimited
from research_room.ingest.names import load_team_aliases, resolve_and_record

SOURCE = "x"
RANK = {"official": 1, "insider": 2, "beat": 3, "aggregator": 4}
STATUSES = ["Out For Season", "Out", "Doubtful", "Questionable", "Day-To-Day", "Probable", "Available"]
# Availability words: a post without one never reaches the model. Wide on purpose (audit X04:
# "will sit", "day-to-day" and "good to go" were dropped); the model drops what isn't news.
NEWS = re.compile(
    r"\b(out|questionable|probable|doubtful|available|unavailable|starting|start|starts|lineup|"
    r"minutes|injur\w*|sidelined|sprain\w*|strain\w*|sore\w*|illness|sick|rest\w*|return\w*|"
    r"ruled|game[- ]time|gtd|dtd|day[- ]to[- ]day|dnp|inactive|sit|sits|sitting|miss|misses|"
    r"missing|suit\w* up|good to go|will play|won['\u2019]?t play|not play|cleared|upgraded|"
    r"downgraded|listed|status|expected to play|not expected|load management|restriction|"
    r"limit\w*|surgery|fracture|concussion|protocol|week[- ]to[- ]week|re-?evaluated)\b",
    re.IGNORECASE,
)
TOOL = {
    "name": "record_statuses",
    "description": "Record each NBA player availability or lineup status stated in the posts.",
    "input_schema": {
        "type": "object",
        "properties": {
            "events": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "post_id": {"type": "string"},
                        "player": {"type": "string", "description": "Full player name as written"},
                        "team": {
                            "type": ["string", "null"],
                            "description": "Team abbreviation if stated or obvious",
                        },
                        "status": {"type": "string", "enum": STATUSES},
                        "minutes_cap": {"type": ["number", "null"]},
                        "starting": {"type": ["boolean", "null"]},
                        "out_days_min": {
                            "type": ["number", "null"],
                            "description": "When the post says how long he'll be out: the fewest days "
                            "from the post ('2-3 weeks' -> 14, 'at least a week' -> 7, 're-evaluated "
                            "in two weeks' -> 14). Null when no time frame is stated.",
                        },
                        "out_days_max": {
                            "type": ["number", "null"],
                            "description": "The most days from the post ('2-3 weeks' -> 21). Null when "
                            "only a minimum or no time frame is stated.",
                        },
                        "game_date": {
                            "type": ["string", "null"],
                            "description": "YYYY-MM-DD of the game the status is for, only when the "
                            "post says which ('tonight' -> the post's Eastern date, 'tomorrow' -> the "
                            "next day, 'Friday' -> that date). Null when the post doesn't say.",
                        },
                        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    },
                    "required": ["post_id", "player", "status", "confidence"],
                },
            }
        },
        "required": ["events"],
    },
}
SYSTEM = (
    "You extract NBA player availability from posts by team accounts and reporters. Record only "
    "statuses the post states as fact for an upcoming game (ruled out, questionable, available, "
    "starting, a minutes limit). When the post gives a time frame for an absence, record it in days; "
    "never infer one that isn't stated. 'Re-evaluated in N days' is a minimum: out_days_min N, "
    "out_days_max null. When the post says which game (tonight, tomorrow, a weekday, a date), give "
    "its date: read relative words from the post's Eastern time (at_et) and take weekday dates from "
    "dates_ahead; otherwise leave it null. An injury during a game in progress ('will not return', "
    "'out for the rest of tonight's game') is not a status for any upcoming game: record nothing for "
    "it. Ignore rumors, opinions, trades, stats and highlights. One event per player per post. If a "
    "post states nothing usable, record nothing for it."
)


class Parser(Protocol):
    def parse(self, posts: list[dict]) -> list[dict]: ...


def _dates_ahead(at_et: pd.Timestamp) -> str:
    d = at_et.date()
    return ", ".join(f"{(d + timedelta(days=k)):%A} {(d + timedelta(days=k)).isoformat()}" for k in range(8))


class LlmParser:
    """Forced-tool calls over small batches of posts (anthropic SDK; LLM_API_KEY). A reply cut
    off at the output limit is split in half and retried down to a single post; a post that
    still can't be parsed is listed in `failed` (and its read stays logged)."""

    def __init__(self, cfg: Settings | None = None, client=None) -> None:
        self.cfg = cfg or settings()
        if client is None:
            import anthropic

            client = anthropic.Anthropic(api_key=Secrets().require("llm_api_key"))
        self.client = client
        self.failed: list[str] = []
        self.calls = 0

    def _call(self, posts: list[dict]) -> list[dict]:
        batch = [
            {
                "post_id": p["id"],
                "account": p["handle"],
                "at": p["created_at"],
                "at_et": p["at_et"],
                "dates_ahead": p["dates_ahead"],
                "text": p["text"],
            }
            for p in posts
        ]
        self.calls += 1
        msg = self.client.messages.create(
            model=self.cfg.x_feed.llm_model,
            max_tokens=self.cfg.x_feed.llm_max_tokens,
            system=SYSTEM,
            tools=[TOOL],
            tool_choice={"type": "tool", "name": "record_statuses"},
            messages=[{"role": "user", "content": json.dumps(batch)}],
        )
        if getattr(msg, "stop_reason", None) == "max_tokens":  # cut off: the events are incomplete
            if len(posts) == 1:
                self.failed.append(posts[0]["id"])
                return []
            half = len(posts) // 2
            return self._call(posts[:half]) + self._call(posts[half:])
        out = []
        for block in msg.content:
            if getattr(block, "type", None) == "tool_use":
                out += list((block.input or {}).get("events", []))
        return out

    def parse(self, posts: list[dict]) -> list[dict]:
        n = self.cfg.x_feed.max_posts_per_llm_call
        out = []
        for i in range(0, len(posts), n):
            out += self._call(posts[i : i + n])
        return out


def _days(v) -> float | None:
    """A stated time frame in days, or None (not a positive number)."""
    try:
        d = float(v)
    except (TypeError, ValueError):
        return None
    return d if d > 0 else None


def _date(v) -> date | None:
    try:
        return date.fromisoformat(str(v)[:10]) if v else None
    except ValueError:
        return None


NAME = re.compile(r"^[A-Za-z\u00C0-\u024F.'\- ]{2,60}$")


def valid_event(e: dict, cfg: Settings) -> str | None:
    """Why the model's event can't be used, or None. A name must look like a name (never a whole
    post: audit X13); limits and days must be possible (X14); low confidence is not used."""
    name = e.get("player")
    if not isinstance(name, str) or not NAME.match(name.strip()) or len(name.split()) > 5:
        return "not a name"
    if e.get("status") not in STATUSES:
        return "unknown status"
    cap = e.get("minutes_cap")
    if cap is not None:
        try:
            if not 0 < float(cap) <= 48:
                return "impossible minutes limit"
        except (TypeError, ValueError):
            return "impossible minutes limit"
    for k in ("out_days_min", "out_days_max"):
        v = e.get(k)
        if v is not None and (_days(v) is None or _days(v) > 400):
            return f"impossible {k}"
    lo, hi = _days(e.get("out_days_min")), _days(e.get("out_days_max"))
    if lo and hi and hi < lo:
        return "time frame ends before it starts"
    try:
        conf = float(e.get("confidence"))
    except (TypeError, ValueError):
        return "no confidence"
    if not 0 <= conf <= 1:
        return "no confidence"
    if conf < cfg.x_feed.min_confidence:
        return "low confidence"
    return None


def target_games(con: duckdb.DuckDBPyConnection, ev: pd.DataFrame) -> pd.DataFrame:
    """For each event (team_id, ts, stated_date): the game it is about. With a stated date, his
    team's game that day after the post, or nothing (`unmatched`, never acted on: audit X05; a
    post after tonight's tip about tonight lands here). Without one, his team's next game after
    the post. Columns game_id, game_date, game_basis (None when there is no team or no later
    game; `unmatched` keeps the stated date for diagnosis)."""
    out = pd.DataFrame({"game_id": None, "game_date": None, "game_basis": None}, index=ev.index, dtype=object)
    teams = [int(t) for t in ev["team_id"].dropna().unique()]
    if not teams:
        return out
    g = con.execute(
        f"""SELECT game_id, game_date, tip_utc, home_team_id, visitor_team_id FROM games
            WHERE (home_team_id IN ({",".join("?" * len(teams))}) OR visitor_team_id IN
                   ({",".join("?" * len(teams))}))
              AND tip_utc IS NOT NULL AND NOT coalesce(postponed, false) ORDER BY tip_utc""",
        [*teams, *teams],
    ).df()
    for i, r in ev.iterrows():
        if pd.isna(r["team_id"]):
            continue
        t = int(r["team_id"])
        later = g[((g["home_team_id"] == t) | (g["visitor_team_id"] == t)) & (g["tip_utc"] > r["ts"])]
        stated = r["stated_date"] if pd.notna(r["stated_date"]) else None
        if stated:
            on = later[pd.to_datetime(later["game_date"]).dt.date == stated]
            out.loc[i] = (
                [int(on.iloc[0]["game_id"]), stated, "stated"]
                if not on.empty
                else [None, stated, "unmatched"]
            )
        elif not later.empty:
            hit = later.iloc[0]
            out.loc[i] = [int(hit["game_id"]), pd.Timestamp(hit["game_date"]).date(), "next_game"]
    return out


def load_accounts(path=None) -> pd.DataFrame:
    raw = yaml.safe_load((path or CONFIG_DIR / "x_accounts.yaml").read_text()) or {}
    df = pd.DataFrame(raw.get("accounts") or [])
    if df.empty:
        return pd.DataFrame(columns=["handle", "user_id", "team", "tier"])
    df = df[df.get("verified", False).fillna(False).astype(bool)]
    return df.drop_duplicates("handle")[["handle", "user_id", "team", "tier"]].reset_index(drop=True)


def watch_list(accounts: pd.DataFrame, teams_playing: set[str]) -> pd.DataFrame:
    """League-wide accounts always; team accounts (official, beat) only for the teams given
    (playing today or tomorrow: news about tomorrow is often posted the day before; audit X03)."""
    league = accounts["team"].isna() | accounts["tier"].isin(["insider", "aggregator"])
    return accounts[league | accounts["team"].isin(teams_playing)].reset_index(drop=True)


def queries(handles: list[str], max_chars: int) -> list[str]:
    """`(from:a OR from:b ...) -is:retweet` strings, each within X's length limit."""
    tail, out, cur = " -is:retweet", [], []
    for h in handles:
        trial = "(" + " OR ".join(f"from:{x}" for x in [*cur, h]) + ")" + tail
        if cur and len(trial) > max_chars:
            out.append("(" + " OR ".join(f"from:{x}" for x in cur) + ")" + tail)
            cur = [h]
        else:
            cur.append(h)
    if cur:
        out.append("(" + " OR ".join(f"from:{x}" for x in cur) + ")" + tail)
    return out


def _key(q: str) -> str:
    return hashlib.sha1(q.encode()).hexdigest()[:16]


def budget_left(con: duckdb.DuckDBPyConnection, day: date, cfg: Settings) -> int:
    used = con.execute("SELECT coalesce(sum(posts_read), 0) FROM x_feed_log WHERE day = ?", [day]).fetchone()[
        0
    ]
    return max(0, cfg.x_feed.daily_read_budget - int(used))


def _log_read(con, now, key: str, page: int, day: date, n: int, newest) -> None:
    """Count a page's reads the moment it arrives (audit X01), before anything can fail."""
    store.upsert(
        con,
        "x_feed_log",
        pd.DataFrame(
            [
                {
                    "poll_at": now,
                    "query_key": f"{key}:{page}",
                    "day": day,
                    "posts_read": n,
                    "newest_at": newest,
                    "events": 0,
                }
            ]
        ),
    )


def teams_playing(con: duckdb.DuckDBPyConnection, day: date) -> set[str]:
    rows = con.execute(
        """
        SELECT t.abbreviation FROM games g JOIN teams t ON t.team_id IN (g.home_team_id, g.visitor_team_id)
        WHERE g.game_date = ? AND NOT coalesce(g.postseason, false)
    """,
        [day],
    ).fetchall()
    return {r[0] for r in rows}


def poll(
    con: duckdb.DuckDBPyConnection,
    cfg: Settings | None = None,
    client: RateLimited | None = None,
    parser: Parser | None = None,
    now: datetime | None = None,
) -> dict:
    """One poll. Returns counts; does nothing without a game today or tomorrow, or without budget.
    Raises when parsing or storing fails: the reads stay counted and no cursor moves, so the next
    poll reads the same posts again."""
    cfg = cfg or settings()
    xf = cfg.x_feed
    now = pd.Timestamp(now or store.utcnow())
    day = now.tz_convert(ET).date()
    playing = teams_playing(con, day) | teams_playing(con, day + timedelta(days=1))
    if not playing:
        return {"status": "skipped", "reason": "no games today or tomorrow"}
    left = budget_left(con, day, cfg)
    if left < 10:
        return {"status": "skipped", "reason": f"daily read budget ({xf.daily_read_budget}) used"}
    accounts = watch_list(load_accounts(), playing)
    handle_tier = dict(zip(accounts["handle"].str.lower(), accounts["tier"], strict=True))
    client = client or RateLimited(
        1.0, headers={"Authorization": f"Bearer {Secrets().require('x_bearer_token')}"}
    )
    cursor = {
        h.lower(): pd.Timestamp(t)
        for h, t in con.execute("SELECT handle, read_through FROM x_feed_cursor").fetchall()
    }
    floor = now - timedelta(hours=xf.catchup_hours)

    def since(q_handles: list[str]) -> pd.Timestamp:
        marks = [cursor.get(h.lower()) for h in q_handles]
        if any(m is None for m in marks):
            return floor
        return max(floor, min(marks) - timedelta(minutes=xf.overlap_minutes))

    batches = [
        (q, [h for h in accounts["handle"] if f"from:{h}" in q])
        for q in queries(accounts["handle"].tolist(), xf.max_query_chars)
    ]
    batches.sort(key=lambda b: since(b[1]))  # least recently read first (audit X02)
    posts, complete, reads, incomplete = [], [], 0, 0
    for q, hs in batches:
        if left < 10:  # X reads at least 10 per search; the cap is hard
            incomplete += 1
            continue
        start, token, pages = since(hs), None, 0
        while True:
            params = {
                "query": q,
                "max_results": max(10, min(100, left)),
                "start_time": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "tweet.fields": "created_at,author_id",
                "expansions": "author_id",
                "user.fields": "username",
            }
            if token:
                params["next_token"] = token
            page = client.get(f"{xf.base_url}/tweets/search/recent", params)
            got = page.get("data") or []
            users = {u["id"]: u["username"] for u in (page.get("includes") or {}).get("users", [])}
            left -= len(got)
            reads += len(got)
            pages += 1
            _log_read(
                con,
                now,
                _key(q),
                pages,
                day,
                len(got),
                max((pd.Timestamp(p["created_at"]) for p in got), default=None),
            )
            for p in got:
                at = pd.Timestamp(p["created_at"]).tz_convert(ET)
                posts.append(
                    {
                        "id": str(p["id"]),
                        "handle": users.get(p.get("author_id"), ""),
                        "created_at": p["created_at"],
                        "at_et": at.strftime("%A %Y-%m-%d %H:%M ET"),
                        "dates_ahead": _dates_ahead(at),
                        "text": p.get("text", ""),
                    }
                )
            token = (page.get("meta") or {}).get("next_token")
            if not token:
                complete += hs
                break
            if left < 10 or pages >= xf.max_pages_per_query:
                incomplete += 1  # the rest waits: this query's cursor stays put
                break
    ids = [p["id"] for p in posts]
    seen = (
        {
            r[0]
            for r in con.execute(
                f"SELECT post_id FROM x_feed_seen WHERE post_id IN ({','.join('?' * len(ids))})", ids
            ).fetchall()
        }
        if ids
        else set()
    )
    fresh = [p for p in {p["id"]: p for p in posts}.values() if p["id"] not in seen]
    news = [p for p in fresh if NEWS.search(p["text"] or "")]
    parser = parser or LlmParser(cfg)
    events = parser.parse(news) if news else []
    failed = list(getattr(parser, "failed", []))
    for p in posts:
        p["text"] = None  # parsed or not, the raw text is not kept
    by_id = {p["id"]: p for p in fresh}
    rows, rejected = [], {}
    aliases = load_team_aliases()
    for e in events:
        post = by_id.get(str(e.get("post_id")))
        why = "unknown post" if post is None else valid_event(e, cfg)
        if why:
            rejected[why] = rejected.get(why, 0) + 1
            continue
        team = e.get("team")
        rows.append(
            {
                "post_id": post["id"],
                "player": e["player"].strip(),
                "team_abbr": aliases.get(team, team) if team else None,
                "status": e["status"],
                "minutes_cap": float(e["minutes_cap"]) if e.get("minutes_cap") is not None else None,
                "starting": e.get("starting") if isinstance(e.get("starting"), bool) else None,
                "out_days_min": _days(e.get("out_days_min")),
                "out_days_max": _days(e.get("out_days_max")),
                "stated_date": _date(e.get("game_date")),
                "confidence": float(e["confidence"]),
                "account": post["handle"],
                "authority_rank": RANK.get(handle_tier.get(post["handle"].lower(), "aggregator"), 4),
                "ts": pd.Timestamp(post["created_at"]),
            }
        )
    written = _store_events(con, rows, now) if rows else 0
    # Only now, with everything stored: these posts are done, and fully read accounts move on.
    done = [i for i in by_id if i not in set(failed)]
    if done:
        store.upsert(con, "x_feed_seen", pd.DataFrame({"post_id": done, "seen_at": now}))
    con.execute("DELETE FROM x_feed_seen WHERE seen_at < ?", [now - timedelta(days=8)])
    if complete:
        through = now - timedelta(minutes=1)
        store.upsert(
            con,
            "x_feed_cursor",
            pd.DataFrame(
                {"handle": [h.lower() for h in complete], "read_through": through, "updated_at": now}
            ),
        )
    return {
        "status": "ok",
        "posts_read": reads,
        "new_posts": len(fresh),
        "news_posts": len(news),
        "events": written,
        "rejected": rejected,
        "parse_failed": len(failed),
        "llm_calls": getattr(parser, "calls", None),
        "queries_incomplete": incomplete,
        "budget_left": left,
    }


def _store_events(con: duckdb.DuckDBPyConnection, rows: list[dict], now) -> int:
    ev = pd.DataFrame(rows)
    names = (
        pd.DataFrame(
            {
                "source_key": ev["player"] + "|" + ev["team_abbr"].fillna(""),
                "raw_name": ev["player"],
                "team_abbr": ev["team_abbr"],
            }
        )
        .drop_duplicates("source_key")
        .reset_index(drop=True)
    )
    ids = dict(zip(names["source_key"], resolve_and_record(con, SOURCE, names), strict=True))
    ev["player_id"] = (ev["player"] + "|" + ev["team_abbr"].fillna("")).map(ids)
    ev = ev[ev["player_id"].notna()].copy()
    if ev.empty:
        return 0
    team_ids = dict(con.execute("SELECT abbreviation, team_id FROM teams").fetchall())
    current = dict(con.execute("SELECT player_id, team_id FROM players WHERE team_id IS NOT NULL").fetchall())
    ev["event_id"] = ev["post_id"] + ":" + ev["player_id"].astype(int).astype(str)
    ev["player_id"] = ev["player_id"].astype(int)
    ev["team_id"] = ev["team_abbr"].map(team_ids).fillna(ev["player_id"].map(current))
    ev[["game_id", "game_date", "game_basis"]] = target_games(con, ev)
    cols = [
        "event_id",
        "player_id",
        "team_id",
        "status",
        "minutes_cap",
        "starting",
        "out_days_min",
        "out_days_max",
        "confidence",
        "account",
        "authority_rank",
        "ts",
        "game_id",
        "game_date",
        "game_basis",
        "source",
        "fetched_at",
    ]
    return store.upsert(con, "status_events", ev.assign(source=SOURCE, fetched_at=now)[cols])

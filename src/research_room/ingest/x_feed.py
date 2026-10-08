"""X news feed: injury, availability and lineup news -> status events for the overrides.

Inputs: config/x_accounts.yaml (verified handles, team, tier), today's games, X API v2 recent search
(X_BEARER_TOKEN), a small Anthropic model (LLM_API_KEY), settings.x_feed.
Outputs: status_events rows {player, team, status, minutes_cap, starting, out_days_min/max (a stated
time frame, in days from the post), confidence, account, authority_rank, ts, game_id, game_date,
game_basis}; x_feed_log (posts read per query, for the daily budget and to read only newer posts
next time). Tables: writes status_events, x_feed_log, player_xref, unresolved_names; reads
games, teams, players.

How it reads (pay-per-use, so every read counts against settings.x_feed.daily_read_budget):
- Game days only. Accounts watched: league and insider and aggregator accounts, plus the official
  and beat accounts of teams playing today. Verified handles only (failed lookups are skipped).
- Handles are batched into `from:` recent-search queries (no retweets), each reading only posts
  newer than the last poll of the same query (at most lookback_minutes back on the first).
- The app-only token can't build a private X list on the owner's account, so search replaces the
  list the account file mentions; the budget is the same.
How it parses (build prompt): posts that mention availability words go to one small-model call
with a forced tool, so the reply is always the fixed schema; the raw text is discarded after
parsing and never stored. Status values are the overrides' own (Out ... Available). Unmatched
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
NEWS = re.compile(
    r"\b(out|questionable|probable|doubtful|available|starting|start|starts|lineup|minutes|"
    r"injur\w*|sidelined|sprain\w*|strain\w*|soreness|illness|rest\w*|return\w*|ruled|"
    r"game[- ]time|gtd|dnp|inactive|will play|won't play|not play|cleared|upgraded|downgraded)\b",
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
    "statuses the post states as fact for the player's next game (ruled out, questionable, "
    "available, starting, a minutes limit). When the post gives a time frame for an absence, record it "
    "in days; never infer one that isn't stated. When the post says which game (tonight, tomorrow, a "
    "weekday, a date), give its date, reading relative words from the post's Eastern time (at_et); "
    "otherwise leave it null. Ignore rumors, opinions, trades, stats and highlights. "
    "One event per player per post. If a post states nothing usable, record nothing for it."
)


class Parser(Protocol):
    def parse(self, posts: list[dict]) -> list[dict]: ...


class LlmParser:
    """One forced-tool call per batch of posts (anthropic SDK; LLM_API_KEY)."""

    def __init__(self, cfg: Settings | None = None) -> None:
        import anthropic

        self.cfg = cfg or settings()
        self.client = anthropic.Anthropic(api_key=Secrets().require("llm_api_key"))

    def parse(self, posts: list[dict]) -> list[dict]:
        out = []
        n = self.cfg.x_feed.max_posts_per_llm_call
        for i in range(0, len(posts), n):
            batch = [
                {"post_id": p["id"], "account": p["handle"], "at": p["created_at"], "at_et": p["at_et"],
                 "text": p["text"]}
                for p in posts[i : i + n]
            ]
            msg = self.client.messages.create(
                model=self.cfg.x_feed.llm_model,
                max_tokens=2000,
                system=SYSTEM,
                tools=[TOOL],
                tool_choice={"type": "tool", "name": "record_statuses"},
                messages=[{"role": "user", "content": json.dumps(batch)}],
            )
            for block in msg.content:
                if getattr(block, "type", None) == "tool_use":
                    out += list((block.input or {}).get("events", []))
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


def target_games(con: duckdb.DuckDBPyConnection, ev: pd.DataFrame) -> pd.DataFrame:
    """For each event (team_id, ts, stated_date): the game it is about. His team's game on the
    stated date after the post, else his team's next game after the post; columns game_id,
    game_date, game_basis (None when there is no team or no later game)."""
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
        if later.empty:
            continue
        days = pd.to_datetime(later["game_date"]).dt.date
        on = later[days == r["stated_date"]] if r["stated_date"] else later.iloc[:0]
        hit, basis = (on.iloc[0], "stated") if not on.empty else (later.iloc[0], "next_game")
        out.loc[i] = [int(hit["game_id"]), pd.Timestamp(hit["game_date"]).date(), basis]
    return out


def load_accounts(path=None) -> pd.DataFrame:
    raw = yaml.safe_load((path or CONFIG_DIR / "x_accounts.yaml").read_text()) or {}
    df = pd.DataFrame(raw.get("accounts") or [])
    if df.empty:
        return pd.DataFrame(columns=["handle", "user_id", "team", "tier"])
    df = df[df.get("verified", False).fillna(False).astype(bool)]
    return df.drop_duplicates("handle")[["handle", "user_id", "team", "tier"]].reset_index(drop=True)


def watch_list(accounts: pd.DataFrame, teams_playing: set[str]) -> pd.DataFrame:
    """League-wide accounts always; team accounts (official, beat) only for teams playing today."""
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
    """One pre-game poll. Returns counts; does nothing on a day without games or without budget."""
    cfg = cfg or settings()
    xf = cfg.x_feed
    now = pd.Timestamp(now or store.utcnow())
    day = now.tz_convert(ET).date()
    playing = teams_playing(con, day)
    if not playing:
        return {"status": "skipped", "reason": "no games today"}
    left = budget_left(con, day, cfg)
    if left <= 0:
        return {"status": "skipped", "reason": f"daily read budget ({xf.daily_read_budget}) used"}
    accounts = watch_list(load_accounts(), playing)
    handle_tier = dict(zip(accounts["handle"].str.lower(), accounts["tier"], strict=True))
    client = client or RateLimited(
        1.0, headers={"Authorization": f"Bearer {Secrets().require('x_bearer_token')}"}
    )
    posts, logs = [], []
    for q in queries(accounts["handle"].tolist(), xf.max_query_chars):
        if left < 10:                                      # X reads at least 10 per search; keep the cap hard
            break
        last = con.execute("SELECT max(newest_at) FROM x_feed_log WHERE query_key = ?", [_key(q)]).fetchone()[
            0
        ]
        start = now - timedelta(minutes=xf.lookback_minutes)
        if last is not None:  # only posts newer than this query's last read
            start = max(start, pd.Timestamp(last) + timedelta(seconds=1))
        params = {
            "query": q,
            "max_results": max(10, min(100, left)),
            "start_time": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "tweet.fields": "created_at,author_id",
            "expansions": "author_id",
            "user.fields": "username",
        }
        page = client.get(f"{xf.base_url}/tweets/search/recent", params)
        users = {u["id"]: u["username"] for u in (page.get("includes") or {}).get("users", [])}
        got = page.get("data") or []
        left -= len(got)
        newest = max((pd.Timestamp(p["created_at"]) for p in got), default=None)
        logs.append(
            {
                "poll_at": now,
                "query_key": _key(q),
                "day": day,
                "posts_read": len(got),
                "newest_at": newest if newest is not None else last,
                "events": 0,
            }
        )
        for p in got:
            posts.append(
                {
                    "id": p["id"],
                    "handle": users.get(p.get("author_id"), ""),
                    "created_at": p["created_at"],
                    "at_et": pd.Timestamp(p["created_at"]).tz_convert(ET).strftime("%A %Y-%m-%d %H:%M ET"),
                    "text": p.get("text", ""),
                }
            )
    news = [p for p in posts if NEWS.search(p["text"])]
    events = (parser or LlmParser(cfg)).parse(news) if news else []
    for p in posts:
        p["text"] = None  # parsed or not, the raw text is not kept
    by_id = {p["id"]: p for p in posts}
    rows = []
    aliases = load_team_aliases()
    for e in events:
        post = by_id.get(str(e.get("post_id")))
        if post is None or e.get("status") not in STATUSES or not e.get("player"):
            continue
        team = e.get("team")
        rows.append(
            {
                "post_id": post["id"],
                "player": e["player"],
                "team_abbr": aliases.get(team, team) if team else None,
                "status": e["status"],
                "minutes_cap": e.get("minutes_cap"),
                "starting": e.get("starting"),
                "out_days_min": _days(e.get("out_days_min")),
                "out_days_max": _days(e.get("out_days_max")),
                "stated_date": _date(e.get("game_date")),
                "confidence": float(e.get("confidence") or 0),
                "account": post["handle"],
                "authority_rank": RANK.get(handle_tier.get(post["handle"].lower(), "aggregator"), 4),
                "ts": pd.Timestamp(post["created_at"]),
            }
        )
    written = 0
    if rows:
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
        if not ev.empty:
            team_ids = dict(con.execute("SELECT abbreviation, team_id FROM teams").fetchall())
            current = dict(
                con.execute("SELECT player_id, team_id FROM players WHERE team_id IS NOT NULL").fetchall()
            )
            ev["event_id"] = ev["post_id"] + ":" + ev["player_id"].astype(int).astype(str)
            ev["player_id"] = ev["player_id"].astype(int)
            ev["team_id"] = ev["team_abbr"].map(team_ids).fillna(ev["player_id"].map(current))
            ev[["game_id", "game_date", "game_basis"]] = target_games(con, ev)
            written = store.upsert(
                con,
                "status_events",
                ev.assign(source=SOURCE, fetched_at=now)[
                    [
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
                ],
            )
    if logs:
        logs[-1]["events"] = written
        store.upsert(con, "x_feed_log", pd.DataFrame(logs))
    return {
        "status": "ok",
        "posts_read": len(posts),
        "news_posts": len(news),
        "events": written,
        "budget_left": left,
        "queries": len(logs),
    }

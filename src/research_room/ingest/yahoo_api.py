"""Yahoo Fantasy API, read only: the same snapshots as the CSV inbox, plus the league's facts.

Inputs: oauth2.json (the app's key and secret, plus tokens after `make yahoo-auth`; gitignored),
the yahoo_fantasy_api library, settings (league id, categories with their Yahoo stat ids).
Outputs: `ApiBackend`, a drop-in for ingest/yahoo.py's CsvBackend (teams, roster, players, matchup,
draft_results: the same columns, validated by the same code), and `league_facts` / `compare`, which
read the league's own settings (draft rounds, keepers, roster, categories, week dates, draft order)
and set them beside config/settings.yaml. Tables: none directly (ingest_inbox stores the frames).

Read only, by construction: the library can add, drop, move players and trade. Every call goes
through `ReadOnly`, which allows a fixed list of read methods and raises `YahooWriteBlocked` for
anything else, so no code path can act inside Yahoo (build prompt; tests/test_yahoo_api.py).

Response shapes: written against yahoo_fantasy_api 2.12.3's parsed outputs (teams(), roster(),
free_agents(), player_details(), draft_results(), settings(), week_date_range()) and Yahoo's raw
scoreboard JSON for matchups(). Not yet checked against a live league (API access pending): the
first `make yahoo-check` run is that check.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

import pandas as pd

from research_room import schedule
from research_room.config import REPO_ROOT, Settings, settings
from research_room.ingest.yahoo import SCHEMAS, validate

READ_LEAGUE = frozenset(
    {
        "settings",
        "teams",
        "stat_categories",
        "positions",
        "current_week",
        "end_week",
        "week_date_range",
        "matchups",
        "free_agents",
        "taken_players",
        "draft_results",
        "player_details",
        "percent_owned",
        "ownership",
        "standings",
        "team_key",
        "transactions",
        "waivers",
    }
)
READ_TEAM = frozenset({"roster", "details", "matchup"})
POSITIONS = ("PG", "SG", "SF", "PF", "C")  # free-agent queries, one per base position
DETAIL_BATCH = 25  # player_details ids per call


THROTTLED = ("999", "429", "too many requests", "request denied", "rate limit", "temporarily unavailable")
BACKOFF_S = (2, 4, 8, 16)   # exponential backoff when Yahoo throttles


def _with_backoff(fn, sleep=None):
    """Retry a read when Yahoo throttles it, waiting 2, 4, 8, 16 s; any other error raises at once,
    and the last throttled attempt raises too. Never more than five calls for one read."""
    import time

    sleep = sleep or time.sleep

    def call(*a, **k):
        for wait in (*BACKOFF_S, None):
            try:
                return fn(*a, **k)
            except Exception as exc:  # noqa: BLE001 - only throttling is retried
                if wait is None or not any(t in str(exc).lower() for t in THROTTLED):
                    raise
                sleep(wait)
        return None

    return call


class YahooWriteBlocked(RuntimeError):
    """Something tried to act inside Yahoo. This app only reads."""


class ReadOnly:
    """Wraps a yahoo_fantasy_api League or Team: only the listed read methods get through."""

    def __init__(self, inner: Any, allowed: frozenset[str]) -> None:
        object.__setattr__(self, "_inner", inner)
        object.__setattr__(self, "_allowed", allowed)

    def __getattr__(self, name: str) -> Any:
        if name not in self._allowed and name != "to_team":
            raise YahooWriteBlocked(f"'{name}' is not a read call; this app never acts inside Yahoo")
        if name == "to_team":
            return lambda key: ReadOnly(self._inner.to_team(key), READ_TEAM)
        attr = getattr(self._inner, name)
        return _with_backoff(attr) if callable(attr) else attr

    def __setattr__(self, name: str, value: Any) -> None:
        raise YahooWriteBlocked("the Yahoo client is read only")


def connect(cfg: Settings | None = None) -> tuple[ReadOnly, str]:
    """(read-only league, game key) for settings.league.league_id this season, from oauth2.json."""
    import yahoo_fantasy_api as yfa
    from yahoo_oauth import OAuth2

    cfg = cfg or settings()
    path = REPO_ROOT / "oauth2.json"
    if not path.exists():
        raise FileNotFoundError("oauth2.json not found: it holds your Yahoo app's key and secret")
    sc = OAuth2(None, None, from_file=str(path))
    if not sc.token_is_valid():
        sc.refresh_access_token()
    game = yfa.Game(sc, "nba")
    keys = [k for k in game.league_ids() if k.endswith(f".l.{cfg.league.league_id}")]
    if not keys:
        raise LookupError(f"league {cfg.league.league_id} isn't among this account's NBA leagues this season")
    key = keys[-1]
    return ReadOnly(game.to_league(key), READ_LEAGUE), key.split(".")[0]


def _team_id(team_key: str) -> int:
    return int(str(team_key).rsplit(".t.", 1)[1])


def _text(v: Any) -> str:
    return "" if v is None or (isinstance(v, float) and pd.isna(v)) else str(v)


def _frame(rows: list[dict], name: str) -> pd.DataFrame:
    """Rows -> the CSV schema's columns as text, then the CSV validation (same rules, same errors)."""
    cols = [c.name for c in SCHEMAS[name]]
    raw = pd.DataFrame([{c: _text(r.get(c)) for c in cols} for r in rows], columns=cols)
    return validate(name, raw)


def _abbr(d: dict | None) -> str | None:
    """Yahoo's NBA team code ("Bos", "NY", "GS"), upper case; aliases.yaml maps it to BallDontLie's."""
    a = (d or {}).get("editorial_team_abbr")
    return str(a).upper() if a else None


def _name(d: dict | None) -> str | None:
    """A player's name from player_details (`{"full": ...}`) or a plain string."""
    n = (d or {}).get("name")
    return n.get("full") if isinstance(n, dict) else n


def _find(obj: Any, key: str):
    """Every value stored under `key` anywhere in Yahoo's nested JSON (lists of dicts of lists)."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == key:
                yield v
            yield from _find(v, key)
    elif isinstance(obj, list):
        for v in obj:
            yield from _find(v, key)


def _merged(team_entry: Any) -> dict:
    """Yahoo's `team` value is a list of small dicts (and lists of them); fold them into one."""
    out: dict = {}

    def walk(x):
        if isinstance(x, dict):
            out.update(x)
        elif isinstance(x, list):
            for y in x:
                walk(y)

    walk(team_entry)
    return out


class ApiBackend:
    """The CSV inbox's interface (available / read), filled from the API. Each snapshot is read
    once per backend; `available` lists the non-empty ones, timed when they were read."""

    def __init__(
        self,
        league: ReadOnly,
        game_key: str,
        cfg: Settings | None = None,
        week: int | None = None,
        now: datetime | None = None,
        team_ids: list[int] | None = None,
    ) -> None:
        self.lg, self.game, self.cfg = league, game_key, cfg or settings()
        self.week, self.now = week, now
        self.team_ids = set(team_ids) if team_ids else None   # rosters of these teams only
        # Each snapshot read once for this one load (one job or page); never kept beyond it.
        self._frames: dict[str, pd.DataFrame] = {}
        self._teams: dict | None = None

    # ---------------------------------------------------------------- raw reads
    def teams_raw(self) -> dict:
        if self._teams is None:
            self._teams = self.lg.teams()
        return self._teams

    def details(self, ids: list[int]) -> dict[int, dict]:
        out = {}
        for i in range(0, len(ids), DETAIL_BATCH):
            for d in self.lg.player_details([int(x) for x in ids[i : i + DETAIL_BATCH]]) or []:
                out[int(d.get("player_id"))] = d
        return out

    def _player_key(self, pid: Any) -> str:
        return f"{self.game}.p.{int(pid)}"

    # ---------------------------------------------------------------- snapshots
    def teams(self) -> pd.DataFrame:
        rows = [{"team_id": _team_id(k), "team_name": t.get("name")} for k, t in self.teams_raw().items()]
        return _frame(rows, "teams")

    def roster(self) -> pd.DataFrame:
        rows = []
        for key in self.teams_raw():
            if self.team_ids is not None and _team_id(key) not in self.team_ids:
                continue
            for p in self.lg.to_team(key).roster() or []:
                rows.append(
                    {
                        "team_id": _team_id(key),
                        "player_name": p.get("name"),
                        "selected_slot": p.get("selected_position"),
                        "eligible_positions": ",".join(p.get("eligible_positions") or []),
                        "status": p.get("status") or None,
                        "yahoo_player_key": self._player_key(p["player_id"]),
                    }
                )
        return _frame(rows, "roster")

    def players(self) -> pd.DataFrame:
        seen: dict[int, dict] = {}
        for pos in POSITIONS:
            for p in self.lg.free_agents(pos) or []:
                seen.setdefault(int(p["player_id"]), p)
        det = self.details(list(seen))
        rows = [
            {
                "player_name": p.get("name"),
                "team_abbr": _abbr(det.get(pid)),
                "eligible_positions": ",".join(p.get("eligible_positions") or []),
                "pct_rostered": p.get("percent_owned", 0),
                "status": p.get("status") or None,
                "owner_team_id": None,
                "yahoo_player_key": self._player_key(pid),
            }
            for pid, p in seen.items()
        ]
        rows = [r for r in rows if r["team_abbr"]]  # a free agent without an NBA team can't be matched
        return _frame(rows, "players")

    def matchup(self) -> pd.DataFrame:
        week = self.week or int(self.lg.current_week())
        by_id = {c.yahoo_stat_id: c.key for c in self.cfg.categories if c.yahoo_stat_id is not None}
        adds = {}
        for key, t in self.teams_raw().items():
            ra = t.get("roster_adds") or {}
            if str(ra.get("coverage_value")) == str(week) and ra.get("value") not in (None, ""):
                adds[_team_id(key)] = int(ra["value"])
        rows = []
        for m in _find(self.lg.matchups(week), "matchup"):
            sides = []
            for team in _find(m, "team"):
                info = _merged(team)
                if "team_key" not in info:
                    continue
                stats = {}
                for st in _find(info.get("team_stats", {}), "stat"):
                    sid = int(st.get("stat_id")) if str(st.get("stat_id", "")).isdigit() else None
                    if sid in by_id:
                        stats[by_id[sid]] = st.get("value")
                sides.append((_team_id(info["team_key"]), stats))
            if len(sides) == 2:
                (a, sa), (b, sb) = sides
                for me, opp, s in ((a, b, sa), (b, a, sb)):
                    rows.append(
                        {
                            "week": week,
                            "team_id": me,
                            "opponent_team_id": opp,
                            **{k: (s.get(k) if s.get(k) not in ("-", "") else 0) for k in by_id.values()},
                            "acquisitions_used": adds.get(me),
                        }
                    )
        return _frame(rows, "matchup")

    def draft_results(self) -> pd.DataFrame:
        picks = self.lg.draft_results() or []
        picks = [p for p in picks if p.get("player_id")]
        det = self.details([int(p["player_id"]) for p in picks])
        rows = []
        for p in picks:
            d = det.get(int(p["player_id"]))
            rows.append(
                {
                    "pick_no": p.get("pick"),
                    "round": p.get("round"),
                    "team_id": _team_id(p["team_key"]),
                    "player_name": _name(d),
                    "team_abbr": _abbr(d),
                    "yahoo_player_key": self._player_key(p["player_id"]),
                }
            )
        return _frame([r for r in rows if r["player_name"]], "draft_results")

    # ---------------------------------------------------------------- the inbox interface
    def _get(self, name: str) -> pd.DataFrame:
        if name not in self._frames:
            df = getattr(self, name)()
            df["snapshot_at"] = (self.now or datetime.now(UTC)).replace(microsecond=0)
            self._frames[name] = df
        return self._frames[name]

    def available(self, parts=None) -> dict[str, datetime]:
        """Only the snapshots asked for are read (a page needs a few calls, not the whole league)."""
        out = {}
        for name in parts or SCHEMAS:
            df = self._get(name)
            if not df.empty:
                out[name] = df["snapshot_at"].iloc[0]
        return out

    def read(self, name: str) -> pd.DataFrame:
        return self._get(name)


# -------------------------------------------------------------------- league facts
def league_facts(league: ReadOnly, cfg: Settings | None = None) -> dict:
    """What Yahoo says about the league, in our terms. Missing keys stay None (reported, not guessed)."""
    cfg = cfg or settings()
    s = league.settings() or {}
    roster = []
    for rp in s.get("roster_positions") or []:
        rp = rp.get("roster_position", rp) if isinstance(rp, dict) else rp
        roster += [rp.get("position")] * int(rp.get("count", 1))
    non_il = [p for p in roster if p not in ("IL", "IL+")]
    cats = [
        c.get("display_name") for c in (league.stat_categories() or []) if c.get("position_type", "P") == "P"
    ]
    teams = league.teams() or {}
    order = {int(t["draft_position"]): _team_id(k) for k, t in teams.items() if t.get("draft_position")}
    weeks = []
    start, end = int(s.get("start_week") or 1), int(s.get("end_week") or league.end_week() or 0)
    for w in range(start, end + 1):
        a, b = league.week_date_range(w)
        weeks.append({"week": w, "start": pd.Timestamp(a).date(), "end": pd.Timestamp(b).date()})
    return {
        "num_teams": int(s["num_teams"]) if s.get("num_teams") else None,
        "draft_type": s.get("draft_type"),
        "draft_status": s.get("draft_status"),
        "draft_time": s.get("draft_time"),
        "rounds": len(non_il) if non_il else None,
        "uses_keepers": s.get("uses_keepers") if "uses_keepers" in s else s.get("is_keeper_league"),
        "roster": roster or None,
        "categories": cats or None,
        "max_weekly_adds": s.get("max_weekly_adds") or s.get("max_adds"),
        "playoff_start_week": s.get("playoff_start_week"),
        "trade_end_date": s.get("trade_end_date"),
        "draft_order": [order[k] for k in sorted(order)] or None,
        "weeks": weeks or None,
    }


def compare(facts: dict, cfg: Settings | None = None) -> list[dict]:
    """Each fact beside settings.yaml: match, differs, new (Yahoo has it, we don't yet) or unknown."""
    cfg = cfg or settings()
    ours_weeks = schedule.fantasy_weeks(cfg.season)
    ours_weeks = [
        {"week": int(r.week), "start": pd.Timestamp(r.start).date(), "end": pd.Timestamp(r.end).date()}
        for r in ours_weeks.itertuples(index=False)
    ]
    order = facts.get("draft_order")
    rows = [
        ("teams", facts.get("num_teams"), cfg.league.teams),
        ("draft rounds", facts.get("rounds"), cfg.draft.rounds),
        ("keepers", facts.get("uses_keepers"), bool(cfg.draft.keepers)),
        ("roster slots", facts.get("roster"), list(cfg.roster.slots)),
        ("categories", facts.get("categories"), [c.label for c in cfg.categories]),
        ("weekly acquisitions", facts.get("max_weekly_adds"), cfg.transactions.max_acquisitions_per_week),
        ("draft order", order, list(cfg.draft.order) or None),
        (
            "my draft slot",
            (order.index(cfg.league.my_team_id) + 1) if order and cfg.league.my_team_id in order else None,
            cfg.draft.my_slot,
        ),
        ("week dates", facts.get("weeks"), ours_weeks),
    ]
    out = []
    for name, yahoo, ours in rows:
        if yahoo is None:
            status = "unknown"                       # Yahoo didn't say
        elif ours is None or ours == []:
            status = "new"                           # Yahoo has it, settings.yaml doesn't yet
        else:
            a, b = _norm(yahoo), _norm(ours)
            status = "match" if a == b else "differs"
        out.append({"fact": name, "yahoo": yahoo, "ours": ours, "status": status})
    return out


def _norm(v):
    if isinstance(v, list):
        return [_norm(x) for x in v]
    if isinstance(v, dict):
        return {k: _norm(x) for k, x in v.items()}
    if isinstance(v, str):
        s = v.strip().lower()
        if s.lstrip("-").isdigit() and s not in ("0", "1"):
            return int(s)                            # Yahoo sends numbers as text
        return {"1": True, "0": False, "true": True, "false": False}.get(s, s)
    if isinstance(v, date):
        return v.isoformat()
    return v


def signed_in() -> bool:
    """True once `make yahoo-auth` has stored tokens (oauth2.json has a refresh token)."""
    import json

    path = REPO_ROOT / "oauth2.json"
    try:
        return bool(json.loads(path.read_text()).get("refresh_token"))
    except (OSError, ValueError):
        return False


def auto_backend(cfg: Settings | None = None) -> ApiBackend | None:
    """The API backend once signed in, else None (the caller uses the CSV inbox)."""
    if not signed_in():
        return None
    league, game = connect(cfg)
    return ApiBackend(league, game, cfg)

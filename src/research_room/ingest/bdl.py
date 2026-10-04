"""BallDontLie NBA client and ingest: teams, players, games, game logs, advanced stats,
injuries, odds.

Inputs: BDL_API_KEY (.env), settings.bdl (base URL, rate limit, seasons).
Outputs: rows in the store; every raw page is cached in `api_responses`.
Tables: writes teams, players, games, game_logs, advanced_stats, injuries, odds,
api_responses, ingest_runs.

A plain `requests` client rather than the `balldontlie` SDK: the SDK's models drop fields
we need (games.datetime tip time, the v2 advanced-stats fields). Paths and fields were
checked against the live API and the OpenAPI spec on 2026-10-04; see DECISIONS.md.

Notes from the live API:
- `min` is a whole-minute string ("37"); "00"/"0"/"" means did not play.
- Odds history is not retained: past dates return nothing, so odds must be archived nightly.
"""

from __future__ import annotations

import json
import logging
import time
from collections import deque
from collections.abc import Callable, Iterator
from datetime import date, timedelta
from typing import Any

import duckdb
import pandas as pd
import requests

from research_room import store
from research_room.config import BdlConfig, load_secrets, settings

log = logging.getLogger(__name__)
SOURCE = "bdl"

EP_TEAMS = "/v1/teams"
EP_PLAYERS_ACTIVE = "/v1/players/active"
EP_GAMES = "/v1/games"
EP_STATS = "/v1/stats"
EP_ADVANCED = "/nba/v2/stats/advanced"
EP_INJURIES = "/v1/player_injuries"
EP_ODDS = "/nba/v2/odds"
EP_ODDS_OPENING = "/nba/v2/odds/opening"


class BdlError(RuntimeError):
    """A BallDontLie request failed in a way retrying will not fix."""


class RateLimiter:
    """Sliding one-minute window: at most `per_minute` calls in any 60 seconds."""

    def __init__(self, per_minute: int, clock: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], None] = time.sleep) -> None:
        self.per_minute = per_minute
        self._clock, self._sleep = clock, sleep
        self._calls: deque[float] = deque()

    def wait(self) -> None:
        now = self._clock()
        while self._calls and now - self._calls[0] >= 60:
            self._calls.popleft()
        if len(self._calls) >= self.per_minute:
            self._sleep(60 - (now - self._calls[0]) + 0.01)
            return self.wait()
        self._calls.append(self._clock())


class BdlClient:
    """Typed-ish GET client with rate limiting, retry/backoff, cursor pagination and caching."""

    def __init__(self, api_key: str, cfg: BdlConfig, session: requests.Session | None = None,
                 sleep: Callable[[float], None] = time.sleep,
                 clock: Callable[[], float] = time.monotonic) -> None:
        if not api_key:
            raise BdlError("BDL_API_KEY is empty in .env")
        self.cfg = cfg
        self._session = session or requests.Session()
        self._session.headers.update({"Authorization": api_key})
        self._sleep = sleep
        self._limiter = RateLimiter(cfg.requests_per_minute, clock=clock, sleep=sleep)
        self.requests_made = 0

    @classmethod
    def from_env(cls) -> BdlClient:
        return cls(load_secrets().require("bdl_api_key"), settings().bdl)

    def get(self, path: str, params: dict[str, Any] | None = None) -> dict:
        """One GET. Retries 429/5xx/network errors with exponential backoff."""
        url = self.cfg.base_url.rstrip("/") + path
        for attempt in range(self.cfg.max_retries + 1):
            self._limiter.wait()
            try:
                resp = self._session.get(url, params=params, timeout=self.cfg.timeout_seconds)
            except requests.RequestException as exc:
                if attempt == self.cfg.max_retries:
                    raise BdlError(f"GET {path} failed after retries: {exc}") from exc
                self._sleep(2 ** attempt)
                continue
            self.requests_made += 1
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code == 429 or resp.status_code >= 500:
                if attempt == self.cfg.max_retries:
                    raise BdlError(f"GET {path}: HTTP {resp.status_code} after {attempt + 1} tries")
                retry_after = resp.headers.get("Retry-After")
                self._sleep(float(retry_after) if retry_after else 2 ** attempt)
                continue
            if resp.status_code in (401, 403):
                raise BdlError(f"GET {path}: HTTP {resp.status_code}. The key is missing, wrong, or "
                               "its plan does not include this endpoint.")
            raise BdlError(f"GET {path}: HTTP {resp.status_code}: {resp.text[:200]}")
        raise AssertionError("unreachable")

    def paginate(self, path: str, params: dict[str, Any] | None = None,
                 con: duckdb.DuckDBPyConnection | None = None,
                 use_cache: bool = False) -> Iterator[list[dict]]:
        """Yield each page's `data` list, following `meta.next_cursor`.

        With `con`, every page is stored in `api_responses`. With `use_cache=True`, pages
        already stored are replayed without a request, which makes backfills resumable.
        """
        base = {"per_page": self.cfg.per_page, **(params or {})}
        cursor = None
        while True:
            page_params = {**base, **({"cursor": cursor} if cursor is not None else {})}
            cached = con is not None and use_cache
            body = store.cache_get(con, SOURCE, path, page_params) if cached else None
            if body is None:
                body = self.get(path, page_params)
                if con is not None:
                    store.cache_put(con, SOURCE, path, page_params, 200, body)
            yield body.get("data", [])
            cursor = (body.get("meta") or {}).get("next_cursor")
            if cursor is None:
                return


# ---------------------------------------------------------------- parsers (pure)

def parse_minutes(value: Any) -> float:
    """'37' -> 37.0, '36:30' -> 36.5, '00' / '' / None -> 0.0."""
    if value is None:
        return 0.0
    text = str(value).strip()
    if not text:
        return 0.0
    if ":" in text:
        mins, secs = text.split(":", 1)
        return float(mins or 0) + float(secs or 0) / 60
    return float(text)


def _num(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_teams(rows: list[dict], fetched_at) -> pd.DataFrame:
    return pd.DataFrame([{
        "team_id": r["id"], "abbreviation": r.get("abbreviation"), "city": r.get("city"),
        "name": r.get("name"), "full_name": r.get("full_name"), "conference": r.get("conference"),
        "division": r.get("division"), "source": SOURCE, "fetched_at": fetched_at,
    } for r in rows])


def parse_players(rows: list[dict], fetched_at) -> pd.DataFrame:
    out = []
    for r in rows:
        team_id = r.get("team_id") or (r.get("team") or {}).get("id")
        out.append({
            "player_id": r["id"], "first_name": r.get("first_name"), "last_name": r.get("last_name"),
            "full_name": f"{r.get('first_name') or ''} {r.get('last_name') or ''}".strip(),
            "position": r.get("position") or None, "height": r.get("height"), "weight": r.get("weight"),
            "jersey_number": r.get("jersey_number"), "team_id": team_id,
            "draft_year": r.get("draft_year"), "country": r.get("country"),
            "source": SOURCE, "fetched_at": fetched_at,
        })
    return pd.DataFrame(out)


def parse_games(rows: list[dict], fetched_at) -> pd.DataFrame:
    out = []
    for g in rows:
        home = g.get("home_team_id") or (g.get("home_team") or {}).get("id")
        away = g.get("visitor_team_id") or (g.get("visitor_team") or {}).get("id")
        season_type = g.get("season_type") or ("playoffs" if g.get("postseason") else None)
        out.append({
            "game_id": g["id"], "season": g.get("season"), "game_date": g.get("date"),
            "tip_utc": pd.to_datetime(g.get("datetime"), utc=True) if g.get("datetime") else pd.NaT,
            "status": g.get("status"), "status_state": g.get("status_state"),
            "postseason": bool(g.get("postseason")), "season_type": season_type,
            "ist_stage": g.get("ist_stage"), "postponed": bool(g.get("postponed")),
            "home_team_id": home, "visitor_team_id": away,
            "home_score": g.get("home_team_score"), "visitor_score": g.get("visitor_team_score"),
            "source": SOURCE, "fetched_at": fetched_at,
        })
    return pd.DataFrame(out)


_BOX = ("fgm", "fga", "ftm", "fta", "fg3m", "fg3a", "oreb", "dreb", "reb", "ast", "stl", "blk",
        "pf", "pts", "plus_minus")


def parse_stats(rows: list[dict], fetched_at) -> pd.DataFrame:
    """Per-player box scores -> game_logs rows. TO is `turnover` in the API, `tov` here."""
    out = []
    for r in rows:
        game = r.get("game") or {}
        minutes = parse_minutes(r.get("min"))
        row = {
            "game_id": game.get("id"), "player_id": (r.get("player") or {}).get("id"),
            "team_id": (r.get("team") or {}).get("id"), "season": game.get("season"),
            "game_date": game.get("date"), "minutes": minutes, "did_play": minutes > 0,
            "tov": _num(r.get("turnover")), "source": SOURCE, "fetched_at": fetched_at,
        }
        row.update({k: _num(r.get(k)) for k in _BOX})
        out.append(row)
    return pd.DataFrame(out)


_ADV_MAP = {
    "usage_percentage": "usage_pct", "pace": "pace", "possessions": "possessions",
    "offensive_rating": "off_rating", "defensive_rating": "def_rating", "net_rating": "net_rating",
    "true_shooting_percentage": "ts_pct", "effective_field_goal_percentage": "efg_pct", "pie": "pie",
}


def parse_advanced(rows: list[dict], fetched_at) -> pd.DataFrame:
    """v2 advanced stats, full-game rows only. Unmapped scalar fields go to `extra` JSON."""
    out = []
    for r in rows:
        if r.get("period") not in (None, 0):
            continue
        game = r.get("game") or {}
        row = {
            "game_id": game.get("id"), "player_id": (r.get("player") or {}).get("id"),
            "team_id": (r.get("team") or {}).get("id"), "season": game.get("season"),
            "game_date": game.get("date"), "source": SOURCE, "fetched_at": fetched_at,
        }
        row.update({ours: _num(r.get(theirs)) for theirs, ours in _ADV_MAP.items()})
        extra = {k: v for k, v in r.items()
                 if k not in _ADV_MAP and k not in ("id", "player", "team", "game", "period")
                 and not isinstance(v, dict | list)}
        row["extra"] = json.dumps(extra)
        out.append(row)
    return pd.DataFrame(out)


def parse_injuries(rows: list[dict], fetched_at) -> pd.DataFrame:
    """One snapshot row per injured player, stamped with this run's fetched_at."""
    return pd.DataFrame([{
        "player_id": (r.get("player") or {}).get("id"), "status": r.get("status"),
        "description": r.get("description"), "return_date": r.get("return_date"),
        "source": SOURCE, "fetched_at": fetched_at,
    } for r in rows])


def american_to_prob(odds: Any) -> float | None:
    """Implied probability of an American price, vig included: -150 -> 0.6, +130 -> 0.435."""
    o = _num(odds)
    if o is None or o == 0:
        return None
    return 100 / (o + 100) if o > 0 else -o / (-o + 100)


def parse_odds(rows: list[dict], fetched_at, is_opening: bool = False) -> pd.DataFrame:
    """v2 game odds -> one row per (market, side). `prob` is de-vigged within each pair."""
    markets = {
        "spread": (("home", "spread_home_value", "spread_home_odds"),
                   ("away", "spread_away_value", "spread_away_odds")),
        "total": (("over", "total_value", "total_over_odds"),
                  ("under", "total_value", "total_under_odds")),
        "moneyline": (("home", None, "moneyline_home_odds"), ("away", None, "moneyline_away_odds")),
    }
    out = []
    for r in rows:
        ts = r.get("opened_at") if is_opening else r.get("updated_at")
        ts = pd.to_datetime(ts, utc=True) if ts else fetched_at
        for market, sides in markets.items():
            raw = [american_to_prob(r.get(price)) for _, _, price in sides]
            if all(p is None for p in raw):
                continue
            total = sum(p for p in raw if p is not None)
            for (side, line_key, price_key), p in zip(sides, raw, strict=True):
                out.append({
                    "game_id": r["game_id"], "vendor": r.get("vendor"), "market": market, "side": side,
                    "is_opening": is_opening, "line": _num(r.get(line_key)) if line_key else None,
                    "price_american": _num(r.get(price_key)),
                    "prob": (p / total) if (p is not None and None not in raw and total) else None,
                    "ts": ts, "source": SOURCE, "fetched_at": fetched_at,
                })
    return pd.DataFrame(out)


# ---------------------------------------------------------------- ingest jobs

def _collect(client: BdlClient, path: str, params: dict, con, use_cache: bool,
             progress: Callable[[int], None] | None = None) -> list[dict]:
    rows: list[dict] = []
    for page in client.paginate(path, params, con=con, use_cache=use_cache):
        rows.extend(page)
        if progress:
            progress(len(rows))
    return rows


def sync_teams(con, client: BdlClient) -> int:
    rows = client.get(EP_TEAMS).get("data", [])
    store.cache_put(con, SOURCE, EP_TEAMS, {}, 200, {"data": rows})
    return store.upsert(con, "teams", parse_teams(rows, store.utcnow()))


def sync_active_players(con, client: BdlClient) -> int:
    rows = _collect(client, EP_PLAYERS_ACTIVE, {}, con, use_cache=False)
    return store.upsert(con, "players", parse_players(rows, store.utcnow()))


def sync_games(con, client: BdlClient, season: int, use_cache: bool = False) -> int:
    rows = _collect(client, EP_GAMES, {"seasons[]": season}, con, use_cache)
    return store.upsert(con, "games", parse_games(rows, store.utcnow()))


def sync_stats(con, client: BdlClient, params: dict, use_cache: bool,
               progress: Callable[[int], None] | None = None) -> int:
    rows = _collect(client, EP_STATS, params, con, use_cache, progress)
    now = store.utcnow()
    players = parse_players([r["player"] for r in rows if r.get("player")], now)
    if not players.empty:
        # Box-score player objects carry the player's current team_id, not the team at game
        # time, and are older than /players/active. Insert only players not seen yet.
        known = {r[0] for r in con.execute("SELECT player_id FROM players").fetchall()}
        store.upsert(con, "players", players[~players["player_id"].isin(known)])
    logs = parse_stats(rows, now)
    return store.upsert(con, "game_logs", logs.dropna(subset=["game_id", "player_id"]))


def sync_advanced(con, client: BdlClient, params: dict, use_cache: bool,
                  progress: Callable[[int], None] | None = None) -> int:
    rows = _collect(client, EP_ADVANCED, {"period": 0, **params}, con, use_cache, progress)
    adv = parse_advanced(rows, store.utcnow())
    return store.upsert(con, "advanced_stats", adv.dropna(subset=["game_id", "player_id"]))


def sync_injuries(con, client: BdlClient) -> int:
    rows = _collect(client, EP_INJURIES, {}, con, use_cache=False)
    inj = parse_injuries(rows, store.utcnow())
    return store.upsert(con, "injuries", inj.dropna(subset=["player_id"]))


def sync_odds(con, client: BdlClient, dates: list[date]) -> int:
    params = {"dates[]": [d.isoformat() for d in dates]}
    now = store.utcnow()
    live = parse_odds(_collect(client, EP_ODDS, params, con, use_cache=False), now)
    opening = parse_odds(_collect(client, EP_ODDS_OPENING, params, con, use_cache=False), now,
                         is_opening=True)
    frames = [f for f in (live, opening) if not f.empty]
    return store.upsert(con, "odds", pd.concat(frames, ignore_index=True)) if frames else 0


def backfill(con: duckdb.DuckDBPyConnection, client: BdlClient, seasons: list[int],
             schedule_season: int | None = None, echo: Callable[[str], None] = print) -> dict[str, int]:
    """Pull complete history for `seasons` plus the schedule for `schedule_season`.

    Resumable: pages already in `api_responses` are replayed, not re-requested.
    """
    counts: dict[str, int] = {}
    with store.ingest_run(con, SOURCE, "backfill") as run:
        counts["teams"] = sync_teams(con, client)
        echo(f"teams: {counts['teams']}")
        for season in sorted(set(seasons) | ({schedule_season} if schedule_season else set())):
            done = season != schedule_season
            n = sync_games(con, client, season, use_cache=done)
            counts[f"games_{season}"] = n
            echo(f"games {season}: {n}")
        for season in seasons:
            n = sync_stats(con, client, {"seasons[]": season}, use_cache=True,
                           progress=_ticker(echo, f"game logs {season}"))
            counts[f"game_logs_{season}"] = n
            echo(f"game logs {season}: {n} rows ({client.requests_made} requests so far)")
            n = sync_advanced(con, client, {"seasons[]": season}, use_cache=True,
                              progress=_ticker(echo, f"advanced {season}"))
            counts[f"advanced_{season}"] = n
            echo(f"advanced {season}: {n} rows ({client.requests_made} requests so far)")
        counts["players_active"] = sync_active_players(con, client)
        echo(f"active players: {counts['players_active']}")
        run["rows"] = sum(counts.values())
        run["detail"] = json.dumps({**counts, "requests": client.requests_made})
    return counts


def sync_daily(con: duckdb.DuckDBPyConnection, client: BdlClient, today: date,
               lookback_days: int = 3, odds_days_ahead: int = 2) -> dict[str, int]:
    """Nightly refresh: schedule, recent box scores, injuries snapshot, upcoming odds."""
    counts: dict[str, int] = {}
    season = settings().season.nba_season
    window = {"start_date": (today - timedelta(days=lookback_days)).isoformat(),
              "end_date": today.isoformat()}
    with store.ingest_run(con, SOURCE, "sync_daily") as run:
        counts["games"] = sync_games(con, client, season)
        counts["game_logs"] = sync_stats(con, client, window, use_cache=False)
        counts["advanced"] = sync_advanced(con, client, window, use_cache=False)
        counts["injuries"] = sync_injuries(con, client)
        upcoming = [today + timedelta(days=i) for i in range(odds_days_ahead + 1)]
        counts["odds"] = sync_odds(con, client, upcoming)
        counts["players_active"] = sync_active_players(con, client)
        run["rows"] = sum(counts.values())
        run["detail"] = json.dumps(counts)
    return counts


def _ticker(echo: Callable[[str], None], label: str, every: int = 5000) -> Callable[[int], None]:
    state = {"next": every}

    def tick(n: int) -> None:
        if n >= state["next"]:
            echo(f"  {label}: {n} rows fetched")
            state["next"] = (n // every + 1) * every
    return tick

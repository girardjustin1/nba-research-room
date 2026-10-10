"""Yahoo Fantasy information, live and in memory only: the Yahoo data policy.

Inputs: the Fantasy API when signed in (ingest/yahoo_api.py, read only, with backoff), else the
CSV files the owner exported from the Yahoo website (data/inbox); settings.league.
Outputs: this connection's TEMP Yahoo tables (store.LIVE_ONLY), filled for one job or one page
request. Tables: nothing is written to the store.

The policy, enforced here and checked by tests/test_yahoo_data_policy.py:
- Yahoo Fantasy information is not stored, cached or indexed. The tables live in memory inside
  one connection and are gone when it closes; the next job or page reads Yahoo again. Only the
  app's own analyses are kept, and `make yahoo-purge` deletes them with everything else.
- Rosters are loaded for my team and this week's opponent only (also the fewest calls); free
  agents come from the player list; nothing compiles or presents every team's players.
- Reads back off when Yahoo throttles them (yahoo_api.ReadOnly), and never write (read only).
- Nothing here feeds an AI tool or a model fit: the tables are read by the decision code only.
- Every page that can show Yahoo data carries the attribution (web YahooAttribution).

When Yahoo is slow or down: the reads run side by side (settings.yahoo.parallel_reads) on a worker
thread with a time limit (page_time_limit_s; jobs pass job_time_limit_s). A read that fails or runs
out of time falls back to the CSV inbox and my manual entries, and pages then skip Yahoo for
pause_after_failure_s so they don't each wait again. `status()` says how the last read went (no
Yahoo data in it: a state, a time and a sentence) for the page's banner.
"""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from datetime import UTC, datetime

import pandas as pd

from research_room.config import Settings, settings
from research_room.ingest import yahoo, yahoo_api

ALL = yahoo.LIVE  # teams, roster, players, matchup
PAGE = ("teams", "roster", "matchup")  # what most pages need: a few calls


def odds_parts(cfg: Settings | None = None) -> tuple[str, ...]:
    """What the weekly odds need: PAGE, plus the free agents when the odds assume the opponent
    streams (settings.opponent.streaming; he picks from them)."""
    cfg = cfg or settings()
    return (*PAGE, "players") if cfg.opponent.streaming else PAGE


def _opponent(matchup: pd.DataFrame, me: int) -> int | None:
    mine = matchup[matchup["team_id"] == me] if not matchup.empty else matchup
    return int(mine["opponent_team_id"].iloc[0]) if not mine.empty else None


class _Limited:
    """A backend whose roster snapshot keeps my team and this week's opponent only."""

    def __init__(self, inner, me: int) -> None:
        self.inner, self.me, self._opp = inner, me, None

    def available(self, parts=None):
        return self.inner.available(parts)

    def read(self, name: str) -> pd.DataFrame:
        df = self.inner.read(name)
        if name == "roster":
            if self._opp is None and "matchup" in self.inner.available(["matchup"]):
                self._opp = _opponent(self.inner.read("matchup"), self.me)
            keep = {self.me} | ({self._opp} if self._opp is not None else set())
            df = df[df["team_id"].isin(keep)]
        return df


MESSAGES = {
    "live": "Read from Yahoo just now.",
    "off": "Not signed in to Yahoo: using your own entries.",
    "slow": "Yahoo didn't answer in time: showing your own entries and the last saved plan.",
    "down": "Yahoo couldn't be read: showing your own entries and the last saved plan.",
    "throttled": "Yahoo is limiting requests: showing your own entries and the last saved plan.",
    "no_access": "Yahoo isn't letting the app read the league yet: using your own entries.",
}
DEGRADED = frozenset({"slow", "down", "throttled", "no_access"})

_lock = threading.Lock()
_last: dict = {"state": "off", "checked_at": None, "seconds": None}
_paused_until = 0.0     # time.monotonic(): pages skip Yahoo until then, after a failed read


def status() -> dict:
    """How the last Yahoo read went: state (live, off, slow, down, throttled, no_access), when, how
    long it took, a sentence for the page, and whether pages are skipping Yahoo for now. No Yahoo
    data, so it can be kept in memory between requests."""
    with _lock:
        out = dict(_last)
        out["paused"] = time.monotonic() < _paused_until
    out["message"] = MESSAGES[out["state"]]
    out["degraded"] = out["state"] in DEGRADED
    return out


def _record(state: str, seconds: float | None, pause_s: float = 0.0) -> dict:
    global _paused_until
    with _lock:
        _last.update(state=state, checked_at=datetime.now(UTC).isoformat(timespec="seconds"),
                     seconds=None if seconds is None else round(seconds, 2))
        if state in DEGRADED and pause_s > 0:
            _paused_until = time.monotonic() + pause_s
        elif state == "live":
            _paused_until = 0.0
    return status()


def reset() -> None:
    """Forget the last read and any pause (tests; `make yahoo-check` before its speed check)."""
    global _paused_until
    with _lock:
        _last.update(state="off", checked_at=None, seconds=None)
        _paused_until = 0.0


def _read_api(cfg: Settings, want: tuple[str, ...], me: int):
    """Every API read for this load, done up front (so loading into the connection makes no more
    calls): the matchup first when rosters are wanted (it names this week's opponent), then the
    rest side by side."""
    league, game = yahoo_api.connect(cfg)
    api = yahoo_api.ApiBackend(league, game, cfg, workers=cfg.yahoo.parallel_reads)
    if "roster" in want:
        api.prefetch(("matchup",))
        api.team_ids = {me} | ({o} if (o := _opponent(api.read("matchup"), me)) is not None else set())
    api.prefetch(want)
    return api


def attach(
    con,
    cfg: Settings | None = None,
    parts: tuple[str, ...] | None = None,
    show_names: bool = False,
    time_limit: float | None = None,
) -> dict:
    """Fill this connection's in-memory Yahoo tables with the parts asked for (default all):
    the API when signed in, else the CSV inbox. An API read that fails or takes longer than
    `time_limit` seconds (default settings.yahoo.page_time_limit_s) falls back to the CSV inbox and
    says so; for a while after, page reads (no `time_limit` given) skip the API
    (settings.yahoo.pause_after_failure_s). Returns
    where the data came from, what was loaded, the names that didn't resolve and `yahoo`, the read's
    status (see `status`)."""
    cfg = cfg or settings()
    want = tuple(parts or ALL)
    if "roster" in want and "matchup" not in want:
        want = (*want, "matchup")  # the opponent decides whose roster loads
    me = cfg.league.my_team_id
    page = time_limit is None   # pages respect the pause; jobs always try Yahoo
    limit = time_limit or cfg.yahoo.page_time_limit_s
    error, state = None, "off"
    if yahoo_api.signed_in():
        now = status()
        if page and now["paused"]:
            state = now["state"]   # failed moments ago: don't make this page wait again
            error = "skipped: Yahoo failed moments ago"
        else:
            started = time.monotonic()
            ex = ThreadPoolExecutor(max_workers=1, thread_name_prefix="yahoo-read")
            try:
                api = ex.submit(_read_api, cfg, want, me).result(timeout=limit)
                out = {"source": "api", **yahoo.load_live(con, _Limited(api, me), cfg, want, show_names)}
                out["yahoo"] = _record("live", time.monotonic() - started)
                return _with_manual_opponent(con, cfg, want, out)
            except yahoo.YahooCsvError:
                raise
            except FutureTimeout:
                state, error = "slow", f"no answer within {limit:g} s"
            except Exception as exc:  # noqa: BLE001 - the CSV inbox still works; reported
                state, error = yahoo_api.problem(exc), f"{type(exc).__name__}: {exc}"[:200]
            finally:
                ex.shutdown(wait=False)   # a read past its limit finishes on its own; its result is dropped
            _record(state, time.monotonic() - started, cfg.yahoo.pause_after_failure_s)
    out = {
        "source": "csv",
        **yahoo.load_live(con, _Limited(yahoo.CsvBackend(cfg.paths.inbox_dir), me), cfg, want, show_names),
    }
    if error:
        out["api_error"] = error
    out["yahoo"] = status() if state != "off" else _record("off", None)
    return _with_manual_opponent(con, cfg, want, out)


def _with_manual_opponent(con, cfg: Settings, want: tuple[str, ...], out: dict) -> dict:
    """My roster, this week's opponent and the free agents, entered by hand, fill in when Yahoo
    didn't supply them (opponent_roster, free_agents)."""
    from research_room import opponent_roster

    if "roster" in want:
        out["manual_mine"] = opponent_roster.apply_mine(con, cfg)
        out["manual_opponent"] = opponent_roster.apply(con, cfg)
    if "players" in want:   # after the rosters: their players are left out of the pasted list
        from research_room import free_agents

        out["manual_free_agents"] = free_agents.apply(con, cfg)
    return out


def final_matchup(cfg: Settings | None = None):
    """A reader of one finished week's matchup from the API (in memory, for grading it once), or
    None when not signed in. Connects on first use only."""
    cfg = cfg or settings()
    if not yahoo_api.signed_in():
        return None
    state: dict = {}

    def read(week: int) -> pd.DataFrame:
        if "league" not in state:
            state["league"], state["game"] = yahoo_api.connect(cfg)
        return yahoo_api.ApiBackend(state["league"], state["game"], cfg, week=week).matchup()

    return read

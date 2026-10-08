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
"""

from __future__ import annotations

import pandas as pd

from research_room.config import Settings, settings
from research_room.ingest import yahoo, yahoo_api

ALL = yahoo.LIVE  # teams, roster, players, matchup
PAGE = ("teams", "roster", "matchup")  # what most pages need: a few calls


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


def attach(
    con, cfg: Settings | None = None, parts: tuple[str, ...] | None = None, show_names: bool = False
) -> dict:
    """Fill this connection's in-memory Yahoo tables with the parts asked for (default all):
    the API when signed in, else the CSV inbox; an API failure falls back to the CSV inbox and
    says so. Returns where the data came from, what was loaded and the names that didn't resolve."""
    cfg = cfg or settings()
    want = tuple(parts or ALL)
    if "roster" in want and "matchup" not in want:
        want = (*want, "matchup")  # the opponent decides whose roster loads
    me = cfg.league.my_team_id
    error = None
    if yahoo_api.signed_in():
        try:
            league, game = yahoo_api.connect(cfg)
            api = yahoo_api.ApiBackend(league, game, cfg)
            if "roster" in want:
                api.team_ids = {me} | (
                    {o} if (o := _opponent(api.read("matchup"), me)) is not None else set()
                )
            out = {"source": "api", **yahoo.load_live(con, _Limited(api, me), cfg, want, show_names)}
            return _with_manual_opponent(con, cfg, want, out)
        except yahoo.YahooCsvError:
            raise
        except Exception as exc:  # noqa: BLE001 - the CSV inbox still works; reported
            error = f"{type(exc).__name__}: {exc}"[:200]
    out = {
        "source": "csv",
        **yahoo.load_live(con, _Limited(yahoo.CsvBackend(cfg.paths.inbox_dir), me), cfg, want, show_names),
    }
    if error:
        out["api_error"] = error
    return _with_manual_opponent(con, cfg, want, out)


def _with_manual_opponent(con, cfg: Settings, want: tuple[str, ...], out: dict) -> dict:
    """This week's opponent entered by hand fills in when Yahoo didn't supply him (opponent_roster)."""
    from research_room import opponent_roster

    if "roster" in want:
        out["manual_opponent"] = opponent_roster.apply(con, cfg)
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

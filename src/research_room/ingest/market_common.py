"""Shared pieces for betting-market ingest (Kalshi, TheRundown).

Inputs: the store's games and teams, config/aliases.yaml team aliases.
Outputs: a polite rate-limited JSON GET, team-code normalization, and a lookup from (league date,
two teams) to the BallDontLie game_id, so every market row joins the rest of the store.
Tables: reads games, teams.
"""

from __future__ import annotations

import time
from datetime import date
from zoneinfo import ZoneInfo

import duckdb
import pandas as pd
import requests

from research_room.ingest.bdl import american_to_prob
from research_room.ingest.names import load_team_aliases

ET = ZoneInfo("America/New_York")
__all__ = ["RateLimited", "GameIndex", "american_to_prob", "devig_pair"]


class RateLimited:
    """GET JSON at most `per_second` requests a second, with a few retries on 429/5xx."""

    def __init__(self, per_second: float, headers: dict | None = None, timeout: float = 30, retries: int = 4):
        self.gap, self.headers, self.timeout, self.retries = 1.0 / per_second, headers or {}, timeout, retries
        self.session = requests.Session()
        self._last = 0.0
        self.calls = 0

    def _send(self, url: str, params: dict | None = None) -> requests.Response:
        for attempt in range(self.retries + 1):
            wait = self._last + self.gap - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            r = self.session.get(url, params=params, headers=self.headers, timeout=self.timeout)
            self.calls += 1
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(min(2**attempt, 15))
                continue
            return r
        return r

    def get(self, url: str, params: dict | None = None) -> dict:
        r = self._send(url, params)
        r.raise_for_status()
        return r.json()

    def get_bytes(self, url: str) -> bytes | None:
        """A file's bytes, or None when it isn't there (403 / 404: not published)."""
        r = self._send(url)
        if r.status_code in (403, 404):
            return None
        r.raise_for_status()
        return r.content


class GameIndex:
    """(league date, {team A, team B}) -> BDL game_id. Team codes go through the aliases."""

    def __init__(self, con: duckdb.DuckDBPyConnection, aliases: dict[str, str] | None = None) -> None:
        g = con.execute("""
            SELECT g.game_id, g.game_date, h.abbreviation AS home, v.abbreviation AS away
            FROM games g JOIN teams h ON h.team_id = g.home_team_id
            JOIN teams v ON v.team_id = g.visitor_team_id
        """).df()
        self.aliases = aliases if aliases is not None else load_team_aliases()
        self._by = {
            (pd.Timestamp(r.game_date).date(), frozenset((r.home, r.away))): int(r.game_id)
            for r in g.itertuples(index=False)
        }

    def team(self, code: str | None) -> str | None:
        if not code:
            return None
        c = code.strip().upper()
        return self.aliases.get(c, c)

    def game_id(self, day: date, team_a: str | None, team_b: str | None) -> int | None:
        a, b = self.team(team_a), self.team(team_b)
        return self._by.get((day, frozenset((a, b)))) if a and b else None


def devig_pair(p_a: float | None, p_b: float | None) -> tuple[float | None, float | None]:
    """Remove the vig from a two-way market: scale both implied probabilities to sum to 1."""
    if p_a is None or p_b is None or p_a + p_b <= 0:
        return None, None
    s = p_a + p_b
    return p_a / s, p_b / s

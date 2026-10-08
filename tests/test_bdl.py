"""BDL client and parser tests. No network: a fake session serves canned pages whose shapes
were copied from live responses on 2026-10-04."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime

import pandas as pd
import pytest

from research_room import store
from research_room.config import BdlConfig
from research_room.ingest import bdl

NOW = datetime(2026, 10, 4, tzinfo=UTC)
CFG = BdlConfig(base_url="https://api.test", requests_per_minute=1000, per_page=2,
                backfill_seasons=[2025], max_retries=3)

GAME = {"id": 100, "date": "2025-10-21", "datetime": "2025-10-21T23:30:00.000Z", "season": 2025,
        "status": "Final", "status_state": "final", "postseason": False, "home_team_id": 1,
        "visitor_team_id": 2, "home_team_score": 110, "visitor_team_score": 101, "ist_stage": None,
        "postponed": False}
PLAYER = {"id": 7, "first_name": "Nikola", "last_name": "Jokić", "position": "C", "team_id": 1,
          "height": "6-11", "weight": "284", "jersey_number": "15", "draft_year": 2014, "country": "Serbia"}


def stat_row(player_id: int, minutes: str, pts: float = 10) -> dict:
    return {"id": player_id * 10, "min": minutes, "fgm": 4, "fga": 9, "fg_pct": 0.444, "fg3m": 1,
            "fg3a": 3, "ftm": 1, "fta": 2, "oreb": 1, "dreb": 5, "reb": 6, "ast": 3, "stl": 1, "blk": 0,
            "turnover": 2, "pf": 3, "pts": pts, "plus_minus": 4,
            "player": {**PLAYER, "id": player_id}, "team": {"id": 1}, "game": GAME}


class FakeResponse:
    def __init__(self, status: int, body: dict | None = None, headers: dict | None = None):
        self.status_code, self._body, self.headers = status, body or {}, headers or {}
        self.text = json.dumps(self._body)

    def json(self):
        return self._body


class FakeSession:
    """Serves responses by (path, cursor); records every call."""

    def __init__(self, routes: dict):
        self.routes, self.calls, self.headers = routes, [], {}

    def get(self, url, params=None, timeout=None):
        path = url.replace(CFG.base_url, "")
        self.calls.append((path, dict(params or {})))
        key = (path, (params or {}).get("cursor"))
        queue = self.routes[key]
        return queue.pop(0) if isinstance(queue, list) else queue


def client(routes: dict) -> tuple[bdl.BdlClient, FakeSession, list]:
    sleeps: list[float] = []
    sess = FakeSession(routes)
    return bdl.BdlClient("k", CFG, session=sess, sleep=sleeps.append), sess, sleeps


# ---------------------------------------------------------------- client

def test_paginate_follows_next_cursor_until_absent():
    c, sess, _ = client({
        ("/v1/stats", None): FakeResponse(200, {"data": [1, 2], "meta": {"next_cursor": 5}}),
        ("/v1/stats", 5): FakeResponse(200, {"data": [3], "meta": {}}),
    })
    assert list(c.paginate("/v1/stats", {"seasons[]": 2025})) == [[1, 2], [3]]
    assert [p.get("cursor") for _, p in sess.calls] == [None, 5]
    assert all(p["per_page"] == 2 for _, p in sess.calls)


def test_cached_pages_replay_without_requests(con):
    routes = {("/v1/stats", None): FakeResponse(200, {"data": [1], "meta": {"next_cursor": 9}}),
              ("/v1/stats", 9): FakeResponse(200, {"data": [2], "meta": {}})}
    c, sess, _ = client(routes)
    assert list(c.paginate("/v1/stats", {"seasons[]": 2025}, con=con, use_cache=True)) == [[1], [2]]
    assert len(sess.calls) == 2
    c2, sess2, _ = client({})
    assert list(c2.paginate("/v1/stats", {"seasons[]": 2025}, con=con, use_cache=True)) == [[1], [2]]
    assert sess2.calls == []


def test_retries_429_then_succeeds_honouring_retry_after():
    c, sess, sleeps = client({("/v1/teams", None): [
        FakeResponse(429, headers={"Retry-After": "3"}), FakeResponse(503),
        FakeResponse(200, {"data": []})]})
    assert c.get("/v1/teams") == {"data": []}
    assert sleeps == [3.0, 2.0] and len(sess.calls) == 3


def test_gives_up_after_max_retries():
    c, _, _ = client({("/v1/teams", None): FakeResponse(500)})
    with pytest.raises(bdl.BdlError, match="HTTP 500 after 4 tries"):
        c.get("/v1/teams")


def test_auth_error_is_readable_and_not_retried():
    c, sess, _ = client({("/v1/stats", None): FakeResponse(401)})
    with pytest.raises(bdl.BdlError, match="plan does not include"):
        c.get("/v1/stats")
    assert len(sess.calls) == 1


def test_empty_key_is_rejected():
    with pytest.raises(bdl.BdlError, match="empty"):
        bdl.BdlClient("", CFG)


def test_rate_limiter_blocks_the_call_over_the_limit():
    t = {"now": 0.0}
    sleeps: list[float] = []

    def sleep(s):
        sleeps.append(s)
        t["now"] += s

    lim = bdl.RateLimiter(3, clock=lambda: t["now"], sleep=sleep)
    for _ in range(3):
        lim.wait()
    assert sleeps == []
    lim.wait()
    assert len(sleeps) == 1 and 59.9 < sleeps[0] <= 60.1


# ---------------------------------------------------------------- parsers

@pytest.mark.parametrize(("raw", "expected"), [
    ("37", 37.0), ("00", 0.0), ("0", 0.0), ("", 0.0), (None, 0.0), ("36:30", 36.5), (12, 12.0)])
def test_parse_minutes(raw, expected):
    assert bdl.parse_minutes(raw) == expected


def test_parse_games_keeps_tip_time_in_utc():
    g = bdl.parse_games([GAME, {**GAME, "id": 101, "datetime": None, "postseason": True}], NOW)
    assert g.loc[0, "tip_utc"] == pd.Timestamp("2025-10-21T23:30:00Z")
    assert pd.isna(g.loc[1, "tip_utc"]) and g.loc[1, "season_type"] == "playoffs"


def test_parse_stats_maps_turnovers_and_did_play():
    logs = bdl.parse_stats([stat_row(7, "34"), stat_row(8, "00", pts=0)], NOW)
    assert logs["tov"].tolist() == [2.0, 2.0]
    assert logs["did_play"].tolist() == [True, False]
    assert logs.loc[0, "game_date"] == "2025-10-21" and logs.loc[0, "season"] == 2025


def test_parse_advanced_keeps_full_game_rows_and_extra_json():
    rows = [{"id": 1, "period": 0, "usage_percentage": 0.31, "pace": 99.5, "possessions": 70,
             "defensive_rating": 108.0, "touches": 88, "player": PLAYER, "team": {"id": 1}, "game": GAME},
            {"id": 2, "period": 1, "usage_percentage": 0.4, "player": PLAYER, "team": {"id": 1},
             "game": GAME}]
    adv = bdl.parse_advanced(rows, NOW)
    assert len(adv) == 1 and adv.loc[0, "usage_pct"] == 0.31 and adv.loc[0, "def_rating"] == 108.0
    assert json.loads(adv.loc[0, "extra"]) == {"touches": 88}


def test_american_to_prob():
    assert bdl.american_to_prob(-150) == pytest.approx(0.6)
    assert bdl.american_to_prob(130) == pytest.approx(100 / 230)
    assert bdl.american_to_prob(None) is None


def test_parse_odds_devigs_pairs_and_skips_empty_markets():
    row = {"id": 1, "game_id": 100, "vendor": "draftkings", "spread_home_value": "-1.5",
           "spread_home_odds": -115, "spread_away_value": "1.5", "spread_away_odds": -105,
           "moneyline_home_odds": -125, "moneyline_away_odds": 105, "total_value": "242.5",
           "total_over_odds": -115, "total_under_odds": -105, "updated_at": "2026-10-04T14:48:01.481Z"}
    kalshi = {"id": 2, "game_id": 101, "vendor": "kalshi", "moneyline_home_odds": 141,
              "moneyline_away_odds": -150, "updated_at": "2026-10-04T14:52:46.334Z"}
    odds = bdl.parse_odds([row, kalshi], NOW)
    assert len(odds) == 6 + 2
    for _, grp in odds.groupby(["game_id", "vendor", "market"]):
        assert grp["prob"].sum() == pytest.approx(1.0)
    total = odds[(odds.market == "total") & (odds.side == "over")].iloc[0]
    assert total["line"] == 242.5 and total["price_american"] == -115


def test_parse_odds_opening_uses_opened_at():
    row = {"game_id": 100, "vendor": "dk", "total_value": "236.5", "total_over_odds": -110,
           "total_under_odds": -110, "opened_at": "2026-08-11T15:53:01.249Z"}
    odds = bdl.parse_odds([row], NOW, is_opening=True)
    assert odds["is_opening"].all() and odds.loc[0, "ts"] == pd.Timestamp("2026-08-11T15:53:01.249Z")


# ---------------------------------------------------------------- jobs end to end

def test_backfill_writes_all_tables_and_is_idempotent(con):
    def routes():
        return {
            ("/v1/teams", None): FakeResponse(200, {"data": [
                {"id": 1, "abbreviation": "DEN", "city": "Denver", "name": "Nuggets",
                 "full_name": "Denver Nuggets", "conference": "West", "division": "Northwest"}]}),
            ("/v1/games", None): FakeResponse(200, {"data": [GAME], "meta": {}}),
            ("/v1/stats", None): FakeResponse(200, {"data": [stat_row(7, "34"), stat_row(8, "00")],
                                                    "meta": {"next_cursor": 2}}),
            ("/v1/stats", 2): FakeResponse(200, {"data": [stat_row(9, "12")], "meta": {}}),
            ("/nba/v2/stats/advanced", None): FakeResponse(200, {"data": [
                {"id": 1, "period": 0, "usage_percentage": 0.3, "player": PLAYER, "team": {"id": 1},
                 "game": GAME}], "meta": {}}),
            ("/v1/players/active", None): FakeResponse(200, {"data": [PLAYER], "meta": {}}),
        }
    c, _, _ = client(routes())
    counts = bdl.backfill(con, c, [2025], schedule_season=None, echo=lambda _: None)
    assert counts["game_logs_2025"] == 3 and counts["advanced_2025"] == 1
    first = store.table_counts(con).set_index("table")["rows"]
    c2, sess2, _ = client(routes())
    bdl.backfill(con, c2, [2025], schedule_season=None, echo=lambda _: None)
    assert store.table_counts(con).set_index("table")["rows"].drop("ingest_runs").equals(
        first.drop("ingest_runs"))
    # Cached season pages were replayed: only teams + active players hit the network again.
    assert {p for p, _ in sess2.calls} == {"/v1/teams", "/v1/players/active"}
    assert con.execute("SELECT full_name FROM players WHERE player_id=7").fetchone()[0] == "Nikola Jokić"


def test_sync_odds_stores_live_and_opening(con):
    row = {"game_id": 100, "vendor": "dk", "moneyline_home_odds": -125, "moneyline_away_odds": 105,
           "updated_at": "2026-10-04T14:48:01Z"}
    c, sess, _ = client({
        ("/nba/v2/odds", None): FakeResponse(200, {"data": [row], "meta": {}}),
        ("/nba/v2/odds/opening", None): FakeResponse(200, {"data": [
            {**row, "opened_at": "2026-08-11T00:00:00Z"}], "meta": {}}),
    })
    assert bdl.sync_odds(con, c, [date(2026, 10, 21)]) == 4
    assert sess.calls[0][1]["dates[]"] == ["2026-10-21"]


def test_an_empty_window_writes_nothing_instead_of_failing(con):
    """The night before opening night: no box scores, no advanced rows, no injuries."""
    empty = FakeResponse(200, {"data": [], "meta": {}})
    c, _, _ = client({(bdl.EP_STATS, None): empty, (bdl.EP_ADVANCED, None): empty,
                      (bdl.EP_INJURIES, None): empty})
    window = {"start_date": "2026-10-16", "end_date": "2026-10-19"}
    assert bdl.sync_stats(con, c, window, use_cache=False) == 0
    assert bdl.sync_advanced(con, c, window, use_cache=False) == 0
    assert bdl.sync_injuries(con, c) == 0

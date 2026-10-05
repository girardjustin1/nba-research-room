"""End to end: GET /season/week/probability on a scratch store with a mid-season week."""
from __future__ import annotations

from datetime import date, datetime, timedelta

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from research_room import api, matchup, store
from research_room.projections.baseline import STATS
from tests.test_matchup import POS

WEEK2 = [date(2026, 11, 2) + timedelta(days=i) for i in range(7)]
NOW = "2026-11-04T12:00:00-05:00"


def _seed(con, with_matchup=True):
    t = pd.Timestamp("2026-11-04T09:00:00-05:00")                     # matchup.csv read Wed morning
    meta = {"source": "test", "fetched_at": t}
    games = [{"game_id": i + 1, "season": 2026, "game_date": d, "tip_utc": pd.Timestamp(f"{d} 23:30:00+00"),
              "postseason": False, "home_team_id": 1, "visitor_team_id": 2, **meta}
             for i, d in enumerate(WEEK2)]
    store.upsert(con, "games", pd.DataFrame(games))
    ros = []
    for team, start in ((11, 1), (3, 101)):
        for i in range(12):
            ros.append({"snapshot_at": t, "team_id": team, "yahoo_player_key": f"k{start + i}",
                        "player_name": f"Invented {start + i}", "player_id": start + i,
                        "selected_slot": "BN" if i >= 10 else POS[i % len(POS)],
                        "eligible_positions": POS[i % len(POS)], "status": None, **meta})
    store.upsert(con, "yahoo_rosters", pd.DataFrame(ros))
    store.upsert(con, "yahoo_teams", pd.DataFrame({"snapshot_at": t, "team_id": [3, 11],
                                                   "team_name": ["Invented Rival", "Me"], **meta}))
    if with_matchup:
        tot = {"fg_pct": 0.47, "ft_pct": 0.78, "fg3m": 20, "pts": 180, "reb": 70, "ast": 40, "stl": 12,
               "blk": 8, "tov": 22}
        store.upsert(con, "yahoo_matchups", pd.DataFrame([
            {"snapshot_at": t, "week": 2, "team_id": 11, "opponent_team_id": 3, **tot, **meta},
            {"snapshot_at": t, "week": 2, "team_id": 3, "opponent_team_id": 11, **tot, "pts": 160, **meta}]))
    base = {"pts": 15, "reb": 6, "ast": 4, "stl": 1, "blk": 0.6, "fg3m": 1.6, "tov": 1.8, "fgm": 5.5,
            "fga": 12, "ftm": 2.5, "fta": 3.2, "minutes": 30}
    run = pd.Timestamp("2026-11-03T23:40:00Z")
    proj = [{"model": "baseline", "run_at": run, "player_id": pid, "date": d, "stat": s, "mean": base[s],
             "sd": (1.3 * base[s]) ** 0.5}
            for pid in [*range(1, 13), *range(101, 113)] for d in WEEK2 if d.weekday() % 2 == pid % 2
            for s in (*STATS, "minutes")]
    store.upsert(con, "projections", pd.DataFrame(proj))


@pytest.fixture
def client(tmp_path):
    db = tmp_path / "week.duckdb"
    con = store.connect(db)
    _seed(con)
    con.close()
    return TestClient(api.create_app(db_path=str(db), run_mock_thread=False)), db


def test_probability_endpoint_end_to_end(client):
    c, db = client
    r = c.get("/season/week/probability", params={"now": NOW})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["week"]["week"] == 2 and j["opponent"]["name"] == "Invented Rival"
    assert j["history"][-1]["event"] is None and 0 < j["current"]["p_win_week"] < 1
    assert j["history"][-1]["cats_lead"]["me"] >= 1                    # +20 PTS so far
    dn = j["scenarios"][0]
    assert dn["kind"] == "do_nothing" and dn["delta_vs_do_nothing"] is None
    assert [p["ts"][:10] for p in dn["points"][1:]] == [str(d) for d in WEEK2[2:]]   # Wed..Sun
    assert dn["points"][0]["p_win_week"] == j["current"]["p_win_week"]
    assert dn["final"]["hi"] - dn["final"]["lo"] > dn["points"][1]["hi"] - dn["points"][1]["lo"]
    assert {p["module"] for p in j["provenance"]} == {"projections", "simulate", "yahoo"}

    con = store.connect(db)
    out = matchup.snapshot(con, now=datetime.fromisoformat(NOW))
    con.close()
    assert out["week"] == 2
    j2 = c.get("/season/week/probability", params={"now": "2026-11-05T12:00:00-05:00"}).json()
    assert j2["history"][0]["event"]["kind"] == "nightly"
    assert j2["current"]["delta_since_yesterday"] is not None


def test_probability_says_what_is_missing(tmp_path):
    db = tmp_path / "empty.duckdb"
    con = store.connect(db)
    _seed(con, with_matchup=False)
    con.close()
    c = TestClient(api.create_app(db_path=str(db), run_mock_thread=False))
    r = c.get("/season/week/probability", params={"now": NOW})
    assert r.status_code == 409 and "matchup.csv" in r.json()["detail"]

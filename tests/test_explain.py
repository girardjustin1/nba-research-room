from __future__ import annotations

from datetime import date, datetime

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from research_room import api, store
from research_room.ingest.market_common import ET
from research_room.projections import explain
from tests.test_week_probability import NOW, _free_agents, _seed


def test_teammates_out_is_its_own_step_and_it_still_adds_up():
    avg = {"pts": 20.0, "minutes": 30.0}
    # stored: 34 min when playing (x1.10 from teammates out), points mean 24 (x1.20 from it)
    wf = explain.waterfall("pts", avg, 0.9, 34.0, 24.0, 24.0, False, 1.10, 1.20, ["A One", "B Two"])
    steps = {d["feature"]: d for d in wf["drivers"]}
    assert sum(d["contribution"] for d in wf["drivers"]) + wf["base_value"] == pytest.approx(24.0)
    assert steps["teammates"]["contribution"] == pytest.approx(24.0 - 24.0 / 1.2)
    assert steps["minutes"]["value_label"].startswith(f"{34.0 / 1.1:.1f}")      # his own minutes
    assert "out: A One, B Two" in steps["teammates"]["value_label"]
    plain = explain.waterfall("pts", avg, 0.9, 34.0, 24.0, 24.0, False)
    assert "teammates" not in {d["feature"] for d in plain["drivers"]}


def test_waterfall_adds_up_exactly():
    avg = {"pts": 30.0, "minutes": 35.0}
    wf = explain.waterfall(
        "pts", avg, p_play=0.8, minutes_cond=33.0, model_mean=25.0, final_mean=26.5, market=True
    )
    assert wf["base_value"] + sum(d["contribution"] for d in wf["drivers"]) == pytest.approx(26.5)
    assert [d["feature"] for d in wf["drivers"]] == ["availability", "minutes", "rate", "market"]
    assert wf["drivers"][0]["contribution"] == pytest.approx(-6.0)  # 30 x (0.8 - 1)
    assert explain.waterfall("pts", {}, 0.8, 33, 25, 25, False) is None  # no history: no waterfall


@pytest.fixture
def week_db(tmp_path):
    db = tmp_path / "week.duckdb"
    con = store.connect(db)
    _seed(con)
    meta = {"source": "test", "fetched_at": pd.Timestamp(NOW)}
    store.upsert(
        con,
        "players",
        pd.DataFrame(
            [
                {
                    "player_id": pid,
                    "full_name": f"Invented {pid}",
                    "position": "G",
                    "team_id": 1 if pid < 100 else 2,
                    **meta,
                }
                for pid in [*range(1, 13), *range(101, 113), 201, 202, 203, 204]
            ]
        ),
    )
    logs = [
        {
            "game_id": 9000 + i,
            "player_id": 1,
            "team_id": 1,
            "season": 2025,
            "game_date": date(2026, 3, 1 + i),
            "minutes": 30.0,
            "did_play": True,
            "pts": 20.0,
            "reb": 5.0,
            "ast": 4.0,
            "stl": 1.0,
            "blk": 0.5,
            "fg3m": 2.0,
            "tov": 2.0,
            "fgm": 7.0,
            "fga": 15.0,
            "ftm": 4.0,
            "fta": 5.0,
            **meta,
        }
        for i in range(12)
    ]
    store.upsert(con, "game_logs", pd.DataFrame(logs))
    con.execute("UPDATE projections SET p_play = 0.9, minutes_mean = 27.0, model_mean = mean, market = false")
    store.upsert(
        con,
        "status_events",
        pd.DataFrame(
            [
                {
                    "event_id": "p1:1",
                    "player_id": 1,
                    "team_id": 1,
                    "status": "Questionable",
                    "minutes_cap": 24.0,
                    "starting": None,
                    "confidence": 0.9,
                    "account": "invented_beat",
                    "authority_rank": 3,
                    "ts": pd.Timestamp("2026-11-04T16:00:00Z"),
                    **meta,
                }
            ]
        ),
    )
    con.close()
    return db


def test_player_analysis_explains_the_projection(week_db):
    con = store.connect(week_db)
    out = explain.player_analysis(con, 1, now=datetime.fromisoformat(NOW).astimezone(ET))
    kinds = [f["kind"] for f in out["factors"]]
    assert kinds[:2] == ["projection", "minutes"] and "news" in kinds and "drivers" in kinds
    wf = next(f for f in out["factors"] if f["kind"] == "drivers")["detail"]
    first = next(f for f in out["factors"] if f["kind"] == "projection")["detail"]["per_game"]
    pts = next(c for c in first if c["key"] == "pts")["mean"]
    assert wf["base_value"] + sum(d["contribution"] for d in wf["drivers"]) == pytest.approx(pts)
    news = next(f for f in out["factors"] if f["kind"] == "news")
    assert "Questionable" in news["reading"] and "minutes limit 24" in news["reading"]


def test_endpoint_gives_advice_when_the_week_exists(week_db):
    con = store.connect(week_db)
    _free_agents(con)
    con.close()
    c = TestClient(api.create_app(db_path=str(week_db), run_mock_thread=False))
    mine = c.get("/season/players/1", params={"now": NOW}).json()
    assert mine["recommendation"]["action"] in ("start", "bench", "drop")
    assert any(f["kind"] == "schedule" for f in mine["factors"])
    added = c.get("/season/moves", params={"now": NOW}).json()["moves"][0]["player"]["player_id"]
    fa = c.get(f"/season/players/{added}", params={"now": NOW}).json()
    assert fa["recommendation"]["action"] == "add" and fa["recommendation"]["move_id"]
    assert c.get("/season/players/999999999").status_code == 404

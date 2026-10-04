from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from research_room import api
from research_room.config import settings
from research_room.draft import tracker
from tests.test_board import make_pool


@pytest.fixture
def client(tmp_path, monkeypatch):
    s = settings()
    cfg = s.model_copy(update={"league": s.league.model_copy(update={"teams": 4}),
                               "draft": s.draft.model_copy(update={"rounds": 5, "pool_size": 60})})
    db = str(tmp_path / "api.duckdb")

    def fake_start(draft_id, my_slot, punts, cfg_=None, db_path=None):
        sess = api.Session(draft_id, cfg, make_pool(), 3.1, set(punts),
                           tracker.new_state(draft_id, cfg, my_slot))
        sess.rebuild()
        return sess

    monkeypatch.setattr(api, "start_session", fake_start)
    return TestClient(api.create_app(db_path=db))


def test_board_needs_a_session_and_a_slot(client):
    assert client.get("/draft/board").status_code == 409
    client.post("/draft/session", json={"draft_id": "mock"})
    r = client.get("/draft/board")
    assert r.status_code == 409 and "slot" in r.json()["detail"]
    assert client.put("/draft/slot", json={"my_slot": 9}).status_code == 400
    assert client.put("/draft/slot", json={"my_slot": 2}).json()["my_slot"] == 2


def test_full_flow_pick_board_undo(client):
    s = client.post("/draft/session", json={"draft_id": "mock", "my_slot": 2}).json()
    assert (s["current_pick"], s["on_the_clock"], s["my_picks"][:2]) == (1, 1, [2, 7])
    board = client.get("/draft/board").json()
    assert board["decision_pick"] == 2 and len(board["recommendations"]) == 10
    top = board["recommendations"][0]
    assert {"gain", "p_win_week", "reasons", "p_available_next"} <= set(top)

    # Another team takes our top player by name (as the Tampermonkey listener would).
    s = client.post("/draft/pick", json={"player_name": top["name"], "source": "listener"}).json()
    assert s["current_pick"] == 2 and s["picks"][0]["player_id"] == top["player_id"]
    board = client.get("/draft/board").json()
    assert top["player_id"] not in {r["player_id"] for r in board["recommendations"]}

    mine = board["recommendations"][0]["player_id"]
    client.post("/draft/pick", json={"player_id": mine})
    roster = client.get("/draft/board").json()["my_team"]["roster"]
    assert [p["player_id"] for p in roster] == [mine]

    s = client.post("/draft/undo").json()
    assert s["current_pick"] == 2 and len(s["picks"]) == 1


def test_pick_errors_are_readable(client):
    client.post("/draft/session", json={"draft_id": "mock", "my_slot": 1})
    assert client.post("/draft/pick", json={}).status_code == 400
    r = client.post("/draft/pick", json={"player_name": "Nobody Atall"})
    assert r.status_code == 409 and "could not match" in r.json()["detail"]["error"]
    client.post("/draft/pick", json={"player_id": 1})
    r = client.post("/draft/pick", json={"player_id": 1})
    assert r.status_code == 409 and "already drafted" in r.json()["detail"]


def test_punts_rebuild_values(client):
    client.post("/draft/session", json={"draft_id": "mock", "my_slot": 1})
    assert client.put("/draft/punts", json={"punts": ["bogus"]}).status_code == 400
    s = client.put("/draft/punts", json={"punts": ["ft_pct"]}).json()
    assert s["punts"] == ["ft_pct"]


def test_players_search_and_rosters(client):
    client.post("/draft/session", json={"draft_id": "mock", "my_slot": 1})
    client.post("/draft/pick", json={"player_id": 5})
    names = [p["name"] for p in client.get("/draft/players", params={"q": "P1"}).json()["players"]]
    assert names and all("P1" in n for n in names)
    every = client.get("/draft/players", params={"available_only": False}).json()["players"]
    assert any(p["drafted"] for p in every)
    assert client.get("/draft/rosters").json()["teams"]["1"][0]["player_id"] == 5


def test_cors_allows_the_local_apps_and_the_draft_room(client):
    for origin in ("http://localhost:5173", "https://basketball.fantasysports.yahoo.com"):
        r = client.options("/health", headers={"Origin": origin, "Access-Control-Request-Method": "GET"})
        assert r.headers.get("access-control-allow-origin") == origin
    r = client.options("/health", headers={"Origin": "https://evil.example",
                                           "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in r.headers


def test_board_returns_per_category_change(client):
    client.post("/draft/session", json={"draft_id": "mock", "my_slot": 1})
    rec = client.get("/draft/board").json()["recommendations"][0]
    keys = [f"dp_{k}" for k in ("fg_pct", "ft_pct", "fg3m", "pts", "reb", "ast", "stl", "blk", "tov")]
    assert all(isinstance(rec[k], float) for k in keys)

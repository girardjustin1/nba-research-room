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

    def fake_start(draft_id, my_slot, punts, cfg=None, db_path=None, mock=None):
        use = cfg or base_cfg
        use = use.model_copy(update={"draft": base_cfg.draft})
        sess = api.Session(draft_id, use, make_pool(), 3.1, set(punts),
                           tracker.new_state(draft_id, use, my_slot), mock=mock)
        sess.rebuild()
        return sess

    base_cfg = cfg
    monkeypatch.setattr(api, "start_session", fake_start)
    return TestClient(api.create_app(db_path=db, run_mock_thread=False))


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


def test_team_names_teams_view_and_removing_a_pick(client):
    client.post("/draft/session", json={"draft_id": "league", "my_slot": 2})
    s = client.put("/draft/teams/names", json={"names": {"1": "Splash Bros", "3": "Glass Cleaners"}}).json()
    assert s["team_names"]["1"] == "Splash Bros" and s["team_names"]["2"] == "You"
    assert client.put("/draft/teams/names", json={"names": {"9": "x"}}).status_code == 400
    for pid in (1, 2, 3):
        client.post("/draft/pick", json={"player_id": pid})
    teams = client.get("/draft/teams").json()
    t1 = teams["teams"][0]
    assert t1["name"] == "Splash Bros" and [p["player_id"] for p in t1["roster"]] == [1]
    assert sum(t1["position_counts"].values()) == 1 and t1["next_pick"] == 8
    assert teams["teams"][1]["is_me"]
    # Correct pick 2 (not the last one): remove it, the hole becomes the current pick.
    s = client.delete("/draft/pick/2").json()
    assert s["current_pick"] == 2 and [p["pick_no"] for p in s["picks"]] == [1, 3]
    assert client.delete("/draft/pick/2").status_code == 409
    s = client.post("/draft/pick", json={"player_id": 9, "pick_no": 2, "team_id": 2}).json()
    assert [p["player_id"] for p in s["picks"]] == [1, 9, 3]


def test_positional_value_compare_and_player_ranks(client):
    client.post("/draft/session", json={"draft_id": "league", "my_slot": 1})
    pv = client.get("/draft/positional_value").json()
    assert [r["pos"] for r in pv["positions"]] == ["PG", "SG", "SF", "PF", "C"]
    assert max(r["scale_0_1"] for r in pv["positions"]) == 1.0
    assert all(r["best_available"]["value"] >= 0 for r in pv["positions"])
    players = client.get("/draft/players").json()["players"]
    assert {"pos_rank", "adp_rank", "adp_pos_rank"} <= set(players[0])
    first_pg = min((p for p in players if p["position"] == "PG"), key=lambda p: p["pos_rank"])
    assert first_pg["pos_rank"] == 1
    cmp = client.get("/draft/compare", params={"ids": "1,2"}).json()["players"]
    assert [p["player_id"] for p in cmp] == [1, 2]
    assert {"pts_mean", "fga_mean", "z_fg_pct", "gain", "p_available_next"} <= set(cmp[0])
    assert client.get("/draft/compare", params={"ids": "1,99999"}).status_code == 404


def test_mock_mode_uses_bots_and_never_the_real_store(client, tmp_path):
    s = client.post("/draft/mock", json={"teams": 4, "my_slot": 2, "speed_s": 0.1, "seed": 3}).json()
    assert s["mode"] == "mock" and s["teams"] == 4 and s["team_names"]["1"] == "Bot 1"
    app = client.app
    import time as _t
    _t.sleep(0.15)
    assert app.state.tick() is True                       # bot in slot 1 picks
    assert app.state.tick() is False                      # my turn: bots wait for me
    assert client.post("/draft/mock/pause").json()["mock"]["paused"]
    s = client.post("/draft/mock/pick-now").json()        # I take the board's #1
    assert s["current_pick"] == 3
    s = client.post("/draft/mock/finish").json()
    assert s["current_pick"] is None and s["mock"]["finished"] and len(s["picks"]) == 20
    assert len({p["player_id"] for p in s["picks"]}) == 20
    # Nothing reached the on-disk store.
    from research_room import store
    con = store.connect(str(tmp_path / "api.duckdb"))
    assert con.execute("SELECT count(*) FROM draft_picks").fetchone()[0] == 0
    assert client.post("/draft/mock/speed", json={"speed_s": 999}).status_code == 400


def test_pick_insights_describe_each_drafting_team(client):
    client.post("/draft/session", json={"draft_id": "league", "my_slot": 2})
    client.put("/draft/teams/names", json={"names": {"1": "Splash Bros"}})
    for pid in (1, 2, 3):
        client.post("/draft/pick", json={"player_id": pid})
    d = client.get("/draft/insights", params={"last": 2}).json()
    assert [i["pick_no"] for i in d["insights"]] == [3, 2]
    first = client.get("/draft/insights", params={"last": 3}).json()["insights"][-1]
    assert first["team_name"] == "Splash Bros" and first["player"]["player_id"] == 1
    assert len(first["strengths"]) == 2 and len(first["weaknesses"]) == 2
    cats = {"fg_pct", "ft_pct", "fg3m", "pts", "reb", "ast", "stl", "blk", "tov"}
    assert set(first["p_vs_league_avg"]) == cats
    assert 0 <= first["vs_me"]["p_win_week"] <= 1 and first["notes"][0].startswith("Needs")
    mine = next(i for i in d["insights"] if i["team_id"] == 2)
    assert mine["vs_me"] is None                    # no head-to-head against myself


def test_pick_owners_my_slots_and_compare_percentages(client):
    s = client.post("/draft/session", json={"draft_id": "league", "my_slot": 2}).json()
    assert s["pick_owners"][:8] == [1, 2, 3, 4, 4, 3, 2, 1] and len(s["pick_owners"]) == 20
    client.post("/draft/pick", json={"player_id": 1})
    client.post("/draft/pick", json={"player_id": 2})
    team = client.get("/draft/board").json()["my_team"]
    assert len(team["slots"]) == 10 and sum(x["player_id"] == 2 for x in team["slots"]) == 1
    cmp = client.get("/draft/compare", params={"ids": "3"}).json()["players"][0]
    assert cmp["fg_pct_mean"] == pytest.approx(cmp["fgm_mean"] / cmp["fga_mean"])

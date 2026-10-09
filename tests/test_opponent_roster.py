"""This week's opponent entered by hand: matching, one opponent replaced weekly, never in the
database, merged into the live Yahoo tables only when Yahoo didn't supply him. Invented names."""

from __future__ import annotations

from datetime import UTC, datetime

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from research_room import api, opponent_roster, store
from research_room.config import settings

NOW = datetime(2026, 11, 4, 17, 0, tzinfo=UTC)  # a Wednesday in the season
META = {"source": "test", "fetched_at": pd.Timestamp(NOW)}


@pytest.fixture
def cfg(tmp_path, monkeypatch):
    c = settings()
    c = c.model_copy(update={"paths": c.paths.model_copy(update={"inbox_dir": tmp_path})})
    monkeypatch.setattr(opponent_roster, "_path", lambda cfg=None: tmp_path / "opponent.json")
    monkeypatch.setattr(opponent_roster, "_names_path", lambda cfg=None: tmp_path / "league_teams.json")
    monkeypatch.setattr(opponent_roster, "_mine_path", lambda cfg=None: tmp_path / "my_roster.json")
    return c


@pytest.fixture
def nba(con):
    store.upsert(
        con,
        "teams",
        pd.DataFrame(
            [{"team_id": t, "abbreviation": a, "full_name": a, **META} for t, a in ((1, "BOS"), (2, "MIA"))]
        ),
    )
    store.upsert(
        con,
        "players",
        pd.DataFrame(
            [
                {"player_id": i, "full_name": n, "team_id": t, "position": p, **META}
                for i, n, t, p in (
                    (1, "Invented Guard", 1, "G"),
                    (2, "Made Up Center", 2, "C"),
                    (3, "Pretend Forward", 2, "F"),
                    (4, "Retired Somebody", None, "F"),
                )
            ]
        ),
    )
    return con


def test_save_matches_names_reports_misses_and_keeps_nothing_in_the_database(nba, cfg, tmp_path):
    opp = 5 if settings().league.my_team_id != 5 else 6
    out = opponent_roster.save(nba, opp, [1], ["made up center", "Nobody Atall"], cfg, NOW)
    assert out["opponent_team_id"] == opp and [p["player_id"] for p in out["players"]] == [1, 2]
    assert out["players"][1]["eligible"] == ["C", "Util"] and out["players"][1]["owner"] == "opponent"
    assert out["unmatched"][0]["name"] == "Nobody Atall"
    assert (tmp_path / "opponent.json").exists()
    tables = [
        r[0] for r in nba.execute("SELECT table_name FROM duckdb_tables() WHERE NOT temporary").fetchall()
    ]
    assert not [t for t in tables if "opponent" in t]
    again = opponent_roster.save(nba, opp, [3], [], cfg, NOW)  # replaced, not added to
    assert [p["player_id"] for p in again["players"]] == [3]


def test_an_entry_for_another_week_is_not_shown(nba, cfg):
    opp = 5 if settings().league.my_team_id != 5 else 6
    this = opponent_roster.save(nba, opp, [1, 2], [], cfg, NOW)["week"]["week"]
    next_week = datetime(2026, 11, 10, 17, 0, tzinfo=UTC)
    out = opponent_roster.response(nba, cfg, next_week)
    assert out["players"] == [] and out["opponent_team_id"] is None and out["week"]["week"] == this + 1


def test_my_own_team_and_unknown_teams_are_refused(nba, cfg):
    with pytest.raises(ValueError):
        opponent_roster.save(nba, settings().league.my_team_id, [1], [], cfg, NOW)
    with pytest.raises(ValueError):
        opponent_roster.save(nba, 99, [1], [], cfg, NOW)


def test_the_entry_fills_in_only_what_yahoo_did_not_supply(nba, cfg):
    me = settings().league.my_team_id
    opp = 5 if me != 5 else 6
    opponent_roster.save(nba, opp, [2, 3], [], cfg, NOW)
    out = opponent_roster.apply(nba, cfg, NOW)
    assert out == {"applied": True, "roster": True, "pairing": True}
    roster = nba.execute("SELECT player_id FROM yahoo_rosters WHERE team_id = ? ORDER BY 1", [opp]).fetchall()
    assert roster == [(2,), (3,)]
    pair = nba.execute("SELECT team_id, opponent_team_id, source FROM yahoo_matchups ORDER BY 1").fetchall()
    assert sorted(pair) == sorted([(me, opp, "manual"), (opp, me, "manual")])
    assert opponent_roster.apply(nba, cfg, NOW) == {"applied": True, "roster": False, "pairing": False}


def test_routes(tmp_path, monkeypatch, cfg):
    db = tmp_path / "api.duckdb"
    c = store.connect(db)
    store.upsert(
        c,
        "players",
        pd.DataFrame(
            [{"player_id": 1, "full_name": "Invented Guard", "team_id": 1, "position": "G", **META}]
        ),
    )
    c.close()
    client = TestClient(api.create_app(db_path=str(db), run_mock_thread=False))
    found = client.get("/season/player_search", params={"q": "inven"}).json()["players"]
    assert [p["name"] for p in found] == ["Invented Guard"]
    opp = 5 if settings().league.my_team_id != 5 else 6
    r = client.post(
        "/season/opponent_roster",
        params={"now": NOW.isoformat()},
        json={"team_id": opp, "player_ids": [1], "names": []},
    )
    assert r.status_code == 200 and r.json()["players"][0]["name"] == "Invented Guard"
    got = client.get("/season/opponent_roster", params={"now": NOW.isoformat()}).json()
    assert got["opponent_team_id"] == opp
    assert "never in the database" in got["policy"] and "one opponent" in got["policy"]
    bad = client.post("/season/opponent_roster", json={"team_id": settings().league.my_team_id})
    assert bad.status_code == 422


def test_teams_are_registered_by_name_and_renamed_or_cleared(nba, cfg, tmp_path):
    me = settings().league.my_team_id
    opp = 5 if me != 5 else 6
    out = opponent_roster.save(nba, opp, [1], [], cfg, NOW, team_name="  Invented   Rivals ")
    team = next(t for t in out["teams"] if t["team_id"] == opp)
    assert team == {"team_id": opp, "label": "Invented Rivals", "name": "Invented Rivals"}
    assert me not in [t["team_id"] for t in out["teams"]]
    opponent_roster.set_team_names({opp: "Renamed Club", 2: "Second Invented"}, cfg)
    assert opponent_roster.team_names(cfg) == {2: "Second Invented", opp: "Renamed Club"}
    opponent_roster.set_team_names({2: ""}, cfg)  # blank clears
    labels = {t["team_id"]: t["label"] for t in opponent_roster.response(nba, cfg, NOW)["teams"]}
    assert labels[2] == "Team 2" and labels[opp] == "Renamed Club"
    with pytest.raises(ValueError):
        opponent_roster.set_team_names({me: "Mine"}, cfg)
    assert not (tmp_path / "league_teams.json").read_text().count("player")  # names only, no rosters


def test_the_names_route(tmp_path, cfg):
    db = tmp_path / "names.duckdb"
    store.connect(db).close()
    client = TestClient(api.create_app(db_path=str(db), run_mock_thread=False))
    opp = 5 if settings().league.my_team_id != 5 else 6
    r = client.post(
        "/season/league_team_names", json={"teams": [{"team_id": opp, "name": "Invented Rivals"}]}
    )
    assert r.status_code == 200
    assert next(t for t in r.json()["teams"] if t["team_id"] == opp)["label"] == "Invented Rivals"
    bad = client.post("/season/league_team_names", json={"teams": [{"team_id": 99, "name": "x"}]})
    assert bad.status_code == 422


def test_my_roster_saves_marks_il_and_fills_in_only_without_yahoo(nba, cfg):
    me = settings().league.my_team_id
    out = opponent_roster.save_mine(nba, [1, 3], ["made up center", "Nobody Atall"], [3, 99], cfg, NOW)
    assert [p["player_id"] for p in out["players"]] == [1, 3, 2] and out["il_ids"] == [3]
    assert out["players"][0]["owner"] == "mine" and out["unmatched"][0]["name"] == "Nobody Atall"
    assert opponent_roster.apply_mine(nba, cfg) == {"applied": True, "players": 3}
    rows = dict(
        nba.execute("SELECT player_id, selected_slot FROM yahoo_rosters WHERE team_id = ?", [me]).fetchall()
    )
    assert rows == {1: None, 2: None, 3: "IL"}
    assert opponent_roster.apply_mine(nba, cfg)["applied"] is False  # Yahoo's (or mine) already there
    with pytest.raises(ValueError):
        opponent_roster.save_mine(nba, list(range(1, 40)), [], [], cfg, NOW)


def test_my_roster_routes(tmp_path, cfg):
    db = tmp_path / "mine.duckdb"
    c = store.connect(db)
    store.upsert(
        c,
        "players",
        pd.DataFrame(
            [{"player_id": 1, "full_name": "Invented Guard", "team_id": 1, "position": "G", **META}]
        ),
    )
    c.close()
    client = TestClient(api.create_app(db_path=str(db), run_mock_thread=False))
    assert client.get("/season/my_roster").json()["players"] == []
    r = client.post("/season/my_roster", json={"player_ids": [1], "names": [], "il_ids": [1]})
    assert (
        r.status_code == 200 and r.json()["il_ids"] == [1] and "never in the database" in r.json()["policy"]
    )

"""Yahoo positions read from the owner's pastes (yahoo_positions.py): the "TEAM - PG,SG" tag after a
name, kept as ids and positions, used by the draft board and the roster cards. Invented names."""

from __future__ import annotations

from datetime import UTC, datetime

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from research_room import api, free_agents, opponent_roster, store, yahoo_positions
from research_room.config import settings
from research_room.draft import eligibility

NOW = datetime(2026, 10, 12, 17, 0, tzinfo=UTC)
META = {"source": "test", "fetched_at": pd.Timestamp(NOW)}
PAGE = """Players
Pos  Player  Owner  GP*  Pre-Season  Current  % Ros
Invented Guard  BOS - PG,SG  FA  12  58  71  14%
Made Up Center
MIA - C   W (Oct 14)
Twin Name  MIA - SF
Pretend Forward  MIA - F
"""


@pytest.fixture
def cfg(tmp_path, monkeypatch):
    c = settings()
    c = c.model_copy(update={"paths": c.paths.model_copy(update={"inbox_dir": tmp_path})})
    monkeypatch.setattr(opponent_roster, "_mine_path", lambda cfg=None: tmp_path / "my_roster.json")
    monkeypatch.setattr(free_agents, "load_aliases", lambda: [])
    return c


def seed(con):
    store.upsert(con, "teams", pd.DataFrame(
        [{"team_id": t, "abbreviation": a, "full_name": a, **META} for t, a in ((1, "BOS"), (2, "MIA"))]))
    store.upsert(con, "players", pd.DataFrame([
        {"player_id": i, "full_name": n, "team_id": t, "position": p, **META}
        for i, n, t, p in ((1, "Invented Guard", 1, "G"), (2, "Made Up Center", 2, "C"),
                           (3, "Pretend Forward", 2, "F"), (5, "Twin Name", 1, "G"), (7, "Twin Name", 2, "F"))
    ]))
    return con


@pytest.fixture
def nba(con):
    return seed(con)


def test_parse_keeps_base_positions_in_roster_order():
    assert yahoo_positions.parse("SG,PG") == ["PG", "SG"]
    assert yahoo_positions.parse("G") == ["PG", "SG"] and yahoo_positions.parse("F") == ["SF", "PF"]
    assert yahoo_positions.parse("PF, C") == ["PF", "C"]
    tags = yahoo_positions.TAG.finditer("Curry  GS - PG,SG  then  NY - C")
    assert [m.group(1) for m in tags] == ["PG,SG", "C"]
    assert not yahoo_positions.TAG.search("Player Note - see notes")


def test_a_tag_goes_to_the_player_before_it_even_on_the_next_line(nba):
    found = free_agents.find_positions(nba, PAGE)
    assert found == {1: ["PG", "SG"], 2: ["C"], 3: ["SF", "PF"]}            # Twin Name: shared, skipped


def test_merge_adds_to_the_list_and_newer_positions_win(cfg):
    assert yahoo_positions.merge({1: ["PG"], 2: ["C"]}, cfg, NOW) == 2
    assert yahoo_positions.merge({1: ["PG", "SG"]}, cfg, NOW) == 1
    assert yahoo_positions.positions(cfg) == {1: ["PG", "SG"], 2: ["C"]}
    assert yahoo_positions.merge({}, cfg, NOW) == 0
    assert yahoo_positions.response(cfg)["players"] == 2


def test_the_free_agent_paste_keeps_its_tags(nba, cfg, tmp_path, monkeypatch):
    monkeypatch.setattr(free_agents, "_path", lambda cfg=None: tmp_path / "free_agents.json")
    out = free_agents.save(nba, PAGE, cfg, NOW)
    assert yahoo_positions.positions(cfg)[3] == ["SF", "PF"]
    assert {p["player_id"]: p["eligible"] for p in out["players"]}[1] == ["PG", "SG", "Util"]


def test_roster_names_pasted_with_their_tag_match_and_keep_the_positions(nba, cfg):
    out = opponent_roster.save_mine(nba, [], ["Invented Guard  BOS - SG", "Made Up Center"], [], cfg, NOW)
    cards = {p["player_id"]: p["eligible"] for p in out["players"]}
    assert cards == {1: ["SG", "Util"], 2: ["C", "Util"]}                  # untagged: the NBA's position
    assert out["unmatched"] == []
    assert yahoo_positions.positions(cfg) == {1: ["SG"]}


def test_the_board_uses_pasted_positions_where_yahoo_has_none(nba):
    yahoo_positions.merge({1: ["SG"], 2: ["C"]})
    pool = pd.DataFrame({"player_id": [1, 2, 3], "position": ["PG", "C", "SF"]})
    yahoo = pd.DataFrame({"player_id": [2], "yahoo_positions": [["PF", "C"]]})       # Yahoo's own row wins
    got = eligibility.resolve(pool, eligibility.add_pasted(yahoo), settings())
    assert list(got["positions"]) == ["SG", "PF,C", "SF"]
    assert list(got["eligibility_source"]) == ["yahoo", "yahoo", "bbm"]
    assert eligibility.add_pasted(None)["player_id"].tolist() == [1, 2]


def test_routes(tmp_path):
    db = tmp_path / "pos.duckdb"
    c = store.connect(db)
    seed(c)
    c.close()
    client = TestClient(api.create_app(db_path=str(db), run_mock_thread=False))
    assert client.get("/draft/yahoo_positions").json()["players"] == 0
    r = client.post("/draft/yahoo_positions", json={"text": PAGE})
    assert r.status_code == 200 and r.json()["found"] == 3 and r.json()["ambiguous"] == ["twin name"]
    assert client.get("/draft/yahoo_positions").json()["players"] == 3
    assert "never in the database" in r.json()["policy"]
    assert client.post("/draft/yahoo_positions", json={"text": "Invented Guard"}).status_code == 422

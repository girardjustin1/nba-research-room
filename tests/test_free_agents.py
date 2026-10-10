"""Free agents pasted from Yahoo's Players page: names found among the page's clutter, ambiguous
names skipped, rostered players left out, never in the database, used only without Yahoo.
Invented names."""

from __future__ import annotations

from datetime import UTC, datetime

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from research_room import api, free_agents, opponent_roster, optimizer, store
from research_room.config import settings

NOW = datetime(2026, 11, 4, 17, 0, tzinfo=UTC)
META = {"source": "test", "fetched_at": pd.Timestamp(NOW)}
PASTE = """Players
Pos  Player  Owner  GP*  Pre-Season  Current  % Ros
Invented Guard Jr.  BOS - PG,SG
Player Note  W (Nov 5)  FA  12  58  71  14%
Made Up Center  MIA - C   FA
Twin Name  MIA - SF       FA
Pretend Forward  MIA - SF,PF  W (Nov 6)
Nickname Star  BOS - SG
Retired Somebody
"""


@pytest.fixture
def cfg(tmp_path, monkeypatch):
    c = settings()
    c = c.model_copy(update={"paths": c.paths.model_copy(update={"inbox_dir": tmp_path})})
    monkeypatch.setattr(free_agents, "_path", lambda cfg=None: tmp_path / "free_agents.json")
    monkeypatch.setattr(opponent_roster, "_mine_path", lambda cfg=None: tmp_path / "my_roster.json")
    monkeypatch.setattr(free_agents, "load_aliases", lambda: [
        {"name": "Real Star Name", "player_id": 6, "variants": ["Nickname Star"]}])
    return c


@pytest.fixture
def nba(con):
    store.upsert(con, "teams", pd.DataFrame(
        [{"team_id": t, "abbreviation": a, "full_name": a, **META} for t, a in ((1, "BOS"), (2, "MIA"))]))
    store.upsert(con, "players", pd.DataFrame([
        {"player_id": i, "full_name": n, "team_id": t, "position": p, **META}
        for i, n, t, p in (
            (1, "Invented Guard", 1, "G"), (2, "Made Up Center", 2, "C"), (3, "Pretend Forward", 2, "F"),
            (4, "Retired Somebody", None, "F"), (5, "Twin Name", 1, "G"), (7, "Twin Name", 2, "F"),
            (6, "Real Star Name", 1, "G"),
        )
    ]))
    return con


def test_names_are_found_among_the_page_and_ambiguous_ones_skipped(nba, cfg, tmp_path):
    out = free_agents.save(nba, PASTE, cfg, NOW)
    assert [p["player_id"] for p in out["players"]] == [1, 2, 3, 6]   # Jr. ignored; alias; no retiree
    assert out["ambiguous"] == ["twin name"] and out["age_hours"] == 0
    kept = (tmp_path / "free_agents.json").read_text()
    assert "Player Note" not in kept and "Invented" not in kept       # ids and a time, not the text
    sql = "SELECT table_name FROM duckdb_tables() WHERE NOT temporary"
    tables = [r[0] for r in nba.execute(sql).fetchall()]
    assert not [t for t in tables if "free" in t]
    with pytest.raises(ValueError):
        free_agents.save(nba, "nothing useful here", cfg, NOW)


def test_the_list_feeds_the_optimizer_without_rostered_players_or_yahoo_eligibility(nba, cfg):
    from research_room.draft import eligibility

    free_agents.save(nba, PASTE, cfg, NOW)
    opponent_roster.save_mine(nba, [3], [], [], cfg, NOW)
    opponent_roster.apply_mine(nba, cfg)
    assert free_agents.apply(nba, cfg)["players"] == 3                 # Pretend Forward is mine
    pool = optimizer.free_agents(nba, cfg)
    assert sorted(pool["player_id"]) == [1, 2, 6]
    assert pool.set_index("player_id").at[2, "eligible"] == ["C"]
    assert eligibility.load_yahoo(nba).empty                            # not taken as Yahoo positions


def test_yahoos_own_list_wins(nba, cfg):
    free_agents.save(nba, PASTE, cfg, NOW)
    store.upsert(nba, "yahoo_players", pd.DataFrame([{
        "snapshot_at": pd.Timestamp(NOW), "yahoo_player_key": "466.p.9", "player_name": "x",
        "team_abbr": "BOS", "eligible_positions": "PG", "pct_rostered": 1.0, "status": None,
        "owner_team_id": None, "player_id": 1, "source": "yahoo", "fetched_at": pd.Timestamp(NOW)}]))
    assert free_agents.apply(nba, cfg) == {"applied": False, "reason": "Yahoo supplied the free agents"}


def test_the_live_read_applies_it(nba, cfg, monkeypatch):
    from tests.conftest import REAL_ATTACH

    free_agents.save(nba, PASTE, cfg, NOW)
    out = REAL_ATTACH(nba, cfg, ("players",))
    assert out["manual_free_agents"]["applied"] is True


def test_routes(tmp_path, cfg):
    db = tmp_path / "fa.duckdb"
    c = store.connect(db)
    store.upsert(c, "teams", pd.DataFrame([{"team_id": 1, "abbreviation": "BOS", "full_name": "B", **META}]))
    store.upsert(c, "players", pd.DataFrame(
        [{"player_id": 1, "full_name": "Invented Guard", "team_id": 1, "position": "G", **META}]))
    c.close()
    client = TestClient(api.create_app(db_path=str(db), run_mock_thread=False))
    assert client.get("/season/free_agents").json()["players"] == []
    r = client.post("/season/free_agents", params={"now": NOW.isoformat()}, json={"text": PASTE})
    assert r.status_code == 200 and r.json()["players"][0]["name"] == "Invented Guard"
    assert "never in the database" in r.json()["policy"]
    assert client.post("/season/free_agents", json={"text": "no names"}).status_code == 422

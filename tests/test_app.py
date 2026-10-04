"""Smoke-test the Streamlit pages against a small temporary store (no network)."""

from __future__ import annotations

from datetime import UTC, date, datetime
from pathlib import Path

import pandas as pd
import pytest
from streamlit.testing.v1 import AppTest

from research_room import config, store

APP = Path(__file__).resolve().parents[1] / "app"
NOW = datetime(2026, 10, 4, tzinfo=UTC)


@pytest.fixture
def tmp_store(tmp_path, monkeypatch):
    db = tmp_path / "rr.duckdb"
    monkeypatch.setenv("RESEARCH_ROOM_DB", str(db))
    config.settings.cache_clear()
    con = store.connect(db)
    teams = [{"team_id": t, "abbreviation": a, "source": "t", "fetched_at": NOW}
             for t, a in [(1, "DEN"), (2, "BOS")]]
    store.upsert(con, "teams", pd.DataFrame(teams))
    games = pd.DataFrame([{"game_id": i, "season": 2026, "game_date": d, "home_team_id": 1,
                           "visitor_team_id": 2, "postseason": False, "postponed": False,
                           "status_state": "scheduled", "source": "t", "fetched_at": NOW}
                          for i, d in enumerate([date(2026, 10, 20), date(2027, 3, 16)])])
    store.upsert(con, "games", games)
    with store.ingest_run(con, "bdl", "backfill") as run:
        run["rows"] = 4
    con.close()
    yield db
    config.settings.cache_clear()


def test_data_page_renders_schedule_matrix(tmp_store):
    at = AppTest.from_file(str(APP / "pages" / "6_Data.py"), default_timeout=30).run()
    assert not at.exception, at.exception
    assert [s.value for s in at.subheader][-1].startswith("Schedule matrix")
    assert len(at.dataframe) >= 4
    assert any("not scheduled yet" in c.value for c in at.caption)


def test_home_page_renders(tmp_store):
    at = AppTest.from_file(str(APP / "Home.py"), default_timeout=30).run()
    assert not at.exception, at.exception
    assert at.title[0].value == "NBA Research Room"
    assert "Store ready" in at.success[0].value


def test_pages_explain_a_missing_store(tmp_path, monkeypatch):
    monkeypatch.setenv("RESEARCH_ROOM_DB", str(tmp_path / "absent.duckdb"))
    config.settings.cache_clear()
    at = AppTest.from_file(str(APP / "pages" / "6_Data.py"), default_timeout=30).run()
    assert not at.exception
    assert "make backfill" in at.warning[0].value
    config.settings.cache_clear()

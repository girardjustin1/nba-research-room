"""GET /season/lineup against a seeded synthetic store, checked against the TS contract shape."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from research_room import api, pipeline, store
from research_room.config import settings
from tests.test_pipeline import seed

ET = ZoneInfo("America/New_York")
SLOT_KEYS = {"slot", "slot_index", "current", "optimal", "changed", "reason", "reason_tags", "delta_p_win"}
DAY_KEYS = {"date", "weekday", "is_today", "is_past", "slots", "bench_current", "bench_optimal", "il",
            "games_available", "games_started_current", "games_started_optimal", "delta_p_win",
            "first_lock_at"}


def test_season_lineup_matches_contract(tmp_path, monkeypatch):
    s = settings()
    cfg = s.model_copy(update={"bdl": s.bdl.model_copy(update={"backfill_seasons": [2025]})})
    monkeypatch.setattr("research_room.store.settings", lambda: cfg.model_copy(update={
        "paths": cfg.paths.model_copy(update={"parquet_dir": tmp_path / "parquet"})}))
    monkeypatch.setattr("research_room.ingest.yahoo.CsvBackend.available", lambda self: {})
    monkeypatch.setattr("research_room.season_api.settings", lambda: cfg)
    db = tmp_path / "s.duckdb"
    con = store.connect(db)
    client = TestClient(api.create_app(db_path=str(db), run_mock_thread=False))
    con.close()
    r = client.get("/season/lineup")
    assert r.status_code == 409 and "roster" in r.json()["detail"].lower()
    con = store.connect(db)
    seed(con, cfg)
    day = cfg.season.first_game_date
    r = client.get("/season/lineup")
    assert r.status_code == 409 and "make nightly" in r.json()["detail"]
    pipeline.run_nightly(con, cfg=cfg, day=day, sync=False, echo=lambda _: None)
    con.close()

    now = datetime(day.year, day.month, day.day, 12, 0, tzinfo=ET).isoformat()
    body = client.get("/season/lineup", params={"now": now}).json()
    envelope = {"as_of", "stale", "stale_reason", "provenance", "week", "days", "roster", "optimizer"}
    assert envelope <= set(body)
    assert body["week"]["cats_to_win"] == 5 and body["week"]["today"] == str(day)
    assert body["days"][0]["is_today"] and set(body["days"][0]) == DAY_KEYS
    first = body["days"][0]
    assert len(first["slots"]) == 10 and set(first["slots"][0]) == SLOT_KEYS
    assert [s["slot"] for s in first["slots"]][-4:] == ["C", "C", "Util", "Util"]
    assert first["games_started_optimal"] >= first["games_started_current"]   # everyone starts on BN here
    assert all(s["delta_p_win"] is None for d in body["days"] for s in d["slots"])  # Phase 2, not faked
    assert body["optimizer"]["status"] == "optimal" and "Phase 2" in body["optimizer"]["message"]
    assert {p["module"] for p in body["provenance"]} == {"projections", "overrides", "yahoo"}
    ref = body["roster"][0]
    assert ref["owner"] == "mine" and "Util" in ref["eligible"] and ref["status"]["code"] == "healthy"
    assert ref["status"]["play_prob"] is None            # unknown is null, never defaulted to 1

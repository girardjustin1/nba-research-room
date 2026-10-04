from __future__ import annotations

from datetime import UTC, datetime

import pandas as pd
import pytest

from research_room import store


def _team(team_id: int, name: str) -> dict:
    return {"team_id": team_id, "abbreviation": name[:3].upper(), "city": "X", "name": name,
            "full_name": f"X {name}", "conference": "East", "division": "Atlantic",
            "source": "test", "fetched_at": datetime(2026, 10, 1, tzinfo=UTC)}


def test_schema_creates_every_table(con):
    tables = {r[0] for r in con.execute("SELECT table_name FROM information_schema.tables").fetchall()}
    assert set(store.SCHEMA) <= tables


def test_init_schema_is_idempotent(con):
    store.init_schema(con)
    store.init_schema(con)


def test_every_ingested_table_has_source_and_fetched_at():
    not_ingested = {"draft_picks", "projections", "model_scores", "decisions_log",
                    "player_xref", "unresolved_names", "api_responses", "ingest_runs"}
    for name, table in store.SCHEMA.items():
        if name not in not_ingested:
            assert {"source", "fetched_at"} <= set(table.names), name


def test_upsert_is_idempotent_and_updates(con):
    df = pd.DataFrame([_team(1, "Hawks"), _team(2, "Celtics")])
    assert store.upsert(con, "teams", df) == 2
    assert store.upsert(con, "teams", df) == 2
    assert con.execute("SELECT count(*) FROM teams").fetchone()[0] == 2
    store.upsert(con, "teams", pd.DataFrame([_team(1, "Renamed")]))
    assert con.execute("SELECT name FROM teams WHERE team_id=1").fetchone()[0] == "Renamed"
    assert con.execute("SELECT count(*) FROM teams").fetchone()[0] == 2


def test_upsert_collapses_duplicate_keys_keeping_last(con):
    df = pd.DataFrame([_team(1, "First"), _team(1, "Second")])
    assert store.upsert(con, "teams", df) == 1
    assert con.execute("SELECT name FROM teams").fetchone()[0] == "Second"


def test_upsert_rejects_unknown_columns_and_null_keys(con):
    with pytest.raises(ValueError, match="unknown columns"):
        store.upsert(con, "teams", pd.DataFrame([{**_team(1, "A"), "bogus": 1}]))
    with pytest.raises(ValueError, match="primary key"):
        store.upsert(con, "teams", pd.DataFrame([{**_team(1, "A"), "team_id": None}]))


def test_projections_require_mean_and_sd(con):
    row = {"model": "baseline", "run_at": datetime(2026, 10, 1, tzinfo=UTC), "player_id": 1,
           "date": "2026-10-21", "stat": "pts", "mean": 20.0, "sd": None}
    with pytest.raises(Exception, match="NOT NULL"):
        store.upsert(con, "projections", pd.DataFrame([row]))


def test_response_cache_round_trip(con):
    params = {"seasons[]": 2025, "cursor": 7}
    assert store.cache_get(con, "bdl", "/v1/stats", params) is None
    store.cache_put(con, "bdl", "/v1/stats", params, 200, {"data": [1, 2]})
    assert store.cache_get(con, "bdl", "/v1/stats", {"cursor": 7, "seasons[]": 2025}) == {"data": [1, 2]}


def test_ingest_run_records_success_and_failure(con):
    with store.ingest_run(con, "bdl", "ok_job") as run:
        run["rows"] = 5
    with pytest.raises(RuntimeError), store.ingest_run(con, "bdl", "bad_job"):
        raise RuntimeError("boom")
    got = dict(con.execute("SELECT job, status FROM ingest_runs").fetchall())
    assert got == {"ok_job": "ok", "bad_job": "error"}


def test_export_parquet_writes_one_file_per_table(con, tmp_path):
    store.upsert(con, "teams", pd.DataFrame([_team(1, "Hawks")]))
    paths = store.export_parquet(con, tmp_path)
    assert {p.stem for p in paths} == set(store.SCHEMA) - {"api_responses"}
    assert len(pd.read_parquet(tmp_path / "teams.parquet")) == 1

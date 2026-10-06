from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pandas as pd
import pytest

from research_room import scoreboard, store, system
from research_room.config import settings
from research_room.projections.baseline import BaselineModel
from tests.test_leakage import synthetic

NOW = datetime(2026, 10, 10, 12, 0, tzinfo=UTC)


def run(con, job, status, hours_ago, source="pipeline"):
    t = NOW - timedelta(hours=hours_ago)
    store.upsert(con, "ingest_runs", pd.DataFrame([{
        "run_id": f"{job}-{hours_ago}", "source": source, "job": job, "started_at": t, "finished_at": t,
        "rows": 1, "status": status, "detail": "boom" if status == "error" else None}]))


def checks(h):
    return {c["key"]: c for c in h["checks"]}


def test_health_flags_staleness_failures_and_recovery(con, tmp_path):
    run(con, "sync_daily", "ok", 40, source="bdl")             # older than the 30 h budget
    run(con, "nightly", "error", 30)
    run(con, "nightly", "ok", 2)                               # recovered
    h = system.health(con, now=NOW, db_path=tmp_path / "none.duckdb")
    c = checks(h)
    assert c["bdl_sync"]["status"] == "warn" and "budget" in c["bdl_sync"]["detail"]
    assert c["failed_jobs"]["status"] == "ok" and "1 earlier failure" in c["failed_jobs"]["detail"]
    assert c["preseason"]["status"] == "error"                 # no projections loaded at all
    assert h["overall"] == "error"
    run(con, "nightly", "error", 1)                            # latest run failing again
    assert checks(system.health(con, now=NOW))["failed_jobs"]["status"] == "error"


def test_roster_check_waits_for_the_draft(con):
    before = datetime(2026, 10, 5, tzinfo=UTC)
    assert checks(system.health(con, now=before))["yahoo_roster"]["status"] == "ok"
    after = datetime(2026, 10, 25, tzinfo=UTC)
    c = checks(system.health(con, now=after))["yahoo_roster"]
    assert c["status"] == "warn" and "make inbox" in c["action"]


def unmatched(con, source, key, name):
    store.upsert(con, "unresolved_names", pd.DataFrame([
        {"source": source, "source_key": key, "raw_name": name, "reason": "no_match", "last_seen": NOW}]))


def test_only_yahoo_names_raise_a_warning(con):
    unmatched(con, "bbm", "1", "Fringe Guy")
    assert checks(system.health(con, now=NOW))["names"]["status"] == "ok"
    unmatched(con, "yahoo", "k", "Mystery")
    assert checks(system.health(con, now=NOW))["names"]["status"] == "warn"


def test_scoreboard_evaluates_out_of_sample_and_reports_latest(con):
    logs, ctx = synthetic(n_players=12, n_games=40, seed=2)
    from research_room import features
    built = features.build(logs, ctx, settings())
    train = built[built["game_id"] < 1025]
    test = built[(built["game_id"] >= 1025) & built["min_played_ewma"].notna()]
    sc = scoreboard.evaluate(BaselineModel(settings()), train, test, stats=("pts", "reb"))
    assert set(sc["stat"]) == {"pts", "reb"} and (sc["n"] > 0).all()
    assert sc["coverage_80"].between(0, 1).all() and (sc["mae"] > 0).all()
    rows = sc.assign(model="baseline", window_start=pd.Timestamp("2025-11-01").date(),
                     window_end=pd.Timestamp("2026-01-01").date(), beats_baseline=None)
    scoreboard.write_scores(con, rows)
    scoreboard.write_scores(con, rows.assign(mae=rows["mae"] + 1))       # a later run
    m = system.models(con)
    assert len(m["models"]) == 2
    first = m["models"][0]
    assert first["mae"] == pytest.approx(float(sc.set_index("stat").loc[first["stat"], "mae"]) + 1)


def test_notes_are_sorted_newest_first(tmp_path):
    p = tmp_path / "n.yaml"
    p.write_text("notes:\n  - {id: a, date: 2026-10-01, kind: update, title: Old, body: x}\n"
                 "  - {id: b, date: 2026-10-03, kind: finding, title: New, body: y}\n")
    out = system.notes(p)["notes"]
    assert [n["title"] for n in out] == ["New", "Old"] and out[0]["refs"] == []
    assert system.notes(tmp_path / "missing.yaml") == {"notes": []}
    repo = system.notes()["notes"]
    assert repo and all({"id", "date", "kind", "title", "body"} <= set(n) for n in repo)


def test_live_scoreboard_shapes_the_season_and_last_week(con):
    """GET /system/scoreboard: empty before any grading, then stats, market, P(plays), news."""
    from datetime import date

    from research_room import system

    empty = system.live_scoreboard(con, today=date(2026, 10, 25))
    assert empty["season"]["days"] == 0 and empty["season"]["stats"] == [] and empty["as_of"] is None
    now = pd.Timestamp("2026-10-25 12:00", tz="UTC")
    rows = [
        {"day": date(2026, 10, 21), "stat": "pts", "segment": "all", "n": 100, "mae": 4.5, "rmse": 6.0,
         "bias": -0.3, "coverage_80": 0.81, "graded_at": now},
        {"day": date(2026, 10, 21), "stat": "pts", "segment": "market", "n": 20, "mae": 4.0, "rmse": 5.0,
         "bias": 0.1, "coverage_80": None, "graded_at": now},
        {"day": date(2026, 10, 21), "stat": "pts", "segment": "market_model", "n": 20, "mae": 4.6,
         "rmse": 5.8, "bias": -0.9, "coverage_80": None, "graded_at": now},
        {"day": date(2026, 10, 21), "stat": "p_play", "segment": "brier", "n": 100, "mae": 0.1, "rmse": 0.3,
         "bias": 0.02, "coverage_80": None, "graded_at": now},
        {"day": date(2026, 10, 21), "stat": "_coverage", "segment": "no_box_score", "n": 3, "mae": None,
         "rmse": None, "bias": None, "coverage_80": None, "graded_at": now},
    ]
    store.upsert(con, "live_scores", pd.DataFrame(rows))
    store.upsert(con, "live_news_scores", pd.DataFrame([{"day": date(2026, 10, 21), "source": "nba_report",
                 "status": "Questionable", "listed": 10, "played": 5, "graded_at": now}]))
    out = system.live_scoreboard(con, today=date(2026, 10, 25))
    s = out["season"]
    assert s["days"] == 1 and s["stats"][0]["stat"] == "pts" and s["stats"][0]["coverage_80"] == 0.81
    assert s["market"] == [{"stat": "pts", "n": 20, "market_mae": 4.0, "model_mae": 4.6}]
    assert s["p_play"]["brier"] == pytest.approx(0.09) and s["ungraded"] == 3
    assert s["news"][0]["played_rate"] == 0.5 and s["news"][0]["assumed"] == 0.49
    assert out["last_7_days"]["days"] == 1

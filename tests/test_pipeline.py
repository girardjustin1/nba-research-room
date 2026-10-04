"""End-to-end nightly pipeline on a small synthetic store (no network)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pandas as pd

from research_room import pipeline, store
from research_room.config import settings
from tests.test_leakage import synthetic

NOW = datetime(2026, 10, 4, tzinfo=UTC)
POS = [["PG", "G"], ["SG", "G"], ["SF", "F"], ["PF", "F"], ["C"], ["PG", "SG", "G"]]


def seed(con, cfg):
    logs, _ = synthetic(n_players=12, n_games=30, seed=4)
    teams = [{"team_id": t, "abbreviation": a, "source": "t", "fetched_at": NOW}
             for t, a in [(1, "AAA"), (2, "BBB")]]
    store.upsert(con, "teams", pd.DataFrame(teams))
    pids = sorted(logs["player_id"].unique())
    store.upsert(con, "players", pd.DataFrame([{"player_id": int(p), "full_name": f"Player {p}",
                                                "team_id": int(p // 100), "source": "t", "fetched_at": NOW}
                                               for p in pids]))
    hist = logs.drop_duplicates("game_id")
    # Synthetic box scores don't add up to a final score, so history is not marked "final"
    # (quality.py checks final games only); real data reconciles.
    games = [{"game_id": int(g.game_id), "season": 2025, "game_date": g.game_date, "tip_utc": g.tip_utc,
              "status_state": "played", "postseason": False, "postponed": False, "home_team_id": 1,
              "visitor_team_id": 2, "home_score": None, "visitor_score": None, "source": "t",
              "fetched_at": NOW} for g in hist.itertuples()]
    first = cfg.season.first_game_date

    def future(i):
        day = first + timedelta(days=2 * i)
        return {"game_id": 9000 + i, "season": cfg.season.nba_season, "game_date": day,
                "tip_utc": pd.Timestamp(day).tz_localize("UTC") + pd.Timedelta(hours=23),
                "status_state": "scheduled", "postseason": False, "postponed": False, "home_team_id": 1,
                "visitor_team_id": 2, "home_score": None, "visitor_score": None, "source": "t",
                "fetched_at": NOW}
    games += [future(i) for i in range(6)]
    store.upsert(con, "games", pd.DataFrame(games))
    gl = logs.drop(columns=["tip_utc", "home_team_id", "visitor_team_id", "usage_pct"]).assign(
        tov=logs["tov"], source="t", fetched_at=NOW)
    store.upsert(con, "game_logs", gl[[c for c in gl.columns if c in store.SCHEMA["game_logs"].names]])
    roster = [{"snapshot_at": NOW, "team_id": cfg.league.my_team_id, "yahoo_player_key": f"k{p}",
               "player_name": f"Player {p}", "player_id": int(p), "selected_slot": "BN",
               "eligible_positions": ",".join(POS[i % len(POS)]), "status": None, "source": "yahoo",
               "fetched_at": NOW} for i, p in enumerate(pids[:13])]
    store.upsert(con, "yahoo_rosters", pd.DataFrame(roster))


def test_nightly_end_to_end(tmp_path, monkeypatch):
    s = settings()
    cfg = s.model_copy(update={"bdl": s.bdl.model_copy(update={"backfill_seasons": [2025]})})
    monkeypatch.setattr("research_room.store.settings", lambda: cfg.model_copy(update={
        "paths": cfg.paths.model_copy(update={"parquet_dir": tmp_path / "parquet"})}))
    con = store.connect(tmp_path / "p.duckdb")
    seed(con, cfg)
    monkeypatch.setattr("research_room.ingest.yahoo.CsvBackend.available", lambda self: {})
    report = pipeline.run_nightly(con, cfg=cfg, day=cfg.season.first_game_date, sync=False,
                                  echo=lambda _: None)
    assert report["projections"] > 0
    lineup = report["lineup"]
    assert lineup["status"] == "optimal", lineup
    assert sum(1 for p in lineup["starters"].values() if p) >= 1
    assert con.execute("SELECT count(*) FROM decisions_log WHERE kind = 'lineup'").fetchone()[0] == 1
    assert con.execute("SELECT min(sd) >= 0, count(*) FROM projections").fetchone()[0]
    runs = dict(con.execute("SELECT job, status FROM ingest_runs").fetchall())
    assert runs["nightly"] == "ok"
    # Idempotent: a second run stores the same projection keys again, not duplicates of the night.
    pipeline.run_nightly(con, cfg=cfg, day=cfg.season.first_game_date, sync=False, echo=lambda _: None)
    assert con.execute("SELECT count(*) FROM decisions_log WHERE kind = 'lineup'").fetchone()[0] == 2

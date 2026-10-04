"""Model scoreboard: how each projection model did against what actually happened.

Inputs: the feature table (pre-game features + `y_` outcomes), a model with fit/predict, a held-out
season. Outputs: one row per (model, stat) — MAE, RMSE, coverage of the 80% band (should be ~0.80),
n, and whether the model beats the EWMA baseline. Tables: writes model_scores.

Out of sample by construction: the model is fit on earlier seasons and scored on a later one, game
by game from pre-tip features. Every later model must beat the baseline here before it drives
recommendations (build prompt).
"""

from __future__ import annotations

from datetime import date

import duckdb
import numpy as np
import pandas as pd

from research_room import features, store
from research_room.config import Settings, settings
from research_room.projections.baseline import STATS, BaselineModel

Z80 = 1.2815515655446004            # half-width of a central 80% normal band, in sd


def evaluate(model, train: pd.DataFrame, test: pd.DataFrame, stats=STATS) -> pd.DataFrame:
    """Fit on `train`, predict each `test` game from its own pre-game features, score."""
    model.fit(train)
    df = test.assign(date=test["game_date"], play_prob=test["play_rate_ewma"], season_games=10_000)
    pred = model.predict(df)
    wide = pred.pivot_table(index=["player_id", "game_id"], columns="stat", values=["mean", "sd"])
    actual = test.set_index(["player_id", "game_id"])
    rows = []
    for s in stats:
        mu, sd = wide[("mean", s)], wide[("sd", s)]
        y = actual.loc[wide.index, f"y_{s}"]
        err = y - mu
        inside = (err.abs() <= Z80 * sd).mean()
        rows.append({"stat": s, "mae": float(err.abs().mean()), "rmse": float(np.sqrt((err ** 2).mean())),
                     "coverage_80": float(inside), "n": int(err.notna().sum())})
    return pd.DataFrame(rows)


def score_baseline(con: duckdb.DuckDBPyConnection, cfg: Settings | None = None,
                   test_season: int | None = None) -> pd.DataFrame:
    """Baseline fitted on the seasons before `test_season` (default: the latest backfilled)."""
    cfg = cfg or settings()
    seasons = sorted(cfg.bdl.backfill_seasons)
    test_season = test_season or seasons[-1]
    train_seasons = [s for s in seasons if s < test_season]
    built = features.build(features.load_logs(con, seasons), features.team_context(con, seasons), cfg)
    train = built[built["season"].isin(train_seasons)]
    test = built[(built["season"] == test_season) & built["min_played_ewma"].notna()]
    scores = evaluate(BaselineModel(cfg), train, test)
    dates = pd.to_datetime(test["game_date"])
    return scores.assign(model="baseline", window_start=dates.min().date(), window_end=dates.max().date(),
                         beats_baseline=None)


def write_scores(con: duckdb.DuckDBPyConnection, scores: pd.DataFrame) -> int:
    cols = ["model", "stat", "window_start", "window_end", "run_at", "mae", "rmse", "coverage_80", "n",
            "beats_baseline"]
    return store.upsert(con, "model_scores", scores.assign(run_at=store.utcnow())[cols])


def latest(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """The most recent score per (model, stat, window)."""
    return con.execute("""
        SELECT * EXCLUDE (rn) FROM (
            SELECT *, row_number() OVER (PARTITION BY model, stat, window_start, window_end
                                         ORDER BY run_at DESC) AS rn
            FROM model_scores) WHERE rn = 1
        ORDER BY model, stat
    """).df()


def window_label(start: date, end: date) -> str:
    return f"{start:%b %d, %Y} - {end:%b %d, %Y}"

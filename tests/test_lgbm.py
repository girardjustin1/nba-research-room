from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from research_room import features, pipeline
from research_room.config import settings
from research_room.projections.baseline import BaselineModel
from research_room.projections.lgbm import LgbmModel
from tests.test_leakage import synthetic


def _built():
    cfg = settings()
    a, ctx_a = synthetic(n_players=10, n_games=40, seed=0)
    b, ctx_b = synthetic(n_players=10, n_games=40, seed=1)
    b = b.assign(season=2024, game_id=b["game_id"] + 5000, tip_utc=b["tip_utc"] - pd.Timedelta(days=365),
                 game_date=pd.to_datetime(b["game_date"]) - pd.Timedelta(days=365))
    ctx_b = ctx_b.assign(game_id=ctx_b["game_id"] + 5000, tip_utc=ctx_b["tip_utc"] - pd.Timedelta(days=365))
    logs = pd.concat([b, a.assign(game_date=pd.to_datetime(a["game_date"]))], ignore_index=True)
    built = features.build(logs, pd.concat([ctx_b, ctx_a], ignore_index=True), cfg)
    return cfg, built[built["min_played_ewma"].notna()].assign(home=lambda d: d["home"].astype(float))


def test_lgbm_has_the_baseline_interface_and_finite_output():
    cfg, built = _built()
    small = cfg.model_copy(update={"models": cfg.models.model_copy(update={"lgbm": cfg.models.lgbm.model_copy(
        update={"n_estimators": 20, "min_child_samples": 20})})})
    m = LgbmModel(small).fit(built)
    assert m.phi and set(m.models) == {"minutes", *[s for s in m.phi if s != "minutes"]}
    df = built.assign(date=built["game_date"], play_prob=built["play_rate_ewma"], season_games=10_000)
    out, ref = m.predict(df), BaselineModel(small).fit(built).predict(df)
    assert list(out.columns) == list(ref.columns) and len(out) == len(ref)
    assert np.isfinite(out["mean"]).all() and (out["sd"] >= 0).all() and m.name == "lgbm"


def test_the_nightly_driver_is_the_baseline_unless_settings_say_otherwise():
    cfg = settings()
    assert type(pipeline.driver_model(cfg)) is BaselineModel
    lg = cfg.model_copy(update={"models": cfg.models.model_copy(update={"driver": "lgbm"})})
    assert isinstance(pipeline.driver_model(lg), LgbmModel)


def test_game_context_matches_the_feature_table_and_respects_the_cutoff():
    from research_room.projections.lgbm import LgbmContextModel
    cfg, built = _built()
    logs_ctx = built[["game_id", "team_id", "tip_utc"]].drop_duplicates(["game_id", "team_id"])
    rng = np.random.default_rng(0)
    n = len(logs_ctx)
    tctx = logs_ctx.assign(pace=rng.normal(99, 2, n), def_rating=rng.normal(112, 3, n))
    sched = built[["team_id", "game_id"]].assign(date=pd.to_datetime(built["game_date"]).dt.date)
    sched = sched.drop_duplicates()
    rows = sched.copy()
    gc = features.game_context(rows, sched, tctx)
    # Opponent pace from games strictly before each game.
    one = gc.dropna(subset=["opp_pace_r10"]).iloc[len(gc) // 2]
    prior = tctx[(tctx["team_id"] == one["opp_team_id"]) &
                 (tctx["tip_utc"] < pd.Timestamp(one["date"]).tz_localize(features.ET).tz_convert("UTC"))]
    assert one["opp_pace_r10"] == pytest.approx(prior.sort_values("tip_utc")["pace"].tail(10).mean())
    # A cutoff hides everything after it: changing later games changes nothing.
    cut = pd.Timestamp("2025-11-20T05:00:00Z")
    later = tctx.assign(pace=np.where(tctx["tip_utc"] >= cut, 500.0, tctx["pace"]))
    a = features.game_context(rows, sched, tctx, cutoff=cut)["opp_pace_r10"]
    b = features.game_context(rows, sched, later, cutoff=cut)["opp_pace_r10"]
    pd.testing.assert_series_equal(a, b)
    assert LgbmContextModel(cfg).name == "lgbm_ctx"

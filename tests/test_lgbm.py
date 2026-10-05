from __future__ import annotations

import numpy as np
import pandas as pd

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

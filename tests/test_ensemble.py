"""Ensemble weights and blend, and the hierarchical model's position priors (invented numbers)."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from research_room.config import settings
from research_room.projections import ensemble
from research_room.projections.hier import HierModel, position_group


def preds(mean, sd=2.0, stat="pts"):
    return pd.DataFrame({"player_id": [1, 2], "game_id": [7, 7], "date": ["2025-11-04"] * 2,
                         "stat": stat, "mean": mean, "sd": sd, "p_play": 1.0})


def test_weights_follow_inverse_error_with_a_floor():
    actual = pd.DataFrame({"player_id": [1, 2], "game_id": [7, 7], "y_pts": [10.0, 20.0]})
    w = ensemble.fit_weights({"baseline": preds([11.0, 21.0]), "bad": preds([20.0, 40.0]),
                              "awful": preds([1000.0, 1000.0])}, actual, settings())["pts"]
    assert w["baseline"] > w["bad"] > w["awful"]
    assert w["awful"] == pytest.approx(0.05 / (1 + 0.0), abs=0.02)      # kept at the floor
    assert sum(w.values()) == pytest.approx(1.0)


def test_blend_mean_and_a_band_that_widens_with_disagreement():
    w = {"pts": {"baseline": 0.5, "other": 0.5}}
    same = ensemble.blend({"baseline": preds([10.0, 20.0]), "other": preds([10.0, 20.0])}, w)
    apart = ensemble.blend({"baseline": preds([10.0, 20.0]), "other": preds([14.0, 20.0])}, w)
    assert same["mean"].tolist() == [10.0, 20.0] and same["sd"].tolist() == pytest.approx([2.0, 2.0])
    assert apart.loc[0, "mean"] == 12.0 and apart.loc[0, "sd"] == pytest.approx(np.sqrt(4 + 4))
    assert apart["p_play"].tolist() == [1.0, 1.0]                        # availability from the baseline


def test_position_groups_and_priors():
    assert position_group(pd.Series(["G-F", "C", None, "x"])).tolist() == ["G", "C", "ALL", "ALL"]
    m = HierModel(settings())
    m.pos_rate = {"pts": {"G": 0.6, "C": 0.3, "ALL": 0.45}}
    df = pd.DataFrame({"position": ["G", "C", None]})
    assert m._prior(df, "pts").tolist() == [0.6, 0.3, 0.45]


@pytest.mark.parametrize("which", ["ridge", "catboost", "hier"])
def test_challengers_have_the_baseline_interface(which):
    from research_room.projections.baseline import BaselineModel
    from research_room.projections.catboost_model import CatBoostModel
    from research_room.projections.ridge import RidgeModel
    from tests.test_lgbm import _built

    cfg, built = _built()
    small = cfg.model_copy(update={"models": cfg.models.model_copy(update={
        "catboost": cfg.models.catboost.model_copy(update={"iterations": 20})})})
    built = built.assign(position=np.where(built["player_id"] % 2 == 0, "G", "C"))
    cls = {"ridge": RidgeModel, "catboost": CatBoostModel, "hier": HierModel}[which]
    m = cls(small).fit(built)
    df = built.assign(date=built["game_date"], play_prob=built["play_rate_ewma"], season_games=10_000)
    out, ref = m.predict(df), BaselineModel(small).fit(built).predict(df)
    assert list(out.columns) == list(ref.columns) and len(out) == len(ref)
    assert np.isfinite(out["mean"]).all() and (out["sd"] >= 0).all() and m.name == which

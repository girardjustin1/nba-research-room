from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from research_room.config import settings
from research_room.projections.baseline import STATS, BaselineModel


def fitted(phi: float = 1.0) -> BaselineModel:
    m = BaselineModel(settings())
    m.phi = {s: phi for s in (*STATS, "minutes")}
    return m


def row(**kw):
    base = {"player_id": 1, "game_id": 10, "date": "2026-10-21", "min_played_ewma": 30.0,
            "play_prob": 1.0, "season_games": 999}
    base.update({f"{s}_pm_ewma": 0.5 for s in STATS})
    base.update(kw)
    return base


def one(pred: pd.DataFrame, stat: str = "pts") -> pd.Series:
    return pred[pred["stat"] == stat].iloc[0]


def test_mean_and_variance_formulas():
    pred = fitted(phi=2.0).predict(pd.DataFrame([row(play_prob=0.8)]))
    r = one(pred)
    cond = 0.5 * 30                                        # 15 points if he plays
    assert r["mean"] == pytest.approx(0.8 * cond)
    assert r["sd"] ** 2 == pytest.approx(0.8 * (2.0 * cond + cond ** 2) - (0.8 * cond) ** 2)
    assert r["minutes_mean"] == pytest.approx(24.0) and r["source"] == "ewma"


def test_early_season_shrinks_toward_preseason_including_play_probability():
    k = settings().baseline.preseason_prior_games
    pred = fitted().predict(pd.DataFrame([row(season_games=k, play_prob=0.2, prior_minutes=34.0,
                                              prior_pts=24.0, prior_games=82)]))
    r = one(pred)
    # n = k -> weight 1/2 on each side: minutes 32; cond pts (15 + 24) / 2; P(play) (0.2 + 1) / 2
    assert r["p_play"] == pytest.approx(0.6)
    assert r["mean"] == pytest.approx(0.6 * 19.5) and r["source"] == "ewma+preseason"
    opening = one(fitted().predict(pd.DataFrame([row(season_games=0, play_prob=0.2, prior_minutes=34.0,
                                                     prior_pts=24.0, prior_games=82)])))
    assert opening["p_play"] == pytest.approx(1.0) and opening["mean"] == pytest.approx(24.0)


def test_override_wins_and_minutes_cap_scales_the_line():
    pred = fitted().predict(pd.DataFrame([row(play_prob=0.9, play_prob_override=0.0)]))
    assert one(pred)["mean"] == 0 and one(pred)["sd"] == 0
    capped = one(fitted().predict(pd.DataFrame([row(minutes_cap=15.0)])))
    assert capped["mean"] == pytest.approx(0.5 * 15) and capped["minutes_mean"] == pytest.approx(15)


def test_no_history_and_no_prior_produces_no_row_and_rookie_uses_preseason():
    pred = fitted().predict(pd.DataFrame([
        row(player_id=1, min_played_ewma=np.nan, **{f"{s}_pm_ewma": np.nan for s in STATS}),
        row(player_id=2, min_played_ewma=np.nan, play_prob=np.nan, prior_minutes=20.0, prior_pts=9.0,
            prior_games=70, **{f"{s}_pm_ewma": np.nan for s in STATS}),
    ]))
    assert set(pred["player_id"]) == {2}
    r = one(pred)
    assert r["source"] == "preseason" and r["mean"] == pytest.approx(9.0 * 70 / 82)


def test_fit_recovers_poisson_dispersion():
    rng = np.random.default_rng(0)
    n = 4000
    minutes = rng.uniform(15, 38, n)
    rate = rng.uniform(0.2, 0.8, n)
    train = pd.DataFrame({"y_did_play": True, "min_played_ewma": minutes, "y_minutes": minutes,
                          **{f"{s}_pm_ewma": rate for s in STATS},
                          **{f"y_{s}": rng.poisson(rate * minutes) for s in STATS}})
    m = BaselineModel(settings()).fit(train)
    assert m.phi["pts"] == pytest.approx(1.0, abs=0.08)


def test_predict_requires_fit():
    with pytest.raises(RuntimeError, match="fit"):
        BaselineModel(settings()).predict(pd.DataFrame([row()]))


def test_object_typed_override_columns_from_a_merge_still_work():
    df = pd.DataFrame([row(), row(player_id=2)])
    df["minutes_cap"] = pd.Series([None, 20.0], dtype=object)
    df["play_prob_override"] = pd.Series([None, 0.5], dtype=object)
    pred = fitted().predict(df)
    p2 = pred[(pred["player_id"] == 2) & (pred["stat"] == "pts")].iloc[0]
    assert p2["p_play"] == pytest.approx(0.5) and p2["mean"] == pytest.approx(0.5 * 0.5 * 20)


def test_rate_shrinkage_moves_thin_evidence_most():
    from research_room.config import settings
    from research_room.projections.baseline import BaselineModel
    cfg = settings()
    m = BaselineModel(cfg, shrink=True)
    m.shrink_k, m.prior_rate = {"pts": 500.0}, {"pts": 0.5}
    df = pd.DataFrame({"pts_pm_ewma": [1.0, 1.0], "games_prior": [3, 200], "min_played_ewma": [20.0, 30.0]})
    out = m.shrunk(df)["pts_pm_ewma"]
    assert 0.5 < out[0] < out[1] < 1.0                        # 60 min of evidence vs ~1270
    assert BaselineModel(cfg, shrink=False).shrunk(df)["pts_pm_ewma"].tolist() == [1.0, 1.0]
    assert BaselineModel(cfg, shrink=True).name == "baseline_eb"


def test_minutes_recalibration_pulls_toward_the_mean_and_skips_news():
    from research_room.config import settings
    from research_room.projections.baseline import STATS, BaselineModel
    cfg = settings()
    on = cfg.model_copy(update={"baseline": cfg.baseline.model_copy(update={"minutes_recalibration": True})})
    m = BaselineModel(on)
    m.phi = {s: 1.0 for s in (*STATS, "minutes")}
    row = {"player_id": 1, "game_id": 1, "date": "2026-11-02", "min_played_ewma": 36.0, "play_prob": 1.0,
           "season_games": 50, **{f"{s}_pm_ewma": 0.5 for s in STATS}}
    df = pd.DataFrame([row, {**row, "player_id": 2, "play_prob_override": 1.0}])
    base = m.predict(df)
    m.minutes_ab = (2.0, 0.85)                                 # actual = 2 + 0.85 x projected
    rc = m.predict(df)
    mins = lambda d, pid: float(d[(d["stat"] == "minutes") & (d["player_id"] == pid)]["mean"].iloc[0])  # noqa: E731
    assert mins(rc, 1) == pytest.approx(2.0 + 0.85 * 36.0)
    assert mins(rc, 2) == pytest.approx(mins(base, 2))        # an override is news: untouched

"""LightGBM challenger: learned corrections to the baseline's minutes and per-minute rates.

Inputs: the feature table (features.py), settings.models.lgbm. Same interface as BaselineModel
(fit / predict), so the scoreboard, calibration, backtest and nightly run can use either.
Outputs: projection rows exactly like the baseline's (mean, sd, p_play, minutes_mean).
Tables: none.

What it changes, and only this:
- Minutes when playing: a gradient-boosted model of next-game minutes from the player's own
  history (EWMA, 3/5/10-game windows, play rate, usage, shot volume, experience) and home/away,
  replacing the 3-game-half-life EWMA, which overreacts to hot streaks (DECISIONS.md: the top 30
  projected players played about 7% less than projected).
- Per-minute rates: a model of each stat's next-game per-minute rate minus its EWMA (a correction,
  weighted by minutes) from the same history plus all the player's other rates.
P(plays), injury overrides, minutes caps, early-season preseason blending and the variance model
are the baseline's. Features are only those known before the game and independent of the next
opponent (features.STATE_COLUMNS + home), so live, calibration and backtest projections agree.

The variance (phi) is fitted on out-of-fold predictions (each season predicted by models trained
on the others), so the spread is not understated by in-sample fit. The model replaces the baseline
only after beating it on the scoreboard and the backtest (settings.models.driver).
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from lightgbm import LGBMRegressor

from research_room.config import Settings
from research_room.features import CONTEXT_COLUMNS
from research_room.projections.baseline import STATS, BaselineModel

MIN_FEATURES = [
    "min_played_ewma",
    "min_r3",
    "min_r5",
    "min_r10",
    "play_rate_ewma",
    "games_prior",
    "usage_r5",
    "fga_r5",
    "home",
]
RATE_BASE = [
    "min_played_ewma",
    "play_rate_ewma",
    "games_prior",
    "usage_r5",
    "fga_r5",
    "home",
    *[f"{s}_pm_ewma" for s in STATS],
]


class LgbmModel(BaselineModel):
    name = "lgbm"
    MIN_FEATURES = MIN_FEATURES
    RATE_BASE = RATE_BASE

    def __init__(self, cfg: Settings | None = None) -> None:
        super().__init__(cfg, shrink=False)
        self.name = "lgbm"
        self.models: dict | None = None

    # ---------------------------------------------------------------- the two corrections
    def _params(self) -> dict:
        p = self.cfg.models.lgbm
        return {
            "n_estimators": p.n_estimators,
            "learning_rate": p.learning_rate,
            "num_leaves": p.num_leaves,
            "min_child_samples": p.min_child_samples,
            "subsample": p.subsample,
            "subsample_freq": 1,
            "colsample_bytree": p.colsample_bytree,
            "verbose": -1,
            "random_state": 0,
        }

    @staticmethod
    def _x(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
        x = pd.DataFrame(index=df.index)
        for c in cols:
            x[c] = pd.to_numeric(df[c], errors="coerce").astype(float) if c in df else np.nan
        return x

    def _train(self, played: pd.DataFrame) -> dict:
        models = {
            "minutes": LGBMRegressor(**self._params()).fit(
                self._x(played, self.MIN_FEATURES), played["y_minutes"].astype(float)
            )
        }
        enough = played[played["y_minutes"] >= self.cfg.models.lgbm.min_rate_minutes]
        for s in STATS:
            target = enough[f"y_{s}"] / enough["y_minutes"] - enough[f"{s}_pm_ewma"]
            ok = target.notna()
            models[s] = LGBMRegressor(**self._params()).fit(
                self._x(enough[ok], self.RATE_BASE), target[ok], sample_weight=enough.loc[ok, "y_minutes"]
            )
        return models

    @classmethod
    def _apply(cls, models: dict, df: pd.DataFrame) -> pd.DataFrame:
        out = df.copy()
        has = out["min_played_ewma"].notna()
        if not has.any():
            return out
        rows = out[has]
        out.loc[has, "min_played_ewma"] = np.clip(
            models["minutes"].predict(cls._x(rows, cls.MIN_FEATURES)), 0, 48
        )
        x = cls._x(rows, cls.RATE_BASE)
        for s in STATS:
            out.loc[has, f"{s}_pm_ewma"] = np.clip(
                rows[f"{s}_pm_ewma"].astype(float) + models[s].predict(x), 0, None
            )
        return out

    def corrected(self, df: pd.DataFrame) -> pd.DataFrame:
        if self.models is None:
            raise RuntimeError("fit() the model before predict()")
        return self._apply(self.models, df)

    # ---------------------------------------------------------------- BaselineModel interface
    def fit(self, train: pd.DataFrame) -> LgbmModel:
        played = train[train["y_did_play"].astype(bool) & train["min_played_ewma"].notna()]
        seasons = sorted(played["season"].unique())
        if len(seasons) >= 2:  # out-of-fold corrections for the variance fit
            parts = [
                self._apply(self._train(played[played["season"] != s]), played[played["season"] == s])
                for s in seasons
            ]
            oof = pd.concat(parts).loc[played.index]
        else:
            oof = self._apply(self._train(played), played)
        self.models = self._train(played)
        super().fit(oof.assign(y_did_play=True))  # phi from out-of-fold corrected predictions
        return self

    def predict(self, df: pd.DataFrame) -> pd.DataFrame:
        return super().predict(self.corrected(df))


class LgbmContextModel(LgbmModel):
    """The same corrections plus the next game's context: rest days, back-to-back, and the
    opponent's pace and defense over its previous 10 games (features.game_context; known before
    the game). Projection rows must carry these columns (live, calibration and backtest add them)."""

    name = "lgbm_ctx"
    MIN_FEATURES = [*MIN_FEATURES, *CONTEXT_COLUMNS]
    RATE_BASE = [*RATE_BASE, *CONTEXT_COLUMNS]

    def __init__(self, cfg: Settings | None = None) -> None:
        super().__init__(cfg)
        self.name = "lgbm_ctx"

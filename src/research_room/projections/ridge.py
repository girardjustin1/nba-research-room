"""Ridge challenger: the LightGBM model's frame (corrections to minutes and per-minute rates from
the player's own history) with a linear learner instead of trees.

Inputs: the feature table, settings.models.ridge. Outputs: projection rows like the baseline's.
Tables: none. Missing features are filled with the training median and every feature is scaled,
so the penalty treats them alike. Adopted only if it (or a blend with it) beats the baseline.
"""

from __future__ import annotations

from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from research_room.config import Settings
from research_room.projections.lgbm import LgbmModel


class RidgeModel(LgbmModel):
    name = "ridge"

    def __init__(self, cfg: Settings | None = None) -> None:
        super().__init__(cfg)
        self.name = "ridge"

    def _estimator(self):
        return _ScaledRidge(self.cfg.models.ridge.alpha)


class _ScaledRidge:
    """Median-fill, scale, then ridge, passing per-row weights to the ridge step (sklearn's
    pipeline won't take sample_weight directly)."""

    def __init__(self, alpha: float) -> None:
        self.prep = make_pipeline(SimpleImputer(strategy="median"), StandardScaler())
        self.ridge = Ridge(alpha=alpha)

    def fit(self, x, y, sample_weight=None):
        self.ridge.fit(self.prep.fit_transform(x), y, sample_weight=sample_weight)
        return self

    def predict(self, x):
        return self.ridge.predict(self.prep.transform(x))

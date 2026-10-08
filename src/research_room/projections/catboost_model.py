"""CatBoost challenger: the LightGBM model's frame (corrections to minutes and per-minute rates
from the player's own history) with CatBoost's ordered boosting, which often overfits less on
noisy targets. (Named catboost_model.py so it can't shadow the catboost package.)

Inputs: the feature table, settings.models.catboost. Outputs: projection rows like the baseline's.
Tables: none. Adopted only if it (or a blend with it) beats the baseline.
"""

from __future__ import annotations

from catboost import CatBoostRegressor

from research_room.config import Settings
from research_room.projections.lgbm import LgbmModel


class CatBoostModel(LgbmModel):
    name = "catboost"

    def __init__(self, cfg: Settings | None = None) -> None:
        super().__init__(cfg)
        self.name = "catboost"

    def _estimator(self):
        c = self.cfg.models.catboost
        return CatBoostRegressor(
            iterations=c.iterations,
            depth=c.depth,
            learning_rate=c.learning_rate,
            l2_leaf_reg=c.l2_leaf_reg,
            loss_function="RMSE",
            verbose=False,
            random_seed=0,
            thread_count=-1,
            allow_writing_files=False,
        )

"""Hierarchical challenger: each player's per-minute rates pulled toward his position's, by how
much evidence he has (an empirical-Bayes approximation of player random effects shrunk to
position priors, as the build prompt allows).

Inputs: the feature table plus a `position` column (BallDontLie's: G, F, C, G-F, F-C, ...),
settings.models.hier. Outputs: projection rows like the baseline's. Tables: none.

Method: for each stat, the position prior is the minutes-weighted rate of all players at that
position group (first letter of the position: G, F, C; unknown -> league) on the training games.
A player's rate becomes (n x his EWMA rate + k x prior) / (n + k), n = his minutes of evidence
(the baseline's own measure), with k chosen per stat from settings.models.hier.k_grid_minutes by
squared error on the training games. k = 0 keeps the baseline. The league-wide version of this
(baseline.shrinkage) was tested and not adopted; this asks whether the position helps.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from research_room.config import Settings
from research_room.projections.baseline import STATS, BaselineModel


def position_group(pos: pd.Series) -> pd.Series:
    """'G-F' -> 'G', 'C' -> 'C', missing -> 'ALL'."""
    first = pos.fillna("").astype(str).str.strip().str[:1].str.upper()
    return first.where(first.isin(["G", "F", "C"]), "ALL")


class HierModel(BaselineModel):
    name = "hier"

    def __init__(self, cfg: Settings | None = None) -> None:
        super().__init__(cfg, shrink=False)
        self.name = "hier"
        self.pos_rate: dict[str, dict[str, float]] = {}
        self.k: dict[str, float] = {}

    def _prior(self, df: pd.DataFrame, s: str) -> pd.Series:
        grp = position_group(df["position"]) if "position" in df else pd.Series("ALL", index=df.index)
        rates = self.pos_rate.get(s, {})
        return grp.map(rates).fillna(rates.get("ALL", np.nan)).astype(float)

    def fit(self, train: pd.DataFrame) -> HierModel:
        super().fit(train)  # phi, as the baseline
        played = train[train["y_did_play"].astype(bool) & train["min_played_ewma"].notna()]
        grp = (
            position_group(played["position"])
            if "position" in played
            else pd.Series("ALL", index=played.index)
        )
        n = self._evidence(played)
        for s in STATS:
            y, mins, r = played[f"y_{s}"], played["y_minutes"], played[f"{s}_pm_ewma"]
            ok = r.notna() & n.notna() & (mins > 0)
            tot = pd.DataFrame({"y": y[ok], "m": mins[ok], "g": grp[ok]}).groupby("g")[["y", "m"]].sum()
            rates = (tot["y"] / tot["m"]).to_dict()
            rates["ALL"] = float(y[ok].sum() / mins[ok].sum())
            self.pos_rate[s] = rates
            prior = grp[ok].map(rates).astype(float)
            best, best_err = 0.0, np.inf
            for k in self.cfg.models.hier.k_grid_minutes:
                rk = (n[ok] * r[ok] + k * prior) / (n[ok] + k) if k > 0 else r[ok]
                err = float(((y[ok] - rk * mins[ok]) ** 2).sum())
                best, best_err = (k, err) if err < best_err else (best, best_err)
            self.k[s] = float(best)
        return self

    def shrunk(self, df: pd.DataFrame) -> pd.DataFrame:
        if not self.k:
            return df
        out = df.copy()
        n = self._evidence(df)
        for s, k in self.k.items():
            col = f"{s}_pm_ewma"
            if col in out and k > 0:
                prior = self._prior(df, s)
                out[col] = ((n * out[col] + k * prior) / (n + k)).where(prior.notna(), out[col])
        return out

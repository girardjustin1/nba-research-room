"""Ensemble: an inverse-error blend of the projection models, per stat (build prompt).

Inputs: fitted member models (baseline first), their predictions on a validation season,
settings.models.ensemble. Outputs: projection rows like the baseline's, and the weights.
Tables: none.

Weights: per stat, each member's weight is 1 / its MAE on the validation games, every weight
clamped to at least `min_weight` and the set normalized to 1. The validation season must come after
the members' training seasons and before the test season (nested, so the test is untouched).
Blend: the mean is the weighted mean of the members' means. The spread is the mixture's: the
weighted members' variances plus the weighted spread of their means around the blend, so the band
widens where the models disagree. P(plays), expected minutes and the source come from the
baseline member, so explanations stay exact for availability and minutes.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from research_room.config import Settings, settings

KEY = ["player_id", "game_id", "date", "stat"]


def _long(pred: pd.DataFrame) -> pd.DataFrame:
    return pred[[*KEY, "mean", "sd"]].copy()


def fit_weights(
    val_preds: dict[str, pd.DataFrame],
    actual: pd.DataFrame,
    cfg: Settings | None = None,
) -> dict[str, dict[str, float]]:
    """stat -> member -> weight, from each member's MAE on the validation games.
    `actual`: player_id, game_id and y_<stat> columns."""
    cfg = cfg or settings()
    floor = cfg.models.ensemble.min_weight
    names = list(val_preds)
    stats = sorted(set.intersection(*(set(p["stat"]) for p in val_preds.values())))
    act = actual.set_index(["player_id", "game_id"])
    weights = {}
    for s in stats:
        mae = {}
        for name, p in val_preds.items():
            q = p[p["stat"] == s].set_index(["player_id", "game_id"])["mean"]
            col = "y_minutes" if s == "minutes" else f"y_{s}"
            y = act[col].reindex(q.index)
            ok = y.notna() & q.notna()
            mae[name] = float((y[ok] - q[ok]).abs().mean()) if ok.any() else np.inf
        inv = {n: (1.0 / m if np.isfinite(m) and m > 0 else 0.0) for n, m in mae.items()}
        tot = sum(inv.values()) or 1.0
        w = {n: max(floor, inv[n] / tot) for n in names}
        z = sum(w.values())
        weights[s] = {n: w[n] / z for n in names}
    return weights


class EnsembleModel:
    """A blend of already-fitted members with fixed per-stat weights (fit_weights)."""

    name = "ensemble"

    def __init__(self, members: dict, weights: dict[str, dict[str, float]], base: str = "baseline") -> None:
        self.members, self.weights, self.base = members, weights, base

    def predict(self, df: pd.DataFrame) -> pd.DataFrame:
        preds = {n: m.predict(df) for n, m in self.members.items()}
        return blend(preds, self.weights, self.base)


def blend(
    preds: dict[str, pd.DataFrame],
    weights: dict[str, dict[str, float]],
    base: str = "baseline",
) -> pd.DataFrame:
    """Blend member predictions (long rows) with per-stat weights. Pure."""
    out = preds[base].copy()
    stacked = pd.concat([_long(p).assign(member=n) for n, p in preds.items()], ignore_index=True)
    w = pd.DataFrame([{"stat": s, "member": n, "w": x} for s, ws in weights.items() for n, x in ws.items()])
    stacked = stacked.merge(w, on=["stat", "member"], how="inner")
    stacked["wm"] = stacked["w"] * stacked["mean"]
    g = stacked.groupby(KEY)
    mean = g["wm"].sum() / g["w"].sum()
    stacked = stacked.join(mean.rename("blend"), on=KEY)
    stacked["wv"] = stacked["w"] * (stacked["sd"] ** 2 + (stacked["mean"] - stacked["blend"]) ** 2)
    var = stacked.groupby(KEY)["wv"].sum() / g["w"].sum()
    idx = pd.MultiIndex.from_frame(out[KEY])
    has = idx.isin(mean.index)
    out.loc[has, "mean"] = mean.reindex(idx[has]).to_numpy()
    out.loc[has, "sd"] = np.sqrt(var.reindex(idx[has]).to_numpy())
    return out

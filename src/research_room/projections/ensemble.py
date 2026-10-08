"""Ensemble: an inverse-error blend of the projection models, per stat (build prompt).

Inputs: fitted member models (baseline first), their predictions on a validation season,
settings.models.ensemble. Outputs: projection rows like the baseline's, and the weights.
Tables: none.

Weights: per stat, each member's weight is 1 / its MAE on the validation games (a member with no
error takes all of it, shared if several), then every weight raised to at least `min_weight` with
the rest keeping their proportions, summing to 1 (audit A04). The validation season must come
after the members' training seasons and before the test season (nested, so the test is untouched).
Blend: the mean is the weighted mean of the members' means. The spread is the mixture's: the
weighted members' variances plus the weighted spread of their means around the blend, so the band
widens where the models disagree. A member with no finite mean or spread for a row is left out of
that row and the others' weights renormalized (A06). P(plays) and the source come from the
baseline member; expected minutes (`minutes_mean`) is the blended minutes row's mean (A05).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from research_room.config import Settings, settings

GAME = ["player_id", "game_id", "date"]
KEY = [*GAME, "stat"]


def _long(pred: pd.DataFrame) -> pd.DataFrame:
    return pred[[*KEY, "mean", "sd"]].copy()


def _floored(raw: dict[str, float], floor: float) -> dict[str, float]:
    """Weights summing to 1, each at least `floor`, the unfloored ones in raw's proportions."""
    if floor * len(raw) > 1 + 1e-12:
        raise ValueError(f"min_weight {floor} is infeasible for {len(raw)} members")
    fixed: set[str] = set()
    while True:
        free = {n: v for n, v in raw.items() if n not in fixed}
        left = 1.0 - floor * len(fixed)
        tot = sum(free.values())
        w = {n: (left * v / tot if tot > 0 else left / len(free)) for n, v in free.items()}
        low = {n for n, x in w.items() if x < floor}
        if not low:
            return {n: (floor if n in fixed else w[n]) for n in raw}
        fixed |= low


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
        perfect = [n for n, m in mae.items() if m == 0]
        if perfect:
            raw = {n: float(n in perfect) for n in names}
        else:
            raw = {n: (1.0 / m if np.isfinite(m) else 0.0) for n, m in mae.items()}
        weights[s] = _floored(raw, floor)
    return weights


class EnsembleModel:
    """A blend of already-fitted members with fixed per-stat weights (fit_weights)."""

    name = "ensemble"

    def __init__(self, members: dict, weights: dict[str, dict[str, float]], base: str = "baseline") -> None:
        self.members, self.weights, self.base = members, weights, base

    def predict(self, df: pd.DataFrame) -> pd.DataFrame:
        preds = {n: m.predict(df) for n, m in self.members.items()}
        return blend(preds, self.weights, self.base)


def member_classes() -> dict:
    """name -> model class (imported here: CatBoost and LightGBM load slowly)."""
    from research_room.projections.baseline import BaselineModel
    from research_room.projections.catboost_model import CatBoostModel
    from research_room.projections.hier import HierModel
    from research_room.projections.lgbm import LgbmModel
    from research_room.projections.ridge import RidgeModel

    return {"baseline": BaselineModel, "lgbm": LgbmModel, "ridge": RidgeModel, "catboost": CatBoostModel,
            "hier": HierModel}


def validation_rows(df: pd.DataFrame) -> pd.DataFrame:
    """Feature rows as projection inputs (the bake-off's and the scoreboard's way: no news)."""
    return df.assign(date=df["game_date"], play_prob=df["play_rate_ewma"], season_games=10_000)


class EnsembleFit:
    """The ensemble with the baseline's interface (fit, fit_minutes, predict), for the replays.
    fit: the weights are nested inside the training seasons (members fitted on all but the last,
    weighted on its games), then every member is refitted on all of them. `positions`
    (player_id -> position) feeds the hierarchical member on rows without a position."""

    name = "ensemble"

    def __init__(self, cfg: Settings | None = None, positions: dict | None = None) -> None:
        self.cfg = cfg or settings()
        self.positions = positions or {}
        self.members: dict = {}
        self.weights: dict[str, dict[str, float]] = {}

    def _new(self, cls):
        m = cls(self.cfg)
        if hasattr(m, "positions"):
            m.positions = self.positions
        return m

    def fit(self, train: pd.DataFrame) -> EnsembleFit:
        classes = member_classes()
        names = [n for n in self.cfg.models.ensemble.members if n in classes]
        if "baseline" not in names:
            raise ValueError("the ensemble needs the baseline member (availability, source)")
        seasons = sorted(train["season"].unique())
        if len(seasons) < 2:
            raise ValueError("the ensemble needs two training seasons: one to fit, one to weigh")
        val = train[(train["season"] == seasons[-1]) & train["min_played_ewma"].notna()]
        early = train[train["season"] < seasons[-1]]
        vpreds = {n: self._new(classes[n]).fit(early).predict(validation_rows(val)) for n in names}
        self.weights = fit_weights(vpreds, val, self.cfg)
        self.members = {n: self._new(classes[n]).fit(train) for n in names}
        return self

    def fit_minutes(self, built: pd.DataFrame, schedule: pd.DataFrame, seasons: list[int]) -> EnsembleFit:
        for m in self.members.values():
            m.fit_minutes(built, schedule, seasons)
        return self

    def predict(self, df: pd.DataFrame) -> pd.DataFrame:
        if not self.members:
            raise RuntimeError("fit() the ensemble before predict()")
        return blend({n: m.predict(df) for n, m in self.members.items()}, self.weights)


def blend(
    preds: dict[str, pd.DataFrame],
    weights: dict[str, dict[str, float]],
    base: str = "baseline",
) -> pd.DataFrame:
    """Blend member predictions (long rows) with per-stat weights. Pure."""
    out = preds[base].copy()
    stacked = pd.concat([_long(p).assign(member=n) for n, p in preds.items()], ignore_index=True)
    if stacked.duplicated([*KEY, "member"]).any():
        raise ValueError("a member has more than one prediction for a player-game-stat")
    stacked = stacked[np.isfinite(stacked["mean"]) & np.isfinite(stacked["sd"])]  # left out (A06)
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
    if "minutes_mean" in out:  # one expected-minutes figure per game: the blended one (A05)
        mins = out[out["stat"] == "minutes"].set_index(GAME)["mean"]
        blended = mins.reindex(pd.MultiIndex.from_frame(out[GAME])).to_numpy(float)
        out["minutes_mean"] = np.where(np.isnan(blended), out["minutes_mean"], blended)
    return out

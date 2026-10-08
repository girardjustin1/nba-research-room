"""Shadow models: challengers projecting next to the driver, graded live, never driving anything.

Inputs: the driver's projection run (its window, overrides, preseason prior, run time), the
training features, settings.models.shadow. Outputs: projections rows under the challenger's own
model name and the driver's run time, so the live grading pairs them game by game
(`make shadow-report`). Every reader that drives a decision or the app reads model = 'baseline'
only. Tables: writes projections; reads players.

The fitted challenger is cached under data/models/, keyed by the training seasons and every
setting that shapes it; only the nightly run refits it (about 5 minutes), so a pre-game refresh
adds only the prediction. A shadow failing is reported and never touches the driver's run.
"""

from __future__ import annotations

import hashlib
import json
import pickle
from datetime import date, datetime
from pathlib import Path

import duckdb
import pandas as pd

from research_room import schedule
from research_room.config import Settings
from research_room.projections import market
from research_room.projections.baseline import project_window, write_projections
from research_room.projections.ensemble import EnsembleFit

FACTORIES = {"ensemble": lambda cfg, positions: EnsembleFit(cfg, positions)}


def _key(name: str, cfg: Settings, seasons: list[int]) -> str:
    shape = {
        "name": name,
        "seasons": seasons,
        "models": cfg.models.model_dump(mode="json"),
        "baseline": cfg.baseline.model_dump(mode="json"),
    }
    return hashlib.sha1(json.dumps(shape, sort_keys=True, default=str).encode()).hexdigest()[:12]


def _cache(cfg: Settings, name: str, seasons: list[int]) -> Path:
    return cfg.paths.db.resolve().parent / "models" / f"{name}-{_key(name, cfg, seasons)}.pkl"


def _positions(con: duckdb.DuckDBPyConnection) -> dict:
    return dict(con.execute("SELECT player_id, position FROM players").fetchall())


def fitted(
    con: duckdb.DuckDBPyConnection,
    cfg: Settings,
    name: str,
    train: pd.DataFrame,
    seasons: list[int],
    refit: bool,
):
    """The cached challenger, or a fresh fit when `refit` (nightly) and there is none. None when
    there is no cache and refitting isn't allowed (a pre-game run never waits minutes for a fit)."""
    path, positions = _cache(cfg, name, seasons), _positions(con)
    if path.exists():
        with path.open("rb") as f:
            model = pickle.load(f)  # noqa: S301 - written by this module on this machine
    elif refit:
        model = FACTORIES[name](cfg, positions).fit(train)
        model.fit_minutes(train, schedule.season_schedule(con), seasons)
        path.parent.mkdir(parents=True, exist_ok=True)
        for old in path.parent.glob(f"{name}-*.pkl"):
            old.unlink()
        tmp = path.with_suffix(".tmp")
        with tmp.open("wb") as f:
            pickle.dump(model, f)
        tmp.replace(path)
    else:
        return None
    if hasattr(model, "positions"):  # today's positions for players added since the fit
        model.positions = positions
        for m in getattr(model, "members", {}).values():
            if hasattr(m, "positions"):
                m.positions = positions
    return model


def project(
    con: duckdb.DuckDBPyConnection,
    cfg: Settings,
    train: pd.DataFrame,
    seasons: list[int],
    start: date,
    end: date,
    ov: pd.DataFrame,
    prior: pd.DataFrame | None,
    run_at: datetime,
    refit: bool,
) -> dict:
    """Each shadow's projections for the driver's window, stored at the driver's run time."""
    out = {}
    for name in cfg.models.shadow:
        try:
            model = fitted(con, cfg, name, train, seasons, refit)
            if model is None:
                out[name] = {"skipped": "no fitted model yet (the nightly run fits it)"}
                continue
            proj = project_window(con, start, end, cfg, overrides=ov, prior=prior, model=model)
            proj = market.overlay(con, proj, cfg, news=ov)
            out[name] = {"rows": write_projections(con, proj, name, run_at=run_at)}
        except Exception as exc:  # noqa: BLE001 - a shadow never stops the driver's run
            out[name] = {"error": f"{type(exc).__name__}: {exc}"[:300]}
    return out


STATS = ["minutes", "pts", "reb", "ast", "stl", "blk", "fg3m", "tov", "fga", "fta"]


def compare(base: pd.DataFrame, other: pd.DataFrame, draws: int = 2000, seed: int = 0) -> pd.DataFrame:
    """Per stat, on the player-games both projected in the same run (live_scores.graded_rows rows,
    a game he sat counting 0): average miss and RMSE of each, the change in percent (negative:
    the shadow is better), and the 95% range of the average-miss change from resampling whole
    game days. Pure."""
    import numpy as np

    key = ["player_id", "game_id", "stat", "run_at"]
    keep = [*key, "game_date", "mean"]
    b = base[~base["no_log"].astype(bool)] if "no_log" in base else base
    o = other[~other["no_log"].astype(bool)] if "no_log" in other else other
    j = b.merge(o[keep].rename(columns={"mean": "mean_shadow", "game_date": "_d"}), on=key)
    out, rng = [], np.random.default_rng(seed)
    for s in STATS:
        g = j[j["stat"] == s]
        if g.empty or s not in g:
            continue
        y = g[s].fillna(0.0).to_numpy(float)
        eb, eo = np.abs(g["mean"].to_numpy(float) - y), np.abs(g["mean_shadow"].to_numpy(float) - y)
        mb = float(eb.mean())
        by = (
            pd.DataFrame({"d": eo - eb, "day": g["game_date"].to_numpy()})
            .groupby("day")["d"]
            .agg(["sum", "size"])
        )
        sums, cnt = by["sum"].to_numpy(), by["size"].to_numpy()
        boot = [
            sums[i].sum() / cnt[i].sum()
            for i in (rng.integers(0, len(sums), len(sums)) for _ in range(draws))
        ]
        rb = float(np.sqrt(((g["mean"].to_numpy(float) - y) ** 2).mean()))
        ro = float(np.sqrt(((g["mean_shadow"].to_numpy(float) - y) ** 2).mean()))
        out.append(
            {
                "stat": s,
                "n": int(len(g)),
                "days": int(len(sums)),
                "mae_base": mb,
                "mae_shadow": float(eo.mean()),
                "mae_change_pct": 100 * (float(eo.mean()) - mb) / mb if mb else None,
                "mae_change_95": [100 * float(np.percentile(boot, q)) / mb for q in (2.5, 97.5)]
                if mb
                else None,
                "rmse_change_pct": 100 * (ro - rb) / rb if rb else None,
            }
        )
    return pd.DataFrame(out)

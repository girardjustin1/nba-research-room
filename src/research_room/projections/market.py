"""Market-informed projections: where a liquid prop ladder exists, the market sets the game.

Inputs: props_ladder (Kalshi mid-prices and TheRundown de-vigged sportsbook lines, archived by
ingest/kalshi.py and ingest/rundown.py), the baseline's projection rows, settings.markets.overlay.
Outputs: the same projection rows, with mean and sd replaced for the player-game-stats that have a
recent liquid ladder, and a `market` flag. Tables: reads props_ladder.

Why: tested on 40 sampled 2025-26 games (DECISIONS.md), Kalshi's pre-tip prices beat the baseline
on the same yes/no questions (Brier 0.164 vs 0.179) and the market-implied means beat it against
actual stats (points RMSE 7.75 vs 8.84, rebounds 2.96 vs 3.12, assists 2.48 vs 2.65; threes tied).
Only the tested stats are overlaid (settings).

Method: each source's latest snapshot gives P(stat > threshold) at one or more thresholds
(threshold = x.5 lines). Several sources or books at one threshold are combined by their median.
With two or more thresholds, a normal is fitted through them on the probit scale,
z = Phi^-1(1 - p) = (threshold - mu) / sigma, which is a straight line in the threshold. With one,
the baseline's sd is kept and mu is solved from that line. The market's sd stays within
`sd_bounds` x the baseline's; a ladder that doesn't get harder as the line rises is ignored.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import duckdb
import numpy as np
import pandas as pd
from scipy.stats import norm

from research_room import store
from research_room.config import Settings, settings


def ladder_points(
    con: duckdb.DuckDBPyConnection,
    game_ids: list[int],
    stats: list[str],
    now: datetime | None = None,
    max_age_hours: float = 30,
) -> pd.DataFrame:
    """player_id, game_id, stat, threshold, p_over: each source's latest liquid snapshot, the median
    across sources and books at each threshold."""
    if not game_ids or not stats:
        return pd.DataFrame(columns=["player_id", "game_id", "stat", "threshold", "p_over"])
    since = pd.Timestamp(now or store.utcnow()) - timedelta(hours=max_age_hours)
    df = con.execute(
        """
        WITH latest AS (
            SELECT source, game_id, max(fetched_at) AS f FROM props_ladder
            WHERE game_id IN (SELECT unnest(?)) AND fetched_at >= ? GROUP BY 1, 2)
        SELECT l.player_id, l.game_id, l.stat, l.threshold, l.prob
        FROM props_ladder l
        JOIN latest t ON t.source = l.source AND t.game_id = l.game_id AND t.f = l.fetched_at
        WHERE l.side = 'over' AND l.prob IS NOT NULL AND l.stat IN (SELECT unnest(?))
    """,
        [list(map(int, game_ids)), since, stats],
    ).df()
    if df.empty:
        return pd.DataFrame(columns=["player_id", "game_id", "stat", "threshold", "p_over"])
    return (
        df.groupby(["player_id", "game_id", "stat", "threshold"], as_index=False)["prob"]
        .median()
        .rename(columns={"prob": "p_over"})
    )


def fit(
    thresholds: np.ndarray, p_over: np.ndarray, base_sd: float, sd_bounds: tuple[float, float]
) -> tuple[float, float] | None:
    """(mu, sd) of the normal the ladder implies, or None when it can't be trusted."""
    z = norm.ppf(1 - np.clip(p_over, 0.01, 0.99))
    k = np.asarray(thresholds, dtype=float)
    lo, hi = sd_bounds[0] * base_sd, sd_bounds[1] * base_sd
    if len(np.unique(k)) >= 2:
        b, a = np.polyfit(k, z, 1)
        if b <= 0:
            return None  # not harder as the line rises
        sd = float(np.clip(1.0 / b, lo, hi)) if base_sd > 0 else 1.0 / b
        mu = float(np.mean(k - sd * z))  # refit mu with the bounded sd
    else:
        if base_sd <= 0:
            return None
        sd = base_sd
        mu = float(k[0] - sd * z[0])
    return max(mu, 0.0), sd


def overlay(
    con: duckdb.DuckDBPyConnection,
    proj: pd.DataFrame,
    cfg: Settings | None = None,
    now: datetime | None = None,
) -> pd.DataFrame:
    """Projection rows (player_id, game_id, stat, mean, sd, ...) with the market setting mean and sd
    where a recent liquid ladder exists. Adds a boolean `market` column."""
    cfg = cfg or settings()
    ov = cfg.markets.overlay
    out = proj.copy()
    out["market"] = False
    out["model_mean"] = out["mean"]                       # the model's number, kept for explanations
    if not ov.enabled or out.empty or "game_id" not in out:
        return out
    pts = ladder_points(
        con, out["game_id"].dropna().astype(int).unique().tolist(), ov.stats, now, ov.max_age_hours
    )
    if pts.empty:
        return out
    idx = out.set_index(["player_id", "game_id", "stat"]).index
    pos = {k: i for i, k in enumerate(idx)}
    for (pid, gid, stat), g in pts.groupby(["player_id", "game_id", "stat"]):
        i = pos.get((pid, gid, stat))
        if i is None:
            continue
        res = fit(g["threshold"].to_numpy(), g["p_over"].to_numpy(), float(out["sd"].iat[i]), ov.sd_bounds)
        if res is not None:
            out.iat[i, out.columns.get_loc("mean")], out.iat[i, out.columns.get_loc("sd")] = res
            out.iat[i, out.columns.get_loc("market")] = True
    return out

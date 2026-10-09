"""The props test: Kalshi's pre-tip prices against the baseline, both if he plays.

The rule was written in DECISIONS.md before the run ("Props test for threes, steals and blocks",
2026-10-09). This module holds the pure parts, so they are tested on invented data; the job
(jobs/props_test.py) fetches the prices, fits the baseline and calls these.

Inputs: rung rows, one per (game_id, player_id, stat, threshold), with the market's pre-tip mid
(`p_market`), the baseline's line if he plays (`mu`, `sd`), its P(plays) (`p_play`) and the
outcome (`y`: the stat went over the threshold); settings.props_test.
Outputs: per-stat scores (Brier, log loss, 80% range of market minus baseline by resampling whole
games, the decision under the rule), calibration bands, and market-implied means vs actual.
Tables: none.

P(over) for the baseline is the normal tail above the rung's x.5 line (the engine's family for
every stat: the simulator and the overlay both treat a stat as normal(mean, sd)). A negative
binomial with the same mean and variance (Poisson when the variance is at or below the mean) is
reported beside it, shown, not judged.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import nbinom, norm, poisson

from research_room.config import PropsTestConfig, Settings
from research_room.ingest import kalshi
from research_room.projections import market

BANDS = (0.0, 0.2, 0.4, 0.6, 0.8, 1.0)


# ------------------------------------------------------------------ the sample
def sample_order(game_ids, seed: int) -> list[int]:
    """Every candidate game, shuffled once with the fixed seed (sorted first, so the order does
    not depend on how the ids arrived)."""
    ids = np.array(sorted({int(g) for g in game_ids}), dtype=np.int64)
    return [int(g) for g in np.random.default_rng(seed).permutation(ids)]


def next_size(n: int, liquid_counts: dict[str, int], cfg: PropsTestConfig, available: int) -> int | None:
    """How many games the sample needs next, or None when it is complete: grow by `step_games`
    while a judged stat has fewer than `min_rungs` liquid rungs with a matched player, up to
    `max_games` (and the games there are). Counts never use an outcome or the baseline."""
    short = any(liquid_counts.get(s, 0) < cfg.min_rungs for s in cfg.judged)
    cap = min(cfg.max_games, available)
    if not short or n >= cap:
        return None
    return min(n + cfg.step_games, cap)


# ------------------------------------------------------------------ the price
def _f(v) -> float | None:
    try:
        return float(v) if v is not None and v != "" else None
    except (TypeError, ValueError):
        return None


def pretip_quote(candles: list[dict], tip_ts: int) -> dict | None:
    """The last hourly candle ending at or before tip (epoch seconds): its closing yes bid and ask,
    and the contracts traded in every candle up to it. None when no candle ends before tip."""
    before = [c for c in candles or [] if int(c.get("end_period_ts", 0)) <= tip_ts]
    if not before:
        return None
    last = max(before, key=lambda c: int(c["end_period_ts"]))
    return {
        "bid": _f((last.get("yes_bid") or {}).get("close")),
        "ask": _f((last.get("yes_ask") or {}).get("close")),
        "volume": float(sum(_f(c.get("volume")) or 0.0 for c in before)),
        "candle_end": int(last["end_period_ts"]),
    }


def liquid_mid(quote: dict | None, cfg: Settings) -> float | None:
    """The live rule (kalshi._mid): both quotes, spread within max_spread, volume at least
    min_volume. The mid, or None when illiquid."""
    if quote is None:
        return None
    return kalshi._mid(quote["bid"], quote["ask"], quote["volume"], cfg)


# ------------------------------------------------------------------ the baseline's P(over)
def p_over_normal(mu, sd, threshold) -> np.ndarray:
    """P(X > threshold) for X ~ normal(mu, sd); a zero spread is a point mass at mu."""
    mu, sd, k = (np.asarray(x, dtype=float) for x in (mu, sd, threshold))
    safe = np.where(sd > 0, sd, 1.0)
    return np.where(sd > 0, norm.sf(k, loc=mu, scale=safe), (mu > k).astype(float))


def p_over_count(mu, sd, threshold) -> np.ndarray:
    """P(X > threshold) for a count X with mean mu and variance sd^2: negative binomial, or
    Poisson when the variance is at or below the mean."""
    mu, sd, k = (np.asarray(x, dtype=float) for x in (mu, sd, threshold))
    var = sd**2
    kk = np.floor(k)                                       # X > 2.5  <=>  X >= 3  <=>  sf(2)
    out = np.where(mu > 0, poisson.sf(kk, np.where(mu > 0, mu, 1.0)), (k < 0).astype(float))
    od = (mu > 0) & (var > mu * (1 + 1e-9))
    if od.any():
        r = mu[od] ** 2 / (var[od] - mu[od])
        out = out.copy()
        out[od] = nbinom.sf(kk[od], r, r / (r + mu[od]))
    return out


def add_baseline(rungs: pd.DataFrame) -> pd.DataFrame:
    """Rungs with the baseline's probabilities: `p_base` (normal, if he plays: the judged one),
    `p_base_count` (count family, shown) and `p_base_old` (P(plays) x P(over | plays), the earlier
    test's comparison, audit F17)."""
    out = rungs.copy()
    out["p_base"] = p_over_normal(out["mu"], out["sd"], out["threshold"])
    out["p_base_count"] = p_over_count(out["mu"], out["sd"], out["threshold"])
    out["p_base_old"] = out["p_play"].astype(float) * out["p_base"]
    return out


# ------------------------------------------------------------------ scores
def brier(p, y) -> np.ndarray:
    return (np.asarray(p, float) - np.asarray(y, float)) ** 2


def log_loss(p, y, clip: tuple[float, float]) -> np.ndarray:
    p = np.clip(np.asarray(p, float), *clip)
    y = np.asarray(y, float)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def paired_range(
    loss_a: np.ndarray, loss_b: np.ndarray, games: np.ndarray, draws: int, level: float, seed: int
) -> tuple[float, float, float]:
    """Mean of (a - b) per rung and its `level` range from resampling whole games (each draw:
    the games' summed differences over their rung counts)."""
    d = pd.DataFrame({"d": np.asarray(loss_a, float) - np.asarray(loss_b, float), "g": games})
    by = d.groupby("g")["d"].agg(["sum", "size"])
    sums, cnt = by["sum"].to_numpy(), by["size"].to_numpy()
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(sums), size=(draws, len(sums)))
    boot = sums[idx].sum(axis=1) / cnt[idx].sum(axis=1)
    tail = (1 - level) / 2
    return float(d["d"].mean()), float(np.quantile(boot, tail)), float(np.quantile(boot, 1 - tail))


def decide(n_rungs: int, hi: float, cfg: PropsTestConfig) -> str:
    """The rule: the market leads only with enough rungs and a range entirely below zero."""
    if n_rungs < cfg.min_rungs:
        return "baseline keeps (too few rungs)"
    if hi < 0:
        return "market leads"
    return "baseline keeps (not shown)"


def score(rungs: pd.DataFrame, cfg: PropsTestConfig) -> pd.DataFrame:
    """One row per stat over the scored rungs (`add_baseline` output, played only)."""
    rows = []
    for stat, g in rungs.groupby("stat", sort=False):
        y = g["y"].to_numpy(float)
        bm, bb = brier(g["p_market"], y), brier(g["p_base"], y)
        diff, lo, hi = paired_range(bm, bb, g["game_id"].to_numpy(), cfg.draws, cfg.level, cfg.seed)
        bo = brier(g["p_base_old"], y)
        d_old, lo_old, hi_old = paired_range(bm, bo, g["game_id"].to_numpy(), cfg.draws, cfg.level, cfg.seed)
        judged = stat in cfg.judged
        rows.append(
            {
                "stat": stat,
                "judged": judged,
                "rungs": len(g),
                "games": int(g["game_id"].nunique()),
                "player_games": int(g[["game_id", "player_id"]].drop_duplicates().shape[0]),
                "base_rate": float(y.mean()),
                "brier_market": float(bm.mean()),
                "brier_base": float(bb.mean()),
                "diff": diff,
                "lo": lo,
                "hi": hi,
                "brier_base_count": float(brier(g["p_base_count"], y).mean()),
                "brier_base_old": float(bo.mean()),
                "diff_old": d_old,
                "lo_old": lo_old,
                "hi_old": hi_old,
                "logloss_market": float(log_loss(g["p_market"], y, cfg.prob_clip).mean()),
                "logloss_base": float(log_loss(g["p_base"], y, cfg.prob_clip).mean()),
                "logloss_base_count": float(log_loss(g["p_base_count"], y, cfg.prob_clip).mean()),
                "decision": decide(len(g), hi, cfg) if judged else "reference (no rule)",
            }
        )
    return pd.DataFrame(rows)


def calibration(rungs: pd.DataFrame, col: str) -> pd.DataFrame:
    """Five 20-point bands of a probability column: rungs, mean predicted, share that happened."""
    band = pd.cut(rungs[col], BANDS, include_lowest=True).astype(str).rename("band")
    g = rungs.groupby([rungs["stat"], band], observed=True)
    return g.agg(n=("y", "size"), predicted=(col, "mean"), happened=("y", "mean")).reset_index()


# ------------------------------------------------------------------ implied means (secondary)
def implied_means(rungs: pd.DataFrame, sd_bounds: tuple[float, float]) -> pd.DataFrame:
    """Per player-game-stat with a liquid ladder: the market's mean if he plays (`market.fit`,
    as the overlay fits it, against the baseline's spread), the baseline's, and the actual."""
    rows = []
    for (gid, pid, stat), g in rungs.groupby(["game_id", "player_id", "stat"]):
        sd = float(g["sd"].iloc[0])
        res = market.fit(g["threshold"].to_numpy(float), g["p_market"].to_numpy(float), sd, sd_bounds)
        if res is None:
            continue
        rows.append(
            {
                "game_id": gid,
                "player_id": pid,
                "stat": stat,
                "rungs": len(g),
                "market_mean": res[0],
                "base_mean": float(g["mu"].iloc[0]),
                "actual": float(g["actual"].iloc[0]),
            }
        )
    return pd.DataFrame(rows, columns=["game_id", "player_id", "stat", "rungs", "market_mean",
                                       "base_mean", "actual"])


def rmse_table(means: pd.DataFrame, cfg: PropsTestConfig) -> pd.DataFrame:
    """RMSE of the market's and the baseline's means against actual, per stat, with the range of
    the squared-error difference by resampling whole games."""
    rows = []
    for stat, g in means.groupby("stat", sort=False):
        em = (g["market_mean"] - g["actual"]) ** 2
        eb = (g["base_mean"] - g["actual"]) ** 2
        d, lo, hi = paired_range(em.to_numpy(), eb.to_numpy(), g["game_id"].to_numpy(), cfg.draws, cfg.level,
                                 cfg.seed)
        rows.append(
            {
                "stat": stat,
                "player_games": len(g),
                "median_rungs": float(g["rungs"].median()),
                "rmse_market": float(np.sqrt(em.mean())),
                "rmse_base": float(np.sqrt(eb.mean())),
                "mse_diff": d,
                "lo": lo,
                "hi": hi,
                "bias_market": float((g["market_mean"] - g["actual"]).mean()),
                "bias_base": float((g["base_mean"] - g["actual"]).mean()),
            }
        )
    return pd.DataFrame(rows)

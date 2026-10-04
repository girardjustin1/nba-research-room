"""Draft values: per-category z-scores, punt masks, value over replacement, tiers.

Inputs: the draft pool from `ingest.external_proj.blend_preseason` (per-game mean/sd per stat,
games, position), settings.categories / league / draft. Optional slot eligibility per player
(Yahoo's, once a players.csv snapshot exists).
Outputs: one row per player with z_<category>, value_pg, replacement_pg, vorp_pg, value
(season), rank, tier, eligible slots.
Tables: none (pure; the Draft page holds the result in memory).

Method:
- Counting categories: z = (x - mean) / sd over the reference pool; TO is negated.
- Percentages are weighted by volume: impact = (player% - pool%) x attempts = made - pool% x
  attempts, then z-scored. A 50% shooter on 20 attempts outweighs one on 2.
- The reference pool is the top `pool_size` by value; it is re-chosen until it stops changing.
- Punted categories are masked to zero in value_pg (their z columns are still shown).
- Replacement level: after teams x rounds picks, the best remaining player eligible at each
  position. A player's replacement is the lowest across his positions (more flexibility, more
  value). value = (value_pg - replacement_pg) x games / 82.
- Tiers are natural breaks (optimal 1-D clustering) over the top pool (settings.draft.tiers).
"""

from __future__ import annotations

from collections.abc import Iterable

import numpy as np
import pandas as pd

from research_room.config import Settings, settings

NBA_REGULAR_SEASON_GAMES = 82        # games per team; a fact of the schedule, not a weight
_PRIMARY = ("PG", "SG", "SF", "PF", "C")
_MAX_POOL_ITERATIONS = 10


def default_eligibility(pool: pd.DataFrame, cfg: Settings) -> pd.Series:
    """Slots each player can fill, from BBM's primary position via settings."""
    mapping = cfg.draft.position_eligibility
    return pool["position"].map(lambda p: list(mapping.get(str(p), ["Util"])))


def _z_scores(pool: pd.DataFrame, ref: pd.Index, cfg: Settings) -> pd.DataFrame:
    z = pd.DataFrame(index=pool.index)
    for cat in cfg.categories:
        if cat.kind == "pct":
            made, att = pool[f"{cat.made}_mean"], pool[f"{cat.attempts}_mean"]
            pool_pct = made.loc[ref].sum() / att.loc[ref].sum()
            x = made - pool_pct * att
        else:
            x = pool[f"{cat.key}_mean"]
        mu, sd = x.loc[ref].mean(), x.loc[ref].std(ddof=0)
        score = (x - mu) / sd if sd > 0 else x * 0.0
        z[f"z_{cat.key}"] = score if cat.higher_is_better else -score
    return z


def compute_values(pool: pd.DataFrame, cfg: Settings | None = None, punts: Iterable[str] = (),
                   eligibility: pd.Series | None = None) -> pd.DataFrame:
    """Value every player in `pool`. `punts` are category keys (e.g. {"ft_pct", "tov"})."""
    cfg = cfg or settings()
    punts = set(punts)
    unknown = punts - {c.key for c in cfg.categories}
    if unknown:
        raise ValueError(f"unknown punt categories {sorted(unknown)}")
    df = pool.reset_index(drop=True).copy()
    df["eligible"] = (eligibility.reset_index(drop=True) if eligibility is not None
                      else default_eligibility(df, cfg))
    keys = [c.key for c in cfg.categories if c.key not in punts]
    n_pool = min(cfg.draft.pool_size, len(df))

    ref = df.index
    for _ in range(_MAX_POOL_ITERATIONS):
        z = _z_scores(df, ref, cfg)
        value_pg = z[[f"z_{k}" for k in keys]].sum(axis=1)
        new_ref = value_pg.nlargest(n_pool).index
        if set(new_ref) == set(ref):
            break
        ref = new_ref
    df = pd.concat([df, z], axis=1)
    df["value_pg"] = value_pg

    drafted = set(df["value_pg"].nlargest(min(cfg.league.teams * cfg.draft.rounds, len(df))).index)
    undrafted = df.loc[~df.index.isin(drafted)]
    repl = {}
    for pos in _PRIMARY:
        can = undrafted[undrafted["eligible"].map(lambda e, p=pos: p in e)]
        if can.empty:                                    # everyone at this position gets drafted
            can = df[df["eligible"].map(lambda e, p=pos: p in e)]
            repl[pos] = float(can["value_pg"].min()) if not can.empty else 0.0
        else:
            repl[pos] = float(can["value_pg"].max())
    overall = float(undrafted["value_pg"].max()) if not undrafted.empty else 0.0
    df["replacement_pg"] = df["eligible"].map(
        lambda e: min((repl[p] for p in e if p in repl), default=overall))
    df["vorp_pg"] = df["value_pg"] - df["replacement_pg"]
    df["value"] = df["vorp_pg"] * df["games"] / NBA_REGULAR_SEASON_GAMES

    df = df.sort_values("value", ascending=False, ignore_index=True)
    df["rank"] = np.arange(1, len(df) + 1)
    df["tier"] = assign_tiers(df["value"], n_pool, cfg.draft.tiers)
    df.attrs.update({"punts": sorted(punts), "replacement": repl, "pool_size": n_pool})
    return df


def natural_breaks(values: np.ndarray, k: int) -> np.ndarray:
    """Optimal 1-D clustering (Jenks / ckmeans): split sorted `values` into k contiguous groups
    minimising within-group squared error. Returns a group number (1..k) per value."""
    n = len(values)
    k = max(1, min(k, n))
    x = np.asarray(values, dtype=float)
    s1 = np.r_[0.0, np.cumsum(x)]
    s2 = np.r_[0.0, np.cumsum(x * x)]

    def sse(i: int, j: np.ndarray) -> np.ndarray:        # cost of x[j..i] for each start j
        cnt = i + 1 - j
        tot = s1[i + 1] - s1[j]
        return (s2[i + 1] - s2[j]) - tot * tot / cnt

    cost = np.full((k, n), np.inf)
    back = np.zeros((k, n), dtype=int)
    cost[0] = [sse(i, np.array([0]))[0] for i in range(n)]
    for g in range(1, k):
        for i in range(g, n):
            j = np.arange(g, i + 1)
            c = cost[g - 1, j - 1] + sse(i, j)
            best = int(np.argmin(c))
            cost[g, i], back[g, i] = c[best], j[best]
    labels = np.empty(n, dtype=int)
    i = n - 1
    for g in range(k - 1, -1, -1):
        start = back[g, i] if g > 0 else 0
        labels[start:i + 1] = g + 1
        i = start - 1
    return labels


def assign_tiers(values: pd.Series, n_top: int, n_tiers: int) -> pd.Series:
    """Tiers for values sorted descending: natural breaks within the top `n_top`; everyone below
    the top pool shares one final tier."""
    v = values.to_numpy()
    top = natural_breaks(v[:n_top], n_tiers)
    rest = np.full(len(v) - len(top), (top.max() if len(top) else 0) + 1)
    return pd.Series(np.r_[top, rest], index=values.index)


def category_balance(roster: pd.DataFrame, cfg: Settings | None = None) -> pd.Series:
    """Sum of each category z across a roster: where the team is strong (+) or weak (-)."""
    cfg = cfg or settings()
    cols = [f"z_{c.key}" for c in cfg.categories]
    if roster.empty:
        return pd.Series(0.0, index=[c[2:] for c in cols])
    return roster[cols].sum().rename(lambda c: c[2:])

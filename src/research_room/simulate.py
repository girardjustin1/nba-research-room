"""Head-to-head week simulation: P(win each category), expected categories won, P(win week).

Shared by the draft board (Phase D) and the season tool (Phase 2).

Inputs: per-player per-game mean and sd for each stat (columns `<stat>_mean`, `<stat>_sd`),
and how many games each player is expected to count in the week (`week_games`).
settings.categories defines the nine categories, which are percentages, and TO's direction.
Outputs: `Matchup` with per-category win probabilities, expected categories won, and
P(win the week) for the league format (Head-to-Head One Win: win a majority of categories).
Tables: none.

Model:
- A player's weekly total in a counting stat is the sum of `week_games` independent games:
  mean = g x mean_pg, variance = g x sd_pg^2. Team totals add (players independent).
- A team's percentage is made / attempts. Its variance uses the binomial approximation given
  attempts: sum(g x att x p(1-p)) / attempts^2, with p each player's own percentage.
- Analytic mode: P(win category) = Phi(edge / sqrt(var_me + var_opp)). Categories are treated
  as independent, so P(win week) is a Poisson-binomial tail, computed exactly.
- Monte Carlo mode draws the same normal totals (5,000 by default) and counts wins; it is the
  hook for Kalshi implied distributions in Phase 2. Ties count as losses (conservative).

The simulator never takes a point estimate alone: every input has a mean and an sd.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy.stats import norm

from research_room.config import Category, Settings, settings


@dataclass(frozen=True)
class TeamWeek:
    """Weekly totals for one team (or a batch of candidate teams: values may be arrays)."""
    mean: dict[str, np.ndarray]       # counting categories: expected weekly total
    var: dict[str, np.ndarray]        # counting categories: variance of that total
    made: dict[str, np.ndarray]       # percentage categories: expected makes
    att: dict[str, np.ndarray]        # percentage categories: expected attempts
    bin_var: dict[str, np.ndarray]    # percentage categories: sum g * att * p(1-p)


@dataclass(frozen=True)
class Matchup:
    p_cat: dict[str, np.ndarray]
    expected_cats: np.ndarray
    p_win_week: np.ndarray
    cats_to_win: int

    def summary(self) -> dict:
        def f(x):
            return float(np.asarray(x).ravel()[0])
        return {"p_cat": {k: f(v) for k, v in self.p_cat.items()},
                "expected_cats": f(self.expected_cats), "p_win_week": f(self.p_win_week)}


def cats_to_win(cfg: Settings) -> int:
    """Categories needed to win the week: a strict majority."""
    return len(cfg.categories) // 2 + 1


def contributions(players: pd.DataFrame, cfg: Settings) -> pd.DataFrame:
    """Per-player weekly contributions, one column per (kind, category). Needs `week_games`."""
    g = players["week_games"].astype(float)
    out = {}
    for cat in cfg.categories:
        if cat.kind == "pct":
            made, att = players[f"{cat.made}_mean"], players[f"{cat.attempts}_mean"]
            p = (made / att).where(att > 0, 0.0)
            out[("made", cat.key)] = g * made
            out[("att", cat.key)] = g * att
            out[("bin_var", cat.key)] = g * att * p * (1 - p)
        else:
            out[("mean", cat.key)] = g * players[f"{cat.key}_mean"]
            out[("var", cat.key)] = g * players[f"{cat.key}_sd"] ** 2
    return pd.DataFrame(out, index=players.index)


def team_week(contrib: pd.DataFrame) -> TeamWeek:
    """Sum player contributions into one team."""
    s = contrib.sum()
    pick = lambda kind: {k: np.asarray(v) for (kd, k), v in s.items() if kd == kind}  # noqa: E731
    return TeamWeek(pick("mean"), pick("var"), pick("made"), pick("att"), pick("bin_var"))


def add(base: TeamWeek, extra: pd.DataFrame) -> TeamWeek:
    """Batch: `base` plus each row of `extra` (one candidate per row) -> arrays of teams."""
    def col(kind, k):
        return extra[(kind, k)].to_numpy() if (kind, k) in extra else 0.0
    return TeamWeek(
        {k: v + col("mean", k) for k, v in base.mean.items()},
        {k: v + col("var", k) for k, v in base.var.items()},
        {k: v + col("made", k) for k, v in base.made.items()},
        {k: v + col("att", k) for k, v in base.att.items()},
        {k: v + col("bin_var", k) for k, v in base.bin_var.items()},
    )


def _edge(me: TeamWeek, opp: TeamWeek, cat: Category) -> tuple[np.ndarray, np.ndarray]:
    """(mean difference, sd of difference) for one category, me minus opponent."""
    if cat.kind == "pct":
        k = cat.key
        p_me, p_op = me.made[k] / me.att[k], opp.made[k] / opp.att[k]
        var = me.bin_var[k] / me.att[k] ** 2 + opp.bin_var[k] / opp.att[k] ** 2
        diff = p_me - p_op
    else:
        diff = me.mean[cat.key] - opp.mean[cat.key]
        var = me.var[cat.key] + opp.var[cat.key]
    if not cat.higher_is_better:
        diff = -diff
    return np.asarray(diff, dtype=float), np.sqrt(np.asarray(var, dtype=float))


def poisson_binomial_at_least(p: np.ndarray, k: int) -> np.ndarray:
    """P(at least k successes) for independent Bernoullis; p has shape (n_cats, batch)."""
    p = np.atleast_2d(p)
    dist = np.zeros((p.shape[0] + 1, p.shape[1]))
    dist[0] = 1.0
    for row in p:
        dist[1:] = dist[1:] * (1 - row) + dist[:-1] * row
        dist[0] = dist[0] * (1 - row)
    return dist[k:].sum(axis=0)


def analytic(me: TeamWeek, opp: TeamWeek, cfg: Settings | None = None) -> Matchup:
    cfg = cfg or settings()
    p_cat = {}
    for cat in cfg.categories:
        diff, sd = _edge(me, opp, cat)
        p_cat[cat.key] = np.where(sd > 0, norm.cdf(diff / np.where(sd > 0, sd, 1.0)), (diff > 0) * 1.0)
    stacked = np.vstack([np.atleast_1d(v) for v in p_cat.values()])
    need = cats_to_win(cfg)
    return Matchup(p_cat, stacked.sum(axis=0), poisson_binomial_at_least(stacked, need), need)


def monte_carlo(me: TeamWeek, opp: TeamWeek, cfg: Settings | None = None, n: int = 5000,
                seed: int | None = 0) -> Matchup:
    """Same model by simulation. Batch-aware: every array entry gets its own n draws."""
    cfg = cfg or settings()
    rng = np.random.default_rng(seed)
    wins = []
    for cat in cfg.categories:
        diff, sd = _edge(me, opp, cat)
        diff, sd = np.atleast_1d(diff), np.atleast_1d(sd)
        draws = diff[None, :] + sd[None, :] * rng.standard_normal((n, diff.size))
        wins.append(draws > 0)
    w = np.stack(wins)                                   # (cats, n, batch)
    need = cats_to_win(cfg)
    p_cat = {c.key: w[i].mean(axis=0) for i, c in enumerate(cfg.categories)}
    return Matchup(p_cat, w.sum(axis=0).mean(axis=0), (w.sum(axis=0) >= need).mean(axis=0), need)

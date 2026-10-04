"""Snake-draft pick arithmetic and P(player still available at a later pick).

Inputs: the valued draft pool (ADP columns from Basketball Monster), settings.league.teams,
settings.draft (rounds, adp uncertainty).
Outputs: pick numbers for a slot; per-player expected pick, sd, and availability probability.
Tables: none (pure).

Conventions: overall picks, rounds and slots are 1-indexed; slot 1 picks first in round 1.

Availability model: a player's draft position ~ Normal(expected_pick, sd). expected_pick is
Yahoo ADP, else BBM Advanced ADP, else BBM rank (with sd x fallback_sd_multiplier, since rank
is a value order, not a draft order). sd = sd_base + sd_per_round x (round - 1), so late-round
ADP is less certain. P(still there at pick k | still there now, at pick c) =
(1 - F(k - 0.5)) / (1 - F(c - 0.5)), with continuity correction.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import norm

from research_room.config import Settings, settings


def round_of(pick: int, teams: int) -> int:
    return (pick - 1) // teams + 1


def slot_of(pick: int, teams: int) -> int:
    """Which draft slot makes overall pick `pick` in a snake draft."""
    rnd, idx = round_of(pick, teams), (pick - 1) % teams
    return idx + 1 if rnd % 2 == 1 else teams - idx


def pick_number(rnd: int, slot: int, teams: int) -> int:
    """Overall pick for (round, slot)."""
    if not (1 <= slot <= teams) or rnd < 1:
        raise ValueError(f"round {rnd} / slot {slot} out of range for {teams} teams")
    within = slot if rnd % 2 == 1 else teams - slot + 1
    return (rnd - 1) * teams + within


def picks_for_slot(slot: int, teams: int, rounds: int) -> list[int]:
    return [pick_number(r, slot, teams) for r in range(1, rounds + 1)]


def next_pick(slot: int, after: int, teams: int, rounds: int) -> int | None:
    """The slot's first pick strictly after overall pick `after` (None when it has none left)."""
    return next((p for p in picks_for_slot(slot, teams, rounds) if p > after), None)


def expected_pick(pool: pd.DataFrame, cfg: Settings | None = None) -> pd.DataFrame:
    """Add expected_pick, adp_source and adp_sd to the pool."""
    cfg = cfg or settings()
    a, teams = cfg.draft.adp, cfg.league.teams
    out = pool.copy()
    src = np.where(out["yahoo_adp"].notna(), "yahoo",
                   np.where(out["adv_adp"].notna(), "bbm_adp", "bbm_rank"))
    exp = out["yahoo_adp"].fillna(out["adv_adp"]).fillna(out["ext_rank"]).fillna(float(len(out)))
    rounds = np.floor((exp.clip(lower=1) - 1) / teams) + 1
    sd = a.sd_base_picks + a.sd_per_round * (rounds - 1)
    sd = np.where(src == "bbm_rank", sd * a.fallback_sd_multiplier, sd)
    out["expected_pick"], out["adp_source"], out["adp_sd"] = exp.to_numpy(), src, sd
    return out


def prob_available(expected: np.ndarray | pd.Series, sd: np.ndarray | pd.Series, at_pick: int,
                   current_pick: int) -> np.ndarray:
    """P(still undrafted at `at_pick`, given still undrafted at `current_pick`)."""
    exp, s = np.asarray(expected, dtype=float), np.asarray(sd, dtype=float)
    if at_pick <= current_pick:
        return np.ones_like(exp)
    survive_later = norm.sf(at_pick - 0.5, loc=exp, scale=s)
    survive_now = norm.sf(current_pick - 0.5, loc=exp, scale=s)
    with np.errstate(divide="ignore", invalid="ignore"):
        p = np.where(survive_now > 1e-12, survive_later / survive_now, 0.0)
    return np.clip(p, 0.0, 1.0)

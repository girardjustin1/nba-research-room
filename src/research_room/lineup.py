"""Daily lineup assigner: who starts in which slot today (and each remaining day of the week).

Inputs: my roster (player_id, name, eligible positions, injury status, current slot), the day's
projections per player (expected per-game stats, already multiplied by P(plays)), category
weights, which players are locked (their game has tipped), settings.roster.
Outputs: `DayLineup` (slot -> player, bench, IL, value, per-change reasons, solver status, and a
readable reason when no lineup is possible).
Tables: none (pure; the nightly job and the API feed it).

Model (PuLP/CBC): binary x[p, s] = player p starts in slot s. Each starting slot takes at most one
player, each player at most one slot, only eligible slots, locked players keep their slot.
Objective: sum of value(p) over starters, value(p) = sum over categories of weight_c x projected
contribution (TO counts against; FG%/FT% as volume-weighted impact). Only players with a game that
day can add value, so an idle or ruled-out player never takes a start from someone who plays.
Phase 2 swaps in matchup-aware weights (marginal P(win week) per category).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd
import pulp

from research_room.config import Settings, settings

IL_STATUSES = {"INJ", "O", "OUT", "IL", "IL+", "OUT FOR SEASON"}


@dataclass
class DayLineup:
    status: str                          # optimal | infeasible | error
    starters: dict[str, int | None]      # slot label (e.g. "C#2") -> player_id
    bench: list[int]
    il: list[int]
    value: float
    changes: list[dict] = field(default_factory=list)
    reason: str | None = None


def category_weights(pool_proj: pd.DataFrame, cfg: Settings | None = None) -> dict[str, float]:
    """1 / sd of each category's per-game contribution across rotation players, so one standard
    deviation of any category counts the same. Percentages use made - league% x attempts."""
    cfg = cfg or settings()
    w = {}
    for c in cfg.categories:
        if c.kind == "pct":
            made, att = pool_proj[c.made], pool_proj[c.attempts]
            x = made - (made.sum() / att.sum()) * att
        else:
            x = pool_proj[c.key]
        sd = float(x.std(ddof=0))
        w[c.key] = (1.0 / sd if sd > 0 else 0.0) * (1 if c.higher_is_better else -1)
    return w


def player_value(day: pd.DataFrame, weights: dict[str, float], league_pct: dict[str, float],
                 cfg: Settings | None = None) -> pd.Series:
    """Weighted value of each player's projected line for the day (index = player_id)."""
    cfg = cfg or settings()
    v = pd.Series(0.0, index=day.index)
    for c in cfg.categories:
        impact = day[c.made] - league_pct[c.key] * day[c.attempts] if c.kind == "pct" else day[c.key]
        v = v + weights[c.key] * impact.fillna(0.0)
    return v


def fillable(eligible, cfg: Settings) -> set[str]:
    """Slots a player can start in. Yahoo may list only positions ("PG,SG"); each one also
    fills its combo slot and Util (settings.draft.position_eligibility: PG -> PG, G, Util)."""
    mapping = cfg.draft.position_eligibility
    out = {"Util"}
    for pos in eligible or []:
        out.add(pos)
        out.update(mapping.get(pos, []))
    return out


def _slots(cfg: Settings) -> list[str]:
    """Starting slots with numbered duplicates: PG, SG, G, SF, PF, F, C#1, C#2, Util#1, Util#2."""
    raw = [s for s in cfg.roster.slots if s not in ("BN", "IL")]
    seen: dict[str, int] = {}
    out = []
    for s in raw:
        seen[s] = seen.get(s, 0) + 1
        out.append(f"{s}#{seen[s]}" if raw.count(s) > 1 else s)
    return out


def best_starters(roster: pd.DataFrame, values: pd.Series, has_game: pd.Series,
                  cfg: Settings | None = None) -> dict[str, int | None]:
    """Who starts in `assign_day`'s best lineup (no locks), found by an exact assignment instead of
    the MILP solver: the same best total value in about a thousandth of the time. For the matchup
    odds, which need only who starts each day; `assign_day` stays the lineup decision (locks,
    reasons). Equal-value lineups may break ties differently.

    Each player can take an eligible slot (worth his value if he has a game and it is positive, else
    0) or a bench column of his own (worth 0), so slots may stay empty, as in the MILP; a player
    starts only when his slot is worth more than 0."""
    import numpy as np
    from scipy.optimize import linear_sum_assignment

    cfg = cfg or settings()
    slots = _slots(cfg)
    starters: dict[str, int | None] = {s: None for s in slots}
    r = roster.set_index("player_id")
    il = [p for p in r.index if str(r.at[p, "status"] or "").upper() in IL_STATUSES][: cfg.roster.il]
    candidates = [p for p in r.index if p not in il]
    if not candidates:
        return starters
    val = [float(values.get(p, 0.0)) if bool(has_game.get(p, False)) else 0.0 for p in candidates]
    forbidden = -1e12
    m = np.full((len(candidates), len(slots) + len(candidates)), forbidden)
    for i, p in enumerate(candidates):
        fills = fillable(r.at[p, "eligible"], cfg)
        for j, slot in enumerate(slots):
            if slot.split("#")[0] in fills:
                m[i, j] = max(val[i], 0.0)
        m[i, len(slots) + i] = 0.0                                   # his own bench column
    rows, cols = linear_sum_assignment(m, maximize=True)
    for i, j in zip(rows, cols, strict=True):
        if j < len(slots) and m[i, j] > 0:
            starters[slots[j]] = int(candidates[i])
    return starters


def assign_day(roster: pd.DataFrame, values: pd.Series, has_game: pd.Series,
               locked: dict[int, str] | None = None, cfg: Settings | None = None) -> DayLineup:
    """Best lineup for one day. `roster`: player_id, name, eligible (list of slot codes), status,
    current_slot. `values`/`has_game`: indexed by player_id. `locked`: player_id -> slot label."""
    cfg = cfg or settings()
    locked = locked or {}
    slots = _slots(cfg)
    base = {s: s.split("#")[0] for s in slots}
    r = roster.set_index("player_id")
    il_cap = cfg.roster.il
    il = [p for p in r.index if str(r.at[p, "status"] or "").upper() in IL_STATUSES][:il_cap]
    candidates = [p for p in r.index if p not in il]
    for p, s in locked.items():
        if s not in slots:
            return DayLineup("infeasible", {}, [], il, 0.0,
                             reason=f"locked player {p} sits in unknown slot {s}")
        if base[s] not in fillable(r.at[p, "eligible"], cfg):
            return DayLineup("infeasible", {}, [], il, 0.0,
                             reason=f"{r.at[p, 'name']} is locked in {base[s]} but not eligible there")
    prob = pulp.LpProblem("day_lineup", pulp.LpMaximize)
    fills = {p: fillable(r.at[p, "eligible"], cfg) for p in candidates}
    pairs = [(p, s) for p in candidates for s in slots if base[s] in fills[p]]
    x = {(p, s): prob.add_variable(f"x_{i}", 0, 1, cat=pulp.LpBinary) for i, (p, s) in enumerate(pairs)}
    val = {p: float(values.get(p, 0.0)) if bool(has_game.get(p, False)) else 0.0 for p in candidates}
    prob += pulp.lpSum(val[p] * x[(p, s)] for p, s in pairs)
    for s in slots:
        prob += pulp.lpSum(x[(p, t)] for p, t in pairs if t == s) <= 1
    for p in candidates:
        prob += pulp.lpSum(x[(q, s)] for q, s in pairs if q == p) <= 1
    for p, s in locked.items():
        if (p, s) in x:
            prob += x[(p, s)] == 1
    stats = prob.solve(pulp.COIN_CMD(msg=False))
    if stats.status != pulp.LpSolveStatus.Optimal:
        return DayLineup("infeasible", {}, [], il, 0.0,
                         reason=f"solver status {stats.status.name}: check locks and eligibility")
    starters = {s: None for s in slots}
    for (p, s), var in x.items():
        if var.value() and var.value() > 0.5:
            starters[s] = int(p)
    starting = {p for p in starters.values() if p is not None}
    bench = [int(p) for p in candidates if p not in starting]
    out = DayLineup("optimal", starters, bench, [int(p) for p in il],
                    float(sum(val[p] for p in starting)))
    out.changes = _diff(r, starters, bench, il, val, has_game)
    return out


def _diff(r: pd.DataFrame, starters: dict, bench: list[int], il: list[int], val: dict,
          has_game: pd.Series) -> list[dict]:
    """Moves vs the current Yahoo lineup, each with a reason built from the numbers."""
    def current_base(p):
        return str(r.at[p, "current_slot"] or "BN").split("#")[0]
    changes = []
    for s, p in starters.items():
        if p is not None and current_base(p) in ("BN", "IL", ""):
            changes.append({"player_id": p, "name": r.at[p, "name"], "action": "START",
                            "slot": s.split("#")[0], "value": round(val.get(p, 0.0), 3),
                            "reason": "has a game today" if bool(has_game.get(p, False)) else "slot filler"})
    for p in bench:
        if current_base(p) not in ("BN", "IL", ""):
            why = "no game today" if not bool(has_game.get(p, False)) else "lower projected value today"
            changes.append({"player_id": p, "name": r.at[p, "name"], "action": "BENCH", "slot": "BN",
                            "value": round(val.get(p, 0.0), 3), "reason": why})
    for p in il:
        if current_base(p) != "IL":
            changes.append({"player_id": p, "name": r.at[p, "name"], "action": "IL", "slot": "IL",
                            "value": 0.0, "reason": f"status {r.at[p, 'status']}: frees a roster spot"})
    return changes


def league_pct(pool_proj: pd.DataFrame, cfg: Settings | None = None) -> dict[str, float]:
    cfg = cfg or settings()
    return {c.key: float(pool_proj[c.made].sum() / pool_proj[c.attempts].sum())
            for c in cfg.categories if c.kind == "pct"}


def wide_day(proj_long: pd.DataFrame, day) -> pd.DataFrame:
    """Long projections (player_id, date, stat, mean) for one day -> wide per player."""
    d = proj_long[proj_long["date"] == day]
    return d.pivot_table(index="player_id", columns="stat", values="mean", aggfunc="sum").fillna(0.0) \
        if not d.empty else pd.DataFrame()

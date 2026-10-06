"""Weekly add/drop optimizer: which free agents to add, who to drop, and on which day.

Inputs: the matchup engine's week (matchup.week_inputs: both teams, live totals, calibrated
spreads and correlation, every player's projections), free agents from the latest players.csv
(yahoo_players: no owner, matched to a player, not ruled out), acquisitions left this week,
settings.optimizer / roster / transactions.
Outputs: `Plan` (moves with the day each takes effect, the roster on each remaining day, its exact
P(win week)), single-move effects, and feasibility checks for a chosen set of moves.
Tables: reads through matchup.week_inputs and yahoo_players; writes nothing.

Method (weekly MILP, PuLP/CBC), linearized around the current matchup:
- Weights. For each category c, w_c = dP(win week)/d(my weekly total in c)
  = P(c is pivotal: exactly 4 of the other 8 won) x phi(z_c) / sd_c. FG%/FT% weigh makes and
  attempts through the team ratio. Punted categories weigh 0. A player's value on a day is his
  projected line (already x P(plays)) dotted with the weights, so the objective is the plan's
  first-order gain in P(win week).
- Variables: y[p,t] (on my roster on day t), x[p,s,t] (starts in slot s on day t, only with a
  game and eligibility), a[p,t] (a free agent is added, effective day t).
- Constraints: 10 active slots and one slot per player per day; roster spots (active + bench;
  IL occupants stay put); my players only leave (drops), free agents can be added and later
  dropped (streaming), each add uses an acquisition and sum(a) <= acquisitions left; adds take
  effect `add_takes_effect_days` after today; each add must gain at least
  `min_gain_per_acquisition` (a penalty in the objective).
- The plan is then scored exactly by the matchup engine. The weights are recomputed at the plan
  and the MILP re-solved (`relinearize_iterations`); the plan with the best exact P(win week)
  is kept, and it must beat doing nothing or the plan is empty.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import date

import numpy as np
import pandas as pd
import pulp
from scipy.stats import norm

from research_room import lineup, matchup, simulate
from research_room.config import Settings, settings

IL_SLOT = "IL"


# ------------------------------------------------------------------ weights (pure)


def category_weights(
    me: simulate.TeamWeek,
    opp: simulate.TeamWeek,
    cfg: Settings,
    var_mult: dict[str, float] | None = None,
    punts: set[str] | None = None,
) -> dict:
    """{"count": {cat: w per unit}, "made": {cat: w}, "att": {cat: w}} for my weekly totals."""
    punts = punts or set()
    p, dens = {}, {}
    for c in cfg.categories:
        diff, sd = simulate._edge(me, opp, c, var_mult)
        diff, sd = float(np.ravel(diff)[0]), float(np.ravel(sd)[0])
        p[c.key] = float(norm.cdf(diff / sd)) if sd > 0 else float(diff > 0)
        dens[c.key] = float(norm.pdf(diff / sd) / sd) if sd > 0 else 0.0
    need = simulate.cats_to_win(cfg)
    out = {"count": {}, "made": {}, "att": {}}
    keys = [c.key for c in cfg.categories]
    for c in cfg.categories:
        others = np.array([[p[k]] for k in keys if k != c.key])
        # P(exactly need-1 of the others) = P(at least need-1) - P(at least need)
        pivot = float(
            simulate.poisson_binomial_at_least(others, need - 1)[0]
            - simulate.poisson_binomial_at_least(others, need)[0]
        )
        g = 0.0 if c.key in punts else pivot * dens[c.key]
        if c.kind == "pct":
            att, made = float(np.ravel(me.att[c.key])[0]), float(np.ravel(me.made[c.key])[0])
            out["made"][c.key] = g / att if att > 0 else 0.0
            out["att"][c.key] = -g * (made / att) / att if att > 0 else 0.0
        else:
            out["count"][c.key] = g if c.higher_is_better else -g
    return out


def day_values(
    proj: pd.DataFrame, ids: list[int], days: list[date], weights: dict, cfg: Settings
) -> pd.DataFrame:
    """Value of each player's projected line on each day: index player_id, columns day index.
    Zero on days without a game (no projection rows)."""
    out = pd.DataFrame(0.0, index=pd.Index(ids, name="player_id"), columns=range(len(days)))
    sub = proj[proj["player_id"].isin(ids)]
    for t, day in enumerate(days):
        d = sub[sub["date"] == day]
        if d.empty:
            continue
        w = d.pivot_table(index="player_id", columns="stat", values="mean", aggfunc="sum").fillna(0.0)
        v = pd.Series(0.0, index=w.index)
        for c in cfg.categories:
            if c.kind == "pct":
                v += weights["made"][c.key] * w.get(c.made, 0.0) + weights["att"][c.key] * w.get(
                    c.attempts, 0.0
                )
            else:
                v += weights["count"][c.key] * w.get(c.key, 0.0)
        out.loc[v.index.intersection(out.index), t] = v
    return out


# ------------------------------------------------------------------ moves and rosters


@dataclass(frozen=True)
class Move:
    move_id: str
    add: int | None  # free agent player_id
    drop: int | None  # player leaving my roster
    effective: date  # first day the new roster counts


def move_id(add: int | None, drop: int | None, day: date) -> str:
    return f"add-{add or 0}-drop-{drop or 0}-{day.isoformat()}"


def apply_moves(
    base: pd.DataFrame, pool: pd.DataFrame, moves: list[Move], days: list[date]
) -> list[pd.DataFrame]:
    """My roster on each remaining day after `moves` (drops leave, adds join, from `effective`)."""
    rows = {int(r.player_id): r for r in pool.itertuples(index=False)}
    out = []
    for day in days:
        r = base.copy()
        for m in sorted(moves, key=lambda m: m.effective):
            if m.effective > day:
                continue
            if m.drop is not None:
                r = r[r["player_id"] != m.drop]
            if m.add is not None and m.add in rows and m.add not in set(r["player_id"]):
                r = pd.concat(
                    [r, pd.DataFrame([rows[m.add]._asdict()]).assign(current_slot="BN")], ignore_index=True
                )
        out.append(r.reset_index(drop=True))
    return out


def roster_cap(cfg: Settings) -> int:
    return cfg.roster.active_per_day + cfg.roster.bench


def check(
    base: pd.DataFrame,
    moves: list[Move],
    acquisitions_left: int,
    cfg: Settings,
    days: list[date],
    earliest: date | None,
) -> str | None:
    """Why a set of moves can't all be made, or None when it can."""
    adds = [m.add for m in moves if m.add is not None]
    if len(adds) > acquisitions_left:
        return f"Uses {len(adds)} of {acquisitions_left} acquisitions left this week"
    if len(set(adds)) < len(adds):
        return "Adds the same player twice"
    drops = [m.drop for m in moves if m.drop is not None]
    if len(set(drops)) < len(drops):
        return "Drops the same player twice"
    if earliest and any(m.effective < earliest for m in moves):
        return f"Adds count from {earliest.isoformat()} at the earliest"
    non_il = base[base["current_slot"].fillna("BN") != IL_SLOT]
    on = set(non_il["player_id"])
    for day in days:
        live = set(on)
        for m in moves:
            if m.effective <= day:
                live.discard(m.drop)
                if m.add is not None:
                    live.add(m.add)
        if len(live) > roster_cap(cfg):
            return f"Roster would hold {len(live)} players on {day.isoformat()} (limit {roster_cap(cfg)})"
    return None


# ------------------------------------------------------------------ the MILP


@dataclass
class Plan:
    moves: list[Move]
    p_win_week: float
    expected_cats: float
    p_cat: dict[str, float]
    baseline_p: float
    status: str
    solve_ms: float
    iterations: int
    rosters: list[pd.DataFrame] = field(default_factory=list)
    message: str | None = None


def _solve(
    base: pd.DataFrame,
    pool: pd.DataFrame,
    values: pd.DataFrame,
    days: list[date],
    first_add: int,
    acquisitions_left: int,
    cfg: Settings,
) -> tuple[list[Move], str]:
    opt = cfg.optimizer
    slots = lineup._slots(cfg)
    slot_base = {s: s.split("#")[0] for s in slots}
    mine = base[base["current_slot"].fillna("BN") != IL_SLOT]
    R = [int(p) for p in mine["player_id"]]
    F = [int(p) for p in pool["player_id"] if int(p) not in set(R)]
    elig = {
        int(r.player_id): lineup.fillable(r.eligible, cfg)
        for r in pd.concat([mine, pool]).itertuples(index=False)
    }
    T = range(len(days))
    prob = pulp.LpProblem("weekly_add_drop", pulp.LpMaximize)
    var = lambda name: prob.add_variable(name, 0, 1, cat=pulp.LpBinary)  # noqa: E731
    y = {(p, t): var(f"y_{p}_{t}") for p in R + F for t in T}
    a = {(p, t): var(f"a_{p}_{t}") for p in F for t in T}
    x = {}
    for p in R + F:
        for t in T:
            v = float(values.at[p, t]) if p in values.index else 0.0
            if v == 0.0:
                continue  # no game (or no value): never worth a slot
            for s in slots:
                if slot_base[s] in elig.get(p, {"Util"}):
                    x[(p, s, t)] = var(f"x_{len(x)}")
    prob += pulp.lpSum(
        float(values.at[p, t]) * xv for (p, _s, t), xv in x.items()
    ) - opt.min_gain_per_acquisition * pulp.lpSum(a.values())
    for t in T:
        for s in slots:
            prob += pulp.lpSum(xv for (p, s2, t2), xv in x.items() if s2 == s and t2 == t) <= 1
        for p in R + F:
            prob += pulp.lpSum(xv for (p2, _s, t2), xv in x.items() if p2 == p and t2 == t) <= y[(p, t)]
        prob += pulp.lpSum(y[(p, t)] for p in R + F) <= roster_cap(cfg)
    for p in R:
        for t in T:
            if t < first_add:
                prob += y[(p, t)] == 1  # nothing changes before adds can count
            elif t > 0:
                prob += y[(p, t)] <= y[(p, t - 1)]  # my players only leave
    for p in F:
        for t in T:
            if t < first_add:
                prob += y[(p, t)] == 0
            prob += a[(p, t)] >= y[(p, t)] - (y[(p, t - 1)] if t > 0 else 0)
    prob += pulp.lpSum(a.values()) <= acquisitions_left
    for p in F:  # a dropped free agent goes to waivers: each is added at most once a week
        prob += pulp.lpSum(a[(p, t)] for t in T) <= 1
    stats = prob.solve(pulp.COIN_CMD(msg=False, timeLimit=opt.solver_time_limit_s))
    if stats.status != pulp.LpSolveStatus.Optimal:
        return [], stats.status.name.lower()
    on = lambda p, t: (y[(p, t)].value() or 0) > 0.5  # noqa: E731
    # Each add is paired with a drop. A drop the solution makes before the add that needs its spot
    # is held and made with that add (keeping the player until then can only help); a drop never
    # needed by an add isn't made. Dropping it would free a spot nothing uses.
    moves, pending = [], []
    for t in T:
        if t < first_add:
            continue
        added = sorted(
            (p for p in F if on(p, t) and (t == 0 or not on(p, t - 1))),
            key=lambda p: -float(values.loc[p].sum()),
        )
        if t == 0:
            left = [p for p in R if not on(p, 0)]  # dropped before the first day counts
        else:
            left = [p for p in R + F if on(p, t - 1) and not on(p, t)]
        pending += sorted(left, key=lambda p: float(values.loc[p].sum()))
        for ad in added:
            dr = pending.pop(0) if pending else None
            moves.append(Move(move_id(ad, dr, days[t]), ad, dr, days[t]))
    return moves, "optimal"


def evaluate(
    inp: dict, base: pd.DataFrame, pool: pd.DataFrame, moves: list[Move], cfg: Settings
) -> matchup.MatchupNow:
    """Exact P(win week) for my roster after `moves` (the matchup engine)."""
    rosters = apply_moves(base, pool, moves, inp["days"])
    me = matchup.team_days(rosters, inp["proj"], inp["days"], cfg)
    return matchup.matchup_now(
        me, inp["opp"], inp["me_done"], inp["opp_done"], inp["var_mult"], cfg, inp["corr"]
    )


def optimize(
    inp: dict,
    pool: pd.DataFrame,
    acquisitions_left: int,
    cfg: Settings | None = None,
    punts: set[str] | None = None,
) -> Plan:
    """Best plan for the rest of the week (see module doc). `pool`: free agents (roster columns)."""
    cfg = cfg or settings()
    t0 = time.perf_counter()
    base, days = inp["me_roster"], inp["days"]
    baseline = matchup.matchup_now(
        inp["me"], inp["opp"], inp["me_done"], inp["opp_done"], inp["var_mult"], cfg, inp["corr"]
    )
    first_add = first_add_index(days, inp["now"].date(), cfg)
    if not days or first_add >= len(days) or acquisitions_left <= 0:
        why = (
            "No acquisitions left this week"
            if acquisitions_left <= 0
            else "No days left where an add would count"
        )
        return Plan(
            [],
            baseline.p_win_week,
            baseline.expected_cats,
            baseline.p_cat,
            baseline.p_win_week,
            "skipped",
            round((time.perf_counter() - t0) * 1000, 1),
            0,
            message=why,
        )
    best = Plan(
        [],
        baseline.p_win_week,
        baseline.expected_cats,
        baseline.p_cat,
        baseline.p_win_week,
        "optimal",
        0.0,
        0,
    )
    me_team, moves = matchup._team(inp["me"], inp["me_done"], 0), []
    opp_team = matchup._team(inp["opp"], inp["opp_done"], 0)
    ids = list(dict.fromkeys([*base["player_id"].astype(int), *pool["player_id"].astype(int)]))
    status = "optimal"
    for it in range(cfg.optimizer.relinearize_iterations):
        w = category_weights(me_team, opp_team, cfg, inp["var_mult"], punts)
        values = day_values(inp["proj"], ids, days, w, cfg)
        cands = pool[
            pool["player_id"].isin(
                values.loc[pool["player_id"].astype(int)]
                .sum(axis=1)
                .nlargest(cfg.optimizer.candidate_pool)
                .index
            )
        ]
        moves, status = _solve(base, cands, values, days, first_add, acquisitions_left, cfg)
        if status != "optimal":
            break
        if check(base, moves, acquisitions_left, cfg, days, days[first_add]) is not None:
            status = "invalid"  # never score or return a plan the roster rules reject
            break
        m = evaluate(inp, base, pool, moves, cfg)
        if m.p_win_week > best.p_win_week:
            best = Plan(
                moves, m.p_win_week, m.expected_cats, m.p_cat, baseline.p_win_week, "optimal", 0.0, it + 1
            )
        me_team = matchup._team(
            matchup.team_days(apply_moves(base, pool, moves, days), inp["proj"], days, cfg), inp["me_done"], 0
        )
    if status != "optimal" and not best.moves:
        best.status = status
    best.rosters = apply_moves(base, pool, best.moves, days)
    best.solve_ms = round((time.perf_counter() - t0) * 1000, 1)
    if not best.moves:
        best.message = "No add beats doing nothing by enough to spend an acquisition."
    return best


def first_add_index(days: list[date], today: date, cfg: Settings) -> int:
    """Index of the first remaining day an add made now would count."""
    delay = cfg.optimizer.add_takes_effect_days
    return next((i for i, d in enumerate(days) if (d - today).days >= delay), len(days))


# ------------------------------------------------------------------ free agents from the store


def free_agents(con, cfg: Settings | None = None) -> pd.DataFrame:
    """Latest players.csv free agents matched to a player, without an out / IL status."""
    cfg = cfg or settings()
    df = con.execute("""
        SELECT player_id, player_name AS name, eligible_positions, status, pct_rostered
        FROM yahoo_players
        WHERE snapshot_at = (SELECT max(snapshot_at) FROM yahoo_players)
          AND owner_team_id IS NULL AND player_id IS NOT NULL
    """).df()
    df = df[~df["status"].fillna("").str.upper().isin(lineup.IL_STATUSES)]
    df["eligible"] = df["eligible_positions"].fillna("").map(lambda s: [p for p in s.split(",") if p])
    return (
        df.assign(player_id=lambda d: d["player_id"].astype(int), current_slot="BN")
        .drop_duplicates("player_id")
        .reset_index(drop=True)
    )

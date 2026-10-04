"""Live draft board: rank every available player by what he adds to my team's weekly H2H odds.

Inputs: the valued pool (`draft.value.compute_values` + `draft.availability.expected_pick`),
the `DraftState` from the tracker, settings, and games per team per week from the schedule.
Outputs: `BoardResult` with the top recommendations (numbers and plain-language reasons
built from those numbers), my category balance, punt-drift flags, and timings.
Tables: none (in memory during the draft; only pick logging touches the store).

How a candidate is scored:
1. My projected final team = my picks so far + the candidate + a *typical* player at each of my
   remaining picks (the average of players expected to go around that pick, by ADP, adjusted for
   positions the teams picking before me still need).
2. The opponent is a league-average drafted team: for each round, the average player expected
   to go in that round.
3. `simulate.analytic` gives P(win each category) and P(win the week); `gain` is the change in
   expected categories won (over un-punted categories) versus taking a typical player at this
   pick. The top `monte_carlo_top` are re-checked by simulation.
4. Waiting: P(the candidate is still there at my following pick) and the expected best
   expected-categories value available then, so "take now" vs "can wait" is explicit.

Players' weekly games = projected games / 82 x team games per week x (active slots / roster
size), the share of a roster's games that can be played in daily lineups.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from research_room import simulate
from research_room.config import Settings, settings
from research_room.draft.availability import next_pick, picks_for_slot, prob_available, slot_of
from research_room.draft.tracker import DraftState
from research_room.draft.value import NBA_REGULAR_SEASON_GAMES

_PRIMARY = ("PG", "SG", "SF", "PF", "C")


@dataclass
class BoardResult:
    table: pd.DataFrame
    decision_pick: int | None
    following_pick: int | None
    my_p_cat: dict[str, float]
    my_expected_cats: float
    my_p_win_week: float
    open_slots: list[str]
    drift: list[str]
    timings_ms: dict[str, float] = field(default_factory=dict)


def assign_slots(eligible: list[list[str]], slots: list[str]) -> list[str]:
    """Greedy fill of starting `slots` by eligibility, least-flexible players and most specific
    slots first. Returns the slots still open."""
    open_slots = list(slots)
    specificity = {s: sum(s in e for e in eligible) for s in set(slots)}
    for elig in sorted(eligible, key=len):
        choices = [s for s in open_slots if s in elig]
        if choices:
            open_slots.remove(min(choices, key=lambda s: specificity.get(s, 0)))
    return open_slots


class DraftBoard:
    """Holds the pool in memory for the whole draft; `recommend()` runs after every pick."""

    def __init__(self, valued: pd.DataFrame, cfg: Settings | None = None,
                 team_games_per_week: float = 3.0) -> None:
        self.cfg = cfg = cfg or settings()
        starters = [s for s in cfg.roster.slots if s not in ("BN", "IL")]
        self.starting_slots = starters
        utilization = min(1.0, cfg.roster.active_per_day / cfg.draft.rounds)
        pool = valued.copy().set_index("player_id", drop=False)
        pool["week_games"] = pool["games"] / NBA_REGULAR_SEASON_GAMES * team_games_per_week * utilization
        self.pool = pool
        self.contrib = simulate.contributions(pool, cfg)
        self.by_adp = pool.sort_values("expected_pick").index.to_numpy()
        self.opponent = self._league_average_team()
        self.cat_keys = [c.key for c in cfg.categories]

    # ------------------------------------------------------------------ building blocks
    def _league_average_team(self) -> simulate.TeamWeek:
        teams, rounds = self.cfg.league.teams, self.cfg.draft.rounds
        rows = []
        for r in range(rounds):
            ids = self.by_adp[r * teams:(r + 1) * teams]
            rows.append(self.contrib.loc[ids].mean())
        return simulate.team_week(pd.DataFrame(rows))

    def _typical_at(self, order: np.ndarray, offset: int) -> pd.Series:
        """Average contribution of the players expected to go about `offset` picks from now."""
        half = max(1, self.cfg.league.teams // 2)
        lo, hi = max(0, offset - half), max(1, offset + half)
        ids = order[lo:hi] if lo < len(order) else order[-half:]
        return self.contrib.loc[ids].mean()

    def _need_shift(self, state: DraftState, current: int, until: int | None) -> pd.Series:
        """Picks earlier than ADP each player is expected to go, from intervening teams' needs."""
        shift = pd.Series(0.0, index=self.pool.index)
        if until is None or until <= current + 1:
            return shift
        between = {slot_of(p, state.teams) for p in range(current, until)} - {state.my_slot}
        if not between:
            return shift
        need = {pos: 0 for pos in _PRIMARY}
        for team in between:
            elig = [self.pool.at[pid, "eligible"] for pid in state.roster(team)["player_id"]
                    if pid in self.pool.index]
            open_slots = assign_slots(elig, self.starting_slots)
            for pos in _PRIMARY:
                need[pos] += pos in open_slots
        share = {pos: n / len(between) for pos, n in need.items()}
        k = self.cfg.draft.board.need_shift_picks
        return self.pool["eligible"].map(lambda e: k * max((share.get(p, 0.0) for p in e), default=0.0))

    # ------------------------------------------------------------------ main entry
    def recommend(self, state: DraftState, punts: set[str] | None = None) -> BoardResult:
        t0 = time.perf_counter()
        cfg, b = self.cfg, self.cfg.draft.board
        punts = set(punts or ())
        current = state.current_pick
        if current is None or state.my_slot is None:
            raise ValueError("set my draft slot and keep the draft open to get recommendations")
        mine = picks_for_slot(state.my_slot, state.teams, state.rounds)
        if state.on_the_clock == state.my_slot:
            decision = current
        else:
            decision = next_pick(state.my_slot, current - 1, state.teams, state.rounds)
        following = next_pick(state.my_slot, decision, state.teams, state.rounds) if decision else None

        drafted = state.drafted
        avail = self.pool[~self.pool.index.isin(drafted)].copy()
        shift = self._need_shift(state, current, following)
        avail["expected_adj"] = avail["expected_pick"] - shift.loc[avail.index]
        order = avail.sort_values("expected_adj").index.to_numpy()

        my_ids = [pid for pid in state.roster(state.my_slot)["player_id"] if pid in self.contrib.index]
        roster_c = self.contrib.loc[my_ids]
        future = [p for p in mine if decision and p > decision]
        fill = pd.DataFrame([self._typical_at(order, p - current) for p in future])
        base_rows = pd.concat([roster_c, fill], ignore_index=True)
        base = simulate.team_week(base_rows) if not base_rows.empty else _empty_team(self.contrib)
        t_setup = time.perf_counter()

        par = self._typical_at(order, (decision or current) - current).to_frame().T
        par_m = simulate.analytic(simulate.add(base, par), self.opponent, cfg)
        cand = self.contrib.loc[avail.index]
        m = simulate.analytic(simulate.add(base, cand), self.opponent, cfg)
        live = [k for k in self.cat_keys if k not in punts]
        ec_live = sum(m.p_cat[k] for k in live)
        ec_par = float(sum(np.asarray(par_m.p_cat[k]).ravel()[0] for k in live))
        avail["expected_cats"] = ec_live
        avail["gain"] = ec_live - ec_par
        avail["p_win_week"] = m.p_win_week
        for k in self.cat_keys:
            avail[f"dp_{k}"] = m.p_cat[k] - np.asarray(par_m.p_cat[k]).ravel()[0]
        if following:
            avail["p_available_next"] = prob_available(avail["expected_adj"], avail["adp_sd"],
                                                       following, current)
        else:
            avail["p_available_next"] = 0.0
        if decision and decision != current:
            avail["p_available_at_decision"] = prob_available(avail["expected_adj"], avail["adp_sd"],
                                                              decision, current)
        else:
            avail["p_available_at_decision"] = 1.0
        t_score = time.perf_counter()

        # Ranked by gain. Off the clock, `p_available_at_decision` says who is likely to be
        # there when it is my turn; it is shown, not multiplied in (gain can be negative).
        ranked = avail.sort_values(["gain", "value"], ascending=False)
        best_next = _expected_best(ranked["expected_cats"].to_numpy(),
                                   ranked["p_available_next"].to_numpy())
        top = ranked.head(b.recommendations).copy()
        top["best_at_next_pick"] = best_next

        mc_ids = top.index[: b.monte_carlo_top]
        mc = simulate.monte_carlo(simulate.add(base, self.contrib.loc[mc_ids]), self.opponent, cfg,
                                  n=b.monte_carlo_draws, seed=current)
        top["p_win_week_mc"] = np.nan
        top.loc[mc_ids, "p_win_week_mc"] = mc.p_win_week
        t_mc = time.perf_counter()

        my_now = simulate.analytic(base if not base_rows.empty else _empty_team(self.contrib),
                                   self.opponent, cfg)
        my_p = {k: float(np.asarray(v).ravel()[0]) for k, v in my_now.p_cat.items()}
        open_slots = assign_slots([self.pool.at[p, "eligible"] for p in my_ids], self.starting_slots)
        drift = []
        if len(my_ids) >= b.punt_drift_after_round:
            drift = [k for k in live if my_p[k] < b.punt_drift_p]
        top["reasons"] = [self._reasons(r, following, open_slots) for _, r in top.iterrows()]
        top.insert(0, "rec", np.arange(1, len(top) + 1))
        t_end = time.perf_counter()
        return BoardResult(
            table=top.reset_index(drop=True), decision_pick=decision, following_pick=following,
            my_p_cat=my_p, my_expected_cats=float(np.asarray(my_now.expected_cats).ravel()[0]),
            my_p_win_week=float(np.asarray(my_now.p_win_week).ravel()[0]), open_slots=open_slots,
            drift=drift, timings_ms={
                "setup": 1000 * (t_setup - t0), "score": 1000 * (t_score - t_setup),
                "monte_carlo": 1000 * (t_mc - t_score), "total": 1000 * (t_end - t0)})

    def _reasons(self, r: pd.Series, following: int | None, open_slots: list[str]) -> str:
        labels = {c.key: c.label for c in self.cfg.categories}
        out = [f"{r['gain']:+.2f} expected categories vs a typical pick here"]
        helps = sorted(((r[f"dp_{k}"], k) for k in self.cat_keys), reverse=True)[:2]
        helps = [f"{labels[k]} {d:+.0%}" for d, k in helps if d > 0.005]
        if helps:
            out.append("helps " + ", ".join(helps))
        if following:
            p = r["p_available_next"]
            if p < 0.25:
                pct = "under 1%" if p < 0.01 else f"only {p:.0%}"
                out.append(f"{pct} likely to last to pick {following}")
            elif p > 0.75:
                out.append(f"{p:.0%} likely still there at pick {following}: you could wait")
        fills = [s for s in r["eligible"] if s in open_slots and s not in ("Util",)]
        if fills:
            out.append(f"fills an open {fills[0]} slot")
        if r.get("sources") == "bbm_only":
            out.append("no 2025-26 sample: projection is BBM-only, lower confidence")
        if r.get("adp_source") == "bbm_rank":
            out.append("no ADP: availability estimate is rough")
        if str(r.get("injury_risk")) in ("H", "E"):
            out.append(f"BBM injury risk {r['injury_risk']}")
        return "; ".join(out)


def _expected_best(values: np.ndarray, p_avail: np.ndarray) -> float:
    """E[best value still available], players independent; values sorted best-first internally."""
    idx = np.argsort(-values)
    v, a = values[idx], p_avail[idx]
    none_better = np.r_[1.0, np.cumprod(1 - a)[:-1]]
    return float((v * a * none_better).sum())


def _empty_team(contrib: pd.DataFrame) -> simulate.TeamWeek:
    return simulate.team_week(contrib.iloc[:0])

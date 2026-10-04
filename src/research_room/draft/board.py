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

Lineups: players' weekly games = projected games / 82 x team games per week, then scaled by
whether the player has a starting slot. Rosters (and each candidate) are assigned greedily to
the starting slots by eligibility; a starter counts in full, a bench player only on days a
compatible starter is idle, estimated as 1 - team games per week / 7. So a fifth center behind
full C/C/Util/Util slots is discounted, and the opponent's last rounds are bench players too.
Generic "typical" future picks are position-flexible and take any open slots first.
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
    scores: pd.DataFrame | None = None        # every available player, ranked (for compare)


def split_starters(eligible: list[list[str]], slots: list[str]) -> tuple[list[bool], list[str]]:
    """Greedy fill of starting `slots` by eligibility, least-flexible players and most specific
    slots first. Returns (is_starter per player, slots still open)."""
    open_slots = list(slots)
    specificity = {s: sum(s in e for e in eligible) for s in set(slots)}
    starter = [False] * len(eligible)
    for i in sorted(range(len(eligible)), key=lambda i: len(eligible[i])):
        choices = [s for s in open_slots if s in eligible[i]]
        if choices:
            open_slots.remove(min(choices, key=lambda s: specificity.get(s, 0)))
            starter[i] = True
    return starter, open_slots


def assign_slots(eligible: list[list[str]], slots: list[str]) -> list[str]:
    """Starting slots left open after a greedy fill (see `split_starters`)."""
    return split_starters(eligible, slots)[1]


class DraftBoard:
    """Holds the pool in memory for the whole draft; `recommend()` runs after every pick."""

    def __init__(self, valued: pd.DataFrame, cfg: Settings | None = None,
                 team_games_per_week: float = 3.0) -> None:
        self.cfg = cfg = cfg or settings()
        starters = [s for s in cfg.roster.slots if s not in ("BN", "IL")]
        self.starting_slots = starters
        # A bench player plays only when a compatible starter is idle that day.
        self.bench_utilization = max(0.0, 1.0 - team_games_per_week / 7.0)
        pool = valued.copy().set_index("player_id", drop=False)
        pool["week_games"] = pool["games"] / NBA_REGULAR_SEASON_GAMES * team_games_per_week
        self.pool = pool
        self.contrib = simulate.contributions(pool, cfg)
        self.by_adp = pool.sort_values("expected_pick").index.to_numpy()
        self.opponent = self._league_average_team()
        self.cat_keys = [c.key for c in cfg.categories]

    # ------------------------------------------------------------------ building blocks
    def _league_average_team(self) -> simulate.TeamWeek:
        """For each round, the average player expected to go in it; rounds past the number of
        starting slots are bench players."""
        teams, rounds = self.cfg.league.teams, self.cfg.draft.rounds
        n_start = len(self.starting_slots)
        rows = []
        for r in range(rounds):
            ids = self.by_adp[r * teams:(r + 1) * teams]
            factor = 1.0 if r < n_start else self.bench_utilization
            rows.append(self.contrib.loc[ids].mean() * factor)
        return simulate.team_week(pd.DataFrame(rows))

    def _fill_rows(self, typical: list[pd.Series], open_count: int) -> pd.DataFrame:
        """Generic future picks: the first `open_count` start, the rest are bench."""
        rows = [row * (1.0 if i < open_count else self.bench_utilization) for i, row in enumerate(typical)]
        return pd.DataFrame(rows)

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
        shift_next = self._need_shift(state, current, following)
        shift_decision = self._need_shift(state, current, decision)
        avail["expected_adj"] = avail["expected_pick"] - shift_next.loc[avail.index]
        order = avail.sort_values("expected_adj").index.to_numpy()

        my_ids = [pid for pid in state.roster(state.my_slot)["player_id"] if pid in self.contrib.index]
        is_start, open_now = split_starters([self.pool.at[p, "eligible"] for p in my_ids],
                                            self.starting_slots)
        u = self.bench_utilization
        roster_c = self.contrib.loc[my_ids].mul([1.0 if s else u for s in is_start], axis=0)
        future = [p for p in mine if decision and p > decision]
        typical = [self._typical_at(order, p - current) for p in future]
        n_open = len(open_now)

        def base_with(open_count: int) -> simulate.TeamWeek:
            rows = pd.concat([roster_c, self._fill_rows(typical, open_count)], ignore_index=True)
            return simulate.team_week(rows) if not rows.empty else _empty_team(self.contrib)

        # A candidate who fits an open slot starts (and leaves one fewer slot for later picks);
        # one who doesn't is a bench player and later picks still have every open slot.
        base_fit, base_bench = base_with(max(0, n_open - 1)), base_with(n_open)
        t_setup = time.perf_counter()

        par_fits = n_open > 0                                  # a typical pick is position-flexible
        par = self._typical_at(order, (decision or current) - current).to_frame().T
        par_team = simulate.add(base_fit if par_fits else base_bench, par * (1.0 if par_fits else u))
        par_m = simulate.analytic(par_team, self.opponent, cfg)
        fits = avail["eligible"].map(lambda e: any(s in open_now for s in e)).to_numpy()
        cand = self.contrib.loc[avail.index]
        m_fit = simulate.analytic(simulate.add(base_fit, cand), self.opponent, cfg)
        m_bench = simulate.analytic(simulate.add(base_bench, cand * u), self.opponent, cfg)
        m = _choose(m_fit, m_bench, fits)
        avail["starts"] = fits
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
            at_decision = avail["expected_pick"] - shift_decision.loc[avail.index]
            avail["p_available_at_decision"] = prob_available(at_decision, avail["adp_sd"],
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
        mc_fit = top.loc[mc_ids, "starts"].to_numpy()
        mc_c = self.contrib.loc[mc_ids]
        top["p_win_week_mc"] = np.nan
        for flag, base_used, factor in ((True, base_fit, 1.0), (False, base_bench, u)):
            ids = mc_ids[mc_fit == flag]
            if len(ids):
                mc = simulate.monte_carlo(simulate.add(base_used, mc_c.loc[ids] * factor), self.opponent,
                                          cfg, n=b.monte_carlo_draws, seed=current)
                top.loc[ids, "p_win_week_mc"] = mc.p_win_week
        t_mc = time.perf_counter()

        # My projected team as of now: picks so far + a typical player at this pick + later picks.
        my_now = par_m if decision else simulate.analytic(base_bench, self.opponent, cfg)
        my_p = {k: float(np.asarray(v).ravel()[0]) for k, v in my_now.p_cat.items()}
        open_slots = open_now
        drift = []
        if len(my_ids) >= b.punt_drift_after_round:
            drift = [k for k in live if my_p[k] < b.punt_drift_p]
        top["reasons"] = [self._reasons(r, following, open_slots) for _, r in top.iterrows()]
        top.insert(0, "rec", np.arange(1, len(top) + 1))
        t_end = time.perf_counter()
        return BoardResult(
            scores=ranked.reset_index(drop=True),
            table=top.reset_index(drop=True), decision_pick=decision, following_pick=following,
            my_p_cat=my_p, my_expected_cats=float(np.asarray(my_now.expected_cats).ravel()[0]),
            my_p_win_week=float(np.asarray(my_now.p_win_week).ravel()[0]), open_slots=open_slots,
            drift=drift, timings_ms={
                "setup": 1000 * (t_setup - t0), "score": 1000 * (t_score - t_setup),
                "monte_carlo": 1000 * (t_mc - t_score), "total": 1000 * (t_end - t0)})

    # ------------------------------------------------------------------ team outlooks
    def team_projection(self, state: DraftState, team_id: int) -> tuple[simulate.TeamWeek, list[str]]:
        """A team's projected final roster: its picks so far (starters full, bench discounted) plus
        a typical player at each of its remaining picks. Returns (team, open starting slots)."""
        ids = [pid for pid in state.roster(team_id)["player_id"] if pid in self.contrib.index]
        is_start, open_slots = split_starters([self.pool.at[p, "eligible"] for p in ids],
                                              self.starting_slots)
        u = self.bench_utilization
        rows = self.contrib.loc[ids].mul([1.0 if s else u for s in is_start], axis=0)
        current = state.current_pick
        if current is not None:
            avail = self.pool[~self.pool.index.isin(state.drafted)]
            order = avail.sort_values("expected_pick").index.to_numpy()
            remaining = [p for p in picks_for_slot(team_id, state.teams, state.rounds) if p >= current]
            typical = [self._typical_at(order, p - current) for p in remaining]
            rows = pd.concat([rows, self._fill_rows(typical, len(open_slots))], ignore_index=True)
        team = simulate.team_week(rows) if not rows.empty else _empty_team(self.contrib)
        return team, open_slots

    def pick_insight(self, state: DraftState, pick_no: int, top_n: int = 2) -> dict:
        """What one pick means: the drafting team's needs, strengths and weaknesses (vs a
        league-average team), the projected head-to-head against my team, and what it is likely
        to target next. Every number comes from the simulator; `notes` are built from them."""
        row = state.picks[state.picks["pick_no"] == pick_no]
        if row.empty:
            raise ValueError(f"pick {pick_no} is not recorded")
        r = row.iloc[0]
        team_id = int(r["team_id"])
        labels = {c.key: c.label for c in self.cfg.categories}
        team, open_slots = self.team_projection(state, team_id)
        vs_avg = simulate.analytic(team, self.opponent, self.cfg)
        p_avg = {k: float(np.asarray(v).ravel()[0]) for k, v in vs_avg.p_cat.items()}
        ranked = sorted(p_avg.items(), key=lambda kv: kv[1])
        weak = [k for k, v in ranked[:top_n]]
        strong = [k for k, v in ranked[::-1][:top_n]]
        pid = int(r["player_id"])
        player = self.pool.loc[pid] if pid in self.pool.index else None
        out = {
            "pick_no": int(pick_no), "round": int(r["round"]), "team_id": team_id,
            "player": {"player_id": pid, "name": r["player_name"],
                       "position": None if player is None else player["position"],
                       "team_abbr": None if player is None else player["team_abbr"]},
            "open_slots": open_slots,
            "p_vs_league_avg": p_avg,
            "strengths": strong, "weaknesses": weak,
            "expected_cats_vs_avg": float(np.asarray(vs_avg.expected_cats).ravel()[0]),
            "vs_me": None, "notes": [],
        }
        primary_open = [s for s in open_slots if s in _PRIMARY]
        notes = [f"Needs {', '.join(primary_open)}" if primary_open
                 else "Starting slots filled at every position"]
        notes.append("Strong in " + ", ".join(f"{labels[k]} ({p_avg[k]:.0%})" for k in strong)
                     + "; weak in " + ", ".join(f"{labels[k]} ({p_avg[k]:.0%})" for k in weak))
        if state.my_slot and team_id != state.my_slot:
            mine, _ = self.team_projection(state, state.my_slot)
            h2h = simulate.analytic(mine, team, self.cfg)
            p_me = {k: float(np.asarray(v).ravel()[0]) for k, v in h2h.p_cat.items()}
            p_week = float(np.asarray(h2h.p_win_week).ravel()[0])
            by_p = sorted(p_me.items(), key=lambda kv: kv[1])
            edge = self.cfg.draft.board.edge_p
            out["vs_me"] = {"p_cat": p_me, "p_win_week": p_week,
                            "my_edges": [k for k, v in reversed(by_p) if v >= edge],
                            "their_edges": [k for k, v in by_p if v <= 1 - edge]}
            notes.append(f"You'd beat them {p_week:.0%} of weeks as the rosters project now")
            if out["vs_me"]["their_edges"]:
                edges = out["vs_me"]["their_edges"][:3]
                notes.append("They out-project you in " + ", ".join(labels[k] for k in edges))
        out["notes"] = notes
        return out

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
        elif not r.get("starts", True):
            out.append("no open starting slot for him: counts as a bench player")
        if r.get("sources") == "bbm_only":
            out.append("no 2025-26 sample: projection is BBM-only, lower confidence")
        if r.get("adp_source") == "bbm_rank":
            out.append("no ADP: availability estimate is rough")
        if str(r.get("injury_risk")) in ("H", "E"):
            out.append(f"BBM injury risk {r['injury_risk']}")
        return "; ".join(out)


def _choose(a: simulate.Matchup, b: simulate.Matchup, take_a: np.ndarray) -> simulate.Matchup:
    """Element-wise: `a` where take_a, else `b` (same batch order)."""
    pick = lambda x, y: np.where(take_a, x, y)  # noqa: E731
    return simulate.Matchup({k: pick(a.p_cat[k], b.p_cat[k]) for k in a.p_cat},
                            pick(a.expected_cats, b.expected_cats), pick(a.p_win_week, b.p_win_week),
                            a.cats_to_win)


def _expected_best(values: np.ndarray, p_avail: np.ndarray) -> float:
    """E[best value still available], players independent; values sorted best-first internally."""
    idx = np.argsort(-values)
    v, a = values[idx], p_avail[idx]
    none_better = np.r_[1.0, np.cumprod(1 - a)[:-1]]
    return float((v * a * none_better).sum())


def _empty_team(contrib: pd.DataFrame) -> simulate.TeamWeek:
    return simulate.team_week(contrib.iloc[:0])

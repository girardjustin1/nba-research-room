"""Timed end-to-end mock snake draft: the Phase D exit check.

Inputs: the draft pool (`blend_preseason` from the store, opened read-only, or synthetic players
with --synthetic), games per team per week from the schedule, settings (league.teams overridden
by --teams, draft.rounds by --rounds).
Outputs: a printed report (timings with PASS/FAIL against the build prompt's limits, my roster,
the final head-to-head evaluation); `run_mock()` returns the same as a dict.
Tables: reads external_projections, game_logs, games (read-only). The mock's picks go to a
separate in-memory DuckDB, never to the real store.

Usage: `python jobs/mock_draft.py --teams 12 --slot 5 --seed 1 [--rounds N] [--synthetic]`.

How the draft runs:
- My team (slot --slot) takes `DraftBoard.recommend(state)`'s #1 at each of its picks.
- Every other team is a bot. At each bot pick, every available player's draft position is
  sampled once from Normal(expected_pick, adp_sd) (`availability.expected_pick`), and the bot
  takes the lowest sample. Positional rule: a bot skips a player whose primary position it
  already holds `BOT_POSITION_CAP` times (if that leaves nobody, the cap is ignored). One
  `numpy` generator seeded with --seed drives every sample, so a run is reproducible.
- After every pick the board is refreshed (`record_pick` + `recommend`), as the live page does,
  and each call is timed. Limits (docs/BUILD_PROMPT.md, "Draft helper"): board refresh under
  1 s per pick, recommendations under 3 s.

Final evaluation: every team's final roster becomes a `simulate.TeamWeek` (via
`simulate.contributions`, with `week_games` = projected games / 82 x team games per week x
min(1, active slots / rounds), the board's formula). Each team plays every other team in the
analytic model: P(win week) and expected categories won. Teams are ranked by their average
P(win week) across all opponents.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

from research_room import schedule, simulate, store
from research_room.config import Settings, settings
from research_room.draft import tracker
from research_room.draft.availability import expected_pick, round_of, slot_of
from research_room.draft.board import DraftBoard
from research_room.draft.value import NBA_REGULAR_SEASON_GAMES, compute_values

REPO_ROOT = Path(__file__).resolve().parents[1]

DEFAULT_TEAMS = 12              # Phase D exit criterion: "a mock 12-team draft"
BOT_POSITION_CAP = 4            # bots hold at most this many players of one primary position
REFRESH_LIMIT_S = 1.0           # build prompt: board refresh under 1 second per pick
RECOMMEND_LIMIT_S = 3.0         # build prompt: recommendations under 3 seconds
SYNTHETIC_PLAYERS = 520         # about the size of the real pool (516)
SYNTHETIC_GAMES_PER_WEEK = 3.1  # the value tests/test_board.py uses; the real schedule gives ~3.12
STORE_OPEN_ATTEMPTS = 10
STORE_RETRY_SECONDS = 0.5


# ------------------------------------------------------------------ inputs
def mock_settings(teams: int, rounds: int | None = None, base: Settings | None = None) -> Settings:
    """A copy of settings with the team count (and optionally rounds) overridden."""
    s = base or settings()
    draft = s.draft if rounds is None else s.draft.model_copy(update={"rounds": rounds})
    return s.model_copy(update={"league": s.league.model_copy(update={"teams": teams}), "draft": draft})


def _open_store_read_only() -> duckdb.DuckDBPyConnection:
    """Open the real store read-only, retrying briefly while a writer holds the lock."""
    last: Exception | None = None
    for _ in range(STORE_OPEN_ATTEMPTS):
        try:
            return store.connect(read_only=True)
        except duckdb.IOException as exc:
            last = exc
            time.sleep(STORE_RETRY_SECONDS)
    raise RuntimeError(
        f"could not open {settings().paths.db} read-only after {STORE_OPEN_ATTEMPTS} tries "
        f"({last}); another process (the draft API or a job) holds a write lock. Stop it, or run "
        "with --synthetic.")


def load_store_pool(cfg: Settings) -> tuple[pd.DataFrame, float]:
    """Blended preseason pool and average team games per week, from the real store."""
    from research_room.ingest.external_proj import blend_preseason

    con = _open_store_read_only()
    try:
        pool = blend_preseason(con, cfg)
        gpw = schedule.games_per_week(schedule.load_games(con, cfg.season.nba_season), cfg.season)
    finally:
        con.close()
    return pool, gpw


def synthetic_pool(seed: int, n: int = SYNTHETIC_PLAYERS) -> tuple[pd.DataFrame, float]:
    """Synthetic players from the board tests (no store needed)."""
    if str(REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(REPO_ROOT))
    from tests.test_board import make_pool

    return make_pool(n, seed=seed), SYNTHETIC_GAMES_PER_WEEK


# ------------------------------------------------------------------ bots
def bot_choice(avail: pd.DataFrame, held_positions: list[str], rng: np.random.Generator,
               cap: int = BOT_POSITION_CAP) -> int:
    """Noisy-ADP pick: lowest sampled draft position, skipping positions already at `cap`."""
    sampled = rng.normal(avail["expected_pick"].to_numpy(float), avail["adp_sd"].to_numpy(float))
    counts = pd.Series(held_positions, dtype=object).value_counts()
    full = set(counts[counts >= cap].index)
    allowed = ~avail["position"].isin(full).to_numpy()
    if not allowed.any():
        allowed[:] = True
    sampled = np.where(allowed, sampled, np.inf)
    return int(avail.index[int(np.argmin(sampled))])


# ------------------------------------------------------------------ evaluation
def team_weeks(valued: pd.DataFrame, rosters: dict[int, list[int]], cfg: Settings,
               team_games_per_week: float) -> dict[int, simulate.TeamWeek]:
    """One TeamWeek per team from its final roster, with the board's week_games formula."""
    pool = valued.set_index("player_id", drop=False)
    utilization = min(1.0, cfg.roster.active_per_day / cfg.draft.rounds)
    pool = pool.assign(week_games=pool["games"] / NBA_REGULAR_SEASON_GAMES * team_games_per_week
                       * utilization)
    contrib = simulate.contributions(pool, cfg)
    return {team: simulate.team_week(contrib.loc[ids]) for team, ids in rosters.items()}


def evaluate(weeks: dict[int, simulate.TeamWeek], my_slot: int, cfg: Settings) -> dict:
    """Round robin: each team against every other team, analytic model."""
    teams = sorted(weeks)
    p = pd.DataFrame(np.nan, index=teams, columns=teams)
    ec = p.copy()
    my_cats: list[dict[str, float]] = []
    for a in teams:
        for b in teams:
            if a == b:
                continue
            s = simulate.analytic(weeks[a], weeks[b], cfg).summary()
            p.at[a, b], ec.at[a, b] = s["p_win_week"], s["expected_cats"]
            if a == my_slot:
                my_cats.append(s["p_cat"])
    avg = pd.DataFrame({"avg_p_win_week": p.mean(axis=1), "avg_expected_cats": ec.mean(axis=1)})
    avg["rank"] = avg["avg_p_win_week"].rank(ascending=False, method="min").astype(int)
    vs = [{"opponent": int(b), "p_win_week": float(p.at[my_slot, b]),
           "expected_cats": float(ec.at[my_slot, b])} for b in teams if b != my_slot]
    return {
        "vs": vs,
        "avg_p_win_week": float(avg.at[my_slot, "avg_p_win_week"]),
        "avg_expected_cats": float(avg.at[my_slot, "avg_expected_cats"]),
        "rank": int(avg.at[my_slot, "rank"]),
        "teams": len(teams),
        "my_avg_p_cat": pd.DataFrame(my_cats).mean().to_dict(),
        "table": avg.sort_values("rank").reset_index(names="team").to_dict("records"),
        "p_matrix": p,
    }


def _stats(seconds: list[float]) -> dict:
    a = np.asarray(seconds, dtype=float)
    if a.size == 0:
        return {"n": 0, "mean_s": None, "p95_s": None, "max_s": None}
    return {"n": int(a.size), "mean_s": float(a.mean()), "p95_s": float(np.percentile(a, 95)),
            "max_s": float(a.max())}


# ------------------------------------------------------------------ the draft
def run_mock(teams: int = DEFAULT_TEAMS, slot: int = 5, seed: int = 1, rounds: int | None = None,
             synthetic: bool = False, synthetic_players: int = SYNTHETIC_PLAYERS,
             bot_position_cap: int = BOT_POSITION_CAP) -> dict:
    """Run a full mock snake draft and evaluate the result. See the module docstring."""
    t_start = time.perf_counter()
    cfg = mock_settings(teams, rounds)
    if not 1 <= slot <= teams:
        raise ValueError(f"--slot must be in 1..{teams}")
    pool, gpw = synthetic_pool(seed, synthetic_players) if synthetic else load_store_pool(cfg)
    t_pool = time.perf_counter()
    valued = expected_pick(compute_values(pool, cfg), cfg)
    board = DraftBoard(valued, cfg, gpw)
    t_board = time.perf_counter()

    info = valued.set_index("player_id")
    rng = np.random.default_rng(seed)
    con = store.connect(":memory:")                     # the mock's pick log; never the real store
    state = tracker.new_state(f"mock-{teams}t-s{slot}-seed{seed}", cfg, my_slot=slot)

    refresh_s, recommend_only_s, record_s, my_rec_s = [], [], [], []
    picks, mine, drift_by_pick = [], [], []
    res = board.recommend(state)                        # the page's first render, before pick 1
    t0 = time.perf_counter()
    try:
        while (pick_no := state.current_pick) is not None:
            team = slot_of(pick_no, teams)
            if team == slot:
                t = time.perf_counter()
                res = board.recommend(state)
                my_rec_s.append(time.perf_counter() - t)
                top = res.table
                pid = int(top.iloc[0]["player_id"])
                mine.append({
                    "pick_no": pick_no, "round": round_of(pick_no, teams), "player_id": pid,
                    "name": info.at[pid, "name"], "position": info.at[pid, "position"],
                    "expected_pick": float(info.at[pid, "expected_pick"]),
                    "value_rank": int(info.at[pid, "rank"]), "gain": float(top.iloc[0]["gain"]),
                    "p_win_week": float(top.iloc[0]["p_win_week"]),
                    "top3": [(r["name"], r["position"], round(float(r["gain"]), 3))
                             for _, r in top.head(3).iterrows()],
                    "drift_before": list(res.drift), "open_slots": list(res.open_slots),
                    "board_top1": pid,
                })
                by = "board"
            else:
                avail = info.loc[~info.index.isin(state.drafted)]
                held = [info.at[p, "position"] for p in state.roster(team)["player_id"]]
                pid = bot_choice(avail, held, rng, bot_position_cap)
                by = "bot"
            t = time.perf_counter()
            state = tracker.record_pick(con, state, pid, str(info.at[pid, "name"]),
                                        entry_source="mock")
            t_rec = time.perf_counter()
            record_s.append(t_rec - t)
            picks.append({"pick_no": pick_no, "round": round_of(pick_no, teams), "team": team,
                          "player_id": pid, "name": info.at[pid, "name"],
                          "position": info.at[pid, "position"],
                          "expected_pick": float(info.at[pid, "expected_pick"]), "by": by})
            if state.current_pick is None:
                break
            t = time.perf_counter()
            res = board.recommend(state)                # live refresh after every pick
            t_done = time.perf_counter()
            recommend_only_s.append(t_done - t)
            refresh_s.append(t_done - t_rec + record_s[-1])
            drift_by_pick.append((pick_no, list(res.drift)))
    finally:
        final_picks = state.picks.copy()
        con.close()
    t_draft = time.perf_counter()

    rosters = {tm: [int(p) for p in final_picks.loc[final_picks["team_id"] == tm, "player_id"]]
               for tm in range(1, teams + 1)}
    weeks = team_weeks(valued, rosters, cfg, gpw)
    evaluation = evaluate(weeks, slot, cfg)
    t_end = time.perf_counter()

    timing = {
        "pool_load_s": t_pool - t_start, "board_build_s": t_board - t_pool,
        "draft_s": t_draft - t0, "evaluation_s": t_end - t_draft, "wall_s": t_end - t_start,
        "refresh": _stats(refresh_s), "recommend_only": _stats(recommend_only_s),
        "record_pick": _stats(record_s), "my_recommend": _stats(my_rec_s),
    }
    worst_refresh, worst_rec = timing["refresh"]["max_s"], timing["my_recommend"]["max_s"]
    refresh_ok = worst_refresh is not None and worst_refresh < REFRESH_LIMIT_S
    rec_ok = worst_rec is not None and worst_rec < RECOMMEND_LIMIT_S
    drift_rounds = {}
    for pick_no, flags in drift_by_pick:
        for k in flags:
            drift_rounds.setdefault(k, []).append(pick_no)
    return {
        "settings": {"teams": teams, "rounds": cfg.draft.rounds, "slot": slot, "seed": seed,
                     "synthetic": synthetic, "pool_players": len(valued),
                     "team_games_per_week": gpw, "bot_position_cap": bot_position_cap},
        "picks": picks, "my_picks": mine, "rosters": rosters, "timing": timing,
        "criteria": {"refresh_limit_s": REFRESH_LIMIT_S, "recommend_limit_s": RECOMMEND_LIMIT_S,
                     "refresh_ok": refresh_ok, "recommend_ok": rec_ok,
                     "passed": refresh_ok and rec_ok},
        "drift": {"first_flagged_pick": {k: v[0] for k, v in drift_rounds.items()},
                  "flag_counts": {k: len(v) for k, v in drift_rounds.items()},
                  "final": drift_by_pick[-1][1] if drift_by_pick else []},
        "evaluation": evaluation,
    }


# ------------------------------------------------------------------ report
def format_report(r: dict) -> str:
    s, t, c, e = r["settings"], r["timing"], r["criteria"], r["evaluation"]
    ms = lambda x: f"{1000 * x:7.1f} ms" if x is not None else "    n/a"  # noqa: E731

    def row(label, st):
        return (f"  {label:<26} n={st['n']:<4} mean {ms(st['mean_s'])}  p95 {ms(st['p95_s'])}"
                f"  max {ms(st['max_s'])}")

    src = "synthetic" if s["synthetic"] else "store"
    out = [f"Mock draft: {s['teams']} teams x {s['rounds']} rounds, my slot {s['slot']}, seed {s['seed']}, "
           f"pool {s['pool_players']} players ({src}), {s['team_games_per_week']:.3f} team games/week",
           "", "Timing",
           row("board refresh (pick+rec)", t["refresh"]),
           row("  recommend() only", t["recommend_only"]),
           row("  record_pick() only", t["record_pick"]),
           row("recommend() on my clock", t["my_recommend"]),
           f"  pool load {t['pool_load_s']:.2f} s, board build {t['board_build_s']:.2f} s, "
           f"draft {t['draft_s']:.2f} s, evaluation {t['evaluation_s']:.2f} s, wall {t['wall_s']:.2f} s",
           f"  {'PASS' if c['passed'] else 'FAIL'}: board refresh max {ms(t['refresh']['max_s']).strip()} "
           f"(limit {c['refresh_limit_s']:.0f} s) {'ok' if c['refresh_ok'] else 'OVER'}; "
           f"recommendation max {ms(t['my_recommend']['max_s']).strip()} "
           f"(limit {c['recommend_limit_s']:.0f} s) {'ok' if c['recommend_ok'] else 'OVER'}",
           "", "My picks (board #1 each time)",
           "  pick rnd  pos  ADP    rank  gain    player                   next two on the board"]
    for m in r["my_picks"]:
        alts = ", ".join(f"{n} ({p})" for n, p, _ in m["top3"][1:])
        out.append(f"  {m['pick_no']:>4} {m['round']:>3}  {m['position']:<3} {m['expected_pick']:6.1f} "
                   f"{m['value_rank']:>5} {m['gain']:+.3f}  {m['name']:<24} {alts}")
    pos = pd.Series([m["position"] for m in r["my_picks"]]).value_counts().to_dict()
    out.append(f"  positions: {pos}")
    d = r["drift"]
    out.append(f"  punt drift: first flagged at pick {d['first_flagged_pick'] or '-'}; "
               f"flags after the final refresh: {d['final'] or 'none'}")
    out += ["", "Final evaluation (analytic, each team vs every other)",
            "  my P(win week) by opponent: " + ", ".join(
                f"T{v['opponent']} {v['p_win_week']:.2f}" for v in e["vs"]),
            f"  my average: P(win week) {e['avg_p_win_week']:.3f}, expected categories "
            f"{e['avg_expected_cats']:.2f} of 9; rank {e['rank']} of {e['teams']}",
            "  my average P(win category): " + ", ".join(
                f"{k} {v:.2f}" for k, v in e["my_avg_p_cat"].items()),
            "  standings by average P(win week): " + ", ".join(
                f"{'*' if row['team'] == s['slot'] else ''}T{row['team']} {row['avg_p_win_week']:.2f}"
                for row in e["table"])]
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--teams", type=int, default=DEFAULT_TEAMS)
    parser.add_argument("--slot", type=int, default=5, help="my draft slot (1..teams)")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--rounds", type=int, default=None, help="default: settings.draft.rounds")
    parser.add_argument("--synthetic", action="store_true", help="synthetic players; no store needed")
    parser.add_argument("--bot-position-cap", type=int, default=BOT_POSITION_CAP)
    args = parser.parse_args(argv)
    try:
        result = run_mock(args.teams, args.slot, args.seed, args.rounds, args.synthetic,
                          bot_position_cap=args.bot_position_cap)
    except (RuntimeError, ValueError) as exc:
        print(f"mock draft failed: {exc}", file=sys.stderr)
        return 1
    print(format_report(result))
    return 0 if result["criteria"]["passed"] else 2


if __name__ == "__main__":
    sys.exit(main())

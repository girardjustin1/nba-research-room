"""The deciding test for the ensemble: the weekly replay driven by each model (read only).

Usage: make ensemble-replay   (about 30-40 minutes; prints the verdict, saves data/replay/<date>/)

Replays the latest backfilled season week by week twice (research_room.backtest): the baseline
driving, then the ensemble (projections/ensemble.EnsembleFit). Same simulated league and sampled
team-weeks, so the two are paired. Scored by the rule written in DECISIONS.md before the run:
1. the weekly win-odds Brier (doing nothing) is lower, with the 95% range of the paired difference
   (resampling whole weeks) entirely below zero;
2. the realized win rate following the plans is not worse (its 95% range not entirely below zero);
3. no predicted makes above attempts (checked by `make bakeoff`, not here).
Writes nothing to the store.
"""

from __future__ import annotations

import json
import sys
import time
from datetime import date

import numpy as np
import pandas as pd

from research_room import backtest, features, store
from research_room.config import settings
from research_room.projections.ensemble import EnsembleFit

PAIR = ["week_start", "team", "opponent"]
DRAWS = 2000


def outcome(res: pd.DataFrame, kind: str) -> pd.Series:
    """1 for a won week, 0.5 for a tie, 0 for a loss."""
    return res[f"won_{kind}"].astype(float) + 0.5 * res[f"tie_{kind}"].astype(float)


def week_boot(d: pd.Series, weeks: pd.Series, seed: int = 0) -> list[float]:
    """95% range of the mean of `d`, resampling whole weeks."""
    by = pd.DataFrame({"d": d.to_numpy(), "w": weeks.to_numpy()}).groupby("w")["d"].agg(["sum", "size"])
    sums, cnt = by["sum"].to_numpy(), by["size"].to_numpy()
    rng = np.random.default_rng(seed)
    draws = [
        sums[i].sum() / cnt[i].sum() for i in (rng.integers(0, len(sums), len(sums)) for _ in range(DRAWS))
    ]
    return [float(np.percentile(draws, 2.5)), float(np.percentile(draws, 97.5))]


def main() -> int:
    cfg = settings()
    echo = lambda m: print(m, flush=True)  # noqa: E731
    con = store.connect(read_only=True)
    seasons = sorted(cfg.bdl.backfill_seasons)
    logs, team_ctx = features.load_logs(con, seasons), features.team_context(con, seasons)
    games = con.execute(
        "SELECT game_id, season, game_date, home_team_id, visitor_team_id, postseason FROM games"
    ).df()
    pl = con.execute("SELECT player_id, position, full_name FROM players").df()
    con.close()
    positions = dict(zip(pl["player_id"], pl["position"], strict=True))
    names = dict(zip(pl["player_id"], pl["full_name"], strict=True))
    quiet = lambda m: None  # noqa: E731

    runs = {}
    for arm, make in (("baseline", None), ("ensemble", lambda c: EnsembleFit(c, positions))):
        t0 = time.perf_counter()
        echo(f"{arm}: replaying ...")
        runs[arm] = backtest.run(logs, team_ctx, games, positions, names, cfg, echo=quiet, make_model=make)
        echo(f"{arm}: {len(runs[arm])} team-weeks in {time.perf_counter() - t0:.0f}s")

    b, e = (runs[k].set_index(PAIR) for k in ("baseline", "ensemble"))
    both = b.index.intersection(e.index)
    if len(both) != len(b) or len(both) != len(e):
        echo(f"warning: {len(b)} vs {len(e)} team-weeks, {len(both)} paired")
    b, e = b.loc[both], e.loc[both]
    weeks = pd.Series(both.get_level_values("week_start"))
    brier_b = (b["p_dn"] - outcome(b, "dn")) ** 2
    brier_e = (e["p_dn"] - outcome(e, "dn")) ** 2
    d_brier = (brier_e - brier_b).reset_index(drop=True)
    d_plan = (outcome(e, "plan") - outcome(b, "plan")).reset_index(drop=True)
    r_brier, r_plan = week_boot(d_brier, weeks), week_boot(d_plan, weeks, seed=1)
    primary = r_brier[1] < 0
    guard = not r_plan[1] < 0
    verdict = "ADOPT the ensemble" if primary and guard else "KEEP the baseline"
    arms = (("baseline", b), ("ensemble", e))

    summary = {
        "team_weeks": len(both),
        "weeks": int(weeks.nunique()),
        "brier": {"baseline": float(brier_b.mean()), "ensemble": float(brier_e.mean())},
        "brier_diff": float(d_brier.mean()),
        "brier_diff_95": r_brier,
        "plan_win_rate": {k: float(outcome(v, "plan").mean()) for k, v in arms},
        "plan_win_rate_diff": float(d_plan.mean()),
        "plan_win_rate_diff_95": r_plan,
        "do_nothing_win_rate": {k: float(outcome(v, "dn").mean()) for k, v in arms},
        "primary_met": primary,
        "guard_met": guard,
        "verdict": verdict,
        "summaries": {k: backtest.summarize(v) for k, v in runs.items()},
    }
    echo(f"\nteam-weeks paired: {len(both)} over {weeks.nunique()} weeks")
    echo(f"Brier, doing nothing: baseline {brier_b.mean():.4f}, ensemble {brier_e.mean():.4f}")
    echo(f"  ensemble - baseline {d_brier.mean():+.4f}  95% [{r_brier[0]:+.4f}, {r_brier[1]:+.4f}]")
    echo(
        f"Win rate following the plan: baseline {outcome(b, 'plan').mean():.3f}, "
        f"ensemble {outcome(e, 'plan').mean():.3f}"
    )
    echo(f"  ensemble - baseline {d_plan.mean():+.4f}  95% [{r_plan[0]:+.4f}, {r_plan[1]:+.4f}]")
    echo(f"primary (Brier range below zero): {'met' if primary else 'not met'}")
    echo(f"guard (plans not worse): {'met' if guard else 'not met'}")
    echo(f"verdict: {verdict} (guard 3, makes within attempts, is checked by make bakeoff)")
    out = cfg.paths.db.resolve().parent / "replay" / date.today().isoformat()
    out.mkdir(parents=True, exist_ok=True)
    for k, v in runs.items():
        v.to_csv(out / f"{k}.csv", index=False)
    (out / "summary.json").write_text(json.dumps(summary, indent=1, default=str))
    echo(f"saved to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

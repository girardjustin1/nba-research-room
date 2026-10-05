"""Backtest: replay a past season week by week as if the tool had been running.

Inputs: game logs and team context (features.py), the season's schedule (games), player
positions (players), the baseline model and the simulator calibration (fitted the live way, see
calibration.live_player_weeks), both fitted on seasons before the one replayed,
settings.backtest / optimizer / roster.
Outputs: one row per sampled team-week: predicted P(win week) doing nothing and with the
optimizer's plan, and what actually happened under each (categories won, week won). A summary:
calibration of the predictions, and the realized lift from following the plan.
Tables: writes backtest_results.

The league is simulated: no real 2025-26 league rosters exist here. 14 teams snake-draft 12
players each on season-start projected value; everyone else is a free agent. Each sampled
team-week:
- Do nothing: the roster as drafted (as of that week), daily lineups by lineup.assign_day.
- Plan: the optimizer's Monday plan (made the day before, so adds count from Monday), lineups
  the same way.
Actual totals use real box scores of the players in active slots each day. Projections are made
the way the live system makes them: each player's state as of Monday (games before it only) carried
onto every scheduled game of his team that week, with a model and calibration fitted on earlier
seasons. Nothing peeks ahead, including who will be available: an earlier version projected only
games a player later appeared in, which let the optimizer "know" injuries in advance.
Approximations, stated in the report: positions come from BallDontLie (G, F, C and combos) mapped
to Yahoo-style eligibility; the opponent does nothing; a plan is made once per week (Monday), not
re-planned mid-week; rosters don't carry plans from week to week.
"""

from __future__ import annotations

import time
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd

from research_room import calibration, features, lineup, matchup, optimizer, store
from research_room.config import Settings, settings
from research_room.projections.baseline import STATS, BaselineModel

BDL_TO_YAHOO = {"G": ["PG", "SG"], "F": ["SF", "PF"], "C": ["C"]}


def eligibility(bdl_position: str | None) -> list[str]:
    """'G-F' -> ['PG', 'SG', 'SF', 'PF'] (BallDontLie positions are coarse; see module doc)."""
    out: list[str] = []
    for part in str(bdl_position or "").split("-"):
        out += [p for p in BDL_TO_YAHOO.get(part.strip(), []) if p not in out]
    return out or ["SF", "PF"]


def actuals(rows: pd.DataFrame) -> pd.DataFrame:
    """Real box-score lines, one row per player-day (a missing row means he didn't play)."""
    act = rows[["player_id", "game_date", "y_did_play", *(f"y_{s}" for s in STATS)]].copy()
    act["date"] = pd.to_datetime(act["game_date"]).dt.date
    return act.drop(columns=["game_date"])


def week_projections(
    model,
    logs: pd.DataFrame,
    team_ctx: pd.DataFrame,
    schedule: pd.DataFrame,
    start: date,
    days: list[date],
    season: int,
    cfg: Settings,
) -> pd.DataFrame:
    """Projections for every scheduled game this week, as the live system makes them: each player's
    state as of Monday (his games before it only), carried onto all of his team's games, whether
    or not he later played. Players: everyone with a game this season before Monday."""
    cut = pd.Timestamp(datetime.combine(start, datetime.min.time(), matchup.ET)).tz_convert("UTC")
    pre = logs[(logs["tip_utc"] < cut) & (logs["season"] >= season - 1)]
    last = pre[pre["season"] == season].sort_values("tip_utc").groupby("player_id").tail(1)
    if last.empty:
        return pd.DataFrame(columns=["player_id", "date", "stat", "mean", "sd"])
    dummy = last.assign(
        game_id=-last["player_id"],
        tip_utc=cut,
        minutes=0.0,
        did_play=False,
        usage_pct=np.nan,
        game_date=pd.Timestamp(start),
    )
    for s in features.RATE_STATS:
        dummy[s] = 0.0
    built = features.build(pd.concat([pre, dummy], ignore_index=True), team_ctx, cfg)
    keep = ["player_id", "min_played_ewma", "play_rate_ewma", "games_prior", *[f"{s}_pm_ewma" for s in STATS]]
    state = built[built["game_id"] < 0][keep].merge(last[["player_id", "team_id"]], on="player_id")
    week = schedule[schedule["date"].isin(days)]
    rows = week.merge(state, on="team_id")
    if rows.empty:
        return pd.DataFrame(columns=["player_id", "date", "stat", "mean", "sd"])
    pred = model.predict(rows.assign(play_prob=rows["play_rate_ewma"], season_games=10_000))
    pred["date"] = pd.to_datetime(pred["date"]).dt.date
    return pred[["player_id", "date", "stat", "mean", "sd"]]


def team_schedule(games: pd.DataFrame) -> pd.DataFrame:
    """Long form: one row per team per regular-season game (team_id, game_id, date)."""
    g = games[~games["postseason"].fillna(False).astype(bool)]
    d = pd.to_datetime(g["game_date"]).dt.date
    home = pd.DataFrame({"team_id": g["home_team_id"], "game_id": g["game_id"], "date": d})
    away = pd.DataFrame({"team_id": g["visitor_team_id"], "game_id": g["game_id"], "date": d})
    return pd.concat([home, away], ignore_index=True)


def season_values(proj: pd.DataFrame, first_days: list[date], cfg: Settings) -> pd.Series:
    """Each player's value per game over the season's first days, as the draft board would see it
    (projected lines, already x P(plays), weighted by the lineup tool's category weights)."""
    p = proj[proj["date"].isin(first_days)]
    mean = p.pivot_table(index="player_id", columns="stat", values="mean", aggfunc="mean").fillna(0.0)
    w = lineup.category_weights(mean, cfg)
    return lineup.player_value(mean, w, lineup.league_pct(mean, cfg), cfg).sort_values(ascending=False)


def draft_league(values: pd.Series, teams: int, size: int) -> list[list[int]]:
    """Snake draft on value: team 1 picks first in odd rounds, last in even rounds."""
    order = list(values.index[: teams * size])
    rosters: list[list[int]] = [[] for _ in range(teams)]
    for i, pid in enumerate(order):
        rnd, k = divmod(i, teams)
        rosters[k if rnd % 2 == 0 else teams - 1 - k].append(int(pid))
    return rosters


def roster_frame(ids: list[int], elig: dict[int, list[str]], names: dict[int, str]) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "player_id": ids,
            "name": [names.get(p, f"#{p}") for p in ids],
            "eligible": [elig.get(p, ["SF", "PF"]) for p in ids],
            "status": None,
            "current_slot": "BN",
        }
    )


def actual_totals(td: matchup.TeamDays, actual: pd.DataFrame, cfg: Settings) -> dict[str, float | None]:
    """Real week totals of the players in active slots each day (DNPs count nothing)."""
    a = actual.set_index(["player_id", "date"])
    tot = {s: 0.0 for s in STATS}
    for day, starters in zip(td.days, td.starters, strict=True):
        for p in starters:
            if (p, day) in a.index:
                row = a.loc[(p, day)]
                row = row.iloc[0] if isinstance(row, pd.DataFrame) else row
                for s in STATS:
                    tot[s] += float(row[f"y_{s}"] or 0.0)
    out: dict[str, float | None] = {}
    for c in cfg.categories:
        if c.kind == "pct":
            out[c.key] = tot[c.made] / tot[c.attempts] if tot[c.attempts] > 0 else None
        else:
            out[c.key] = tot[c.key]
    return out


def categories_won(me: dict, opp: dict, cfg: Settings) -> int:
    won = 0
    for c in cfg.categories:
        a, b = me[c.key], opp[c.key]
        if a is None or b is None or a == b:
            continue
        won += (a > b) if c.higher_is_better else (a < b)
    return int(won)


def round_robin(teams: int, week: int) -> list[tuple[int, int]]:
    """Circle-method pairing for `week` (0-based): team 0 stays put, the rest rotate."""
    rest = list(range(1, teams))
    k = week % (teams - 1)
    if k:
        rest = rest[-k:] + rest[:-k]
    arr = [0, *rest]
    return [(arr[i], arr[teams - 1 - i]) for i in range(teams // 2)]


def run(
    logs: pd.DataFrame,
    team_ctx: pd.DataFrame,
    games: pd.DataFrame,
    positions: dict[int, str | None],
    names: dict[int, str],
    cfg: Settings | None = None,
    test_season: int | None = None,
    echo=print,
) -> pd.DataFrame:
    """Replay `test_season` (default: the latest in `logs`). Returns one row per team-week."""
    cfg = cfg or settings()
    bt = cfg.backtest
    built = features.build(logs, team_ctx, cfg)
    built = built[built["min_played_ewma"].notna()]
    test_season = test_season or int(built["season"].max())
    season_sched = team_schedule(games).merge(games[["game_id", "season"]], on="game_id")
    train_seasons = sorted(built.loc[built["season"] < test_season, "season"].unique())
    model = BaselineModel(cfg).fit(built[built["season"] < test_season])
    model.fit_minutes(built, season_sched, train_seasons)
    cal = calibration.calibrate(built, cfg, test_season, schedule=season_sched)
    var_mult = dict(zip(cal["category"], cal["multiplier"], strict=True))
    corr = cal.attrs["corr"].to_numpy(float)
    actual = actuals(built[built["season"] == test_season])
    schedule = team_schedule(games[games["season"] == test_season])
    all_days = sorted(schedule["date"].unique())
    # Start at the second Monday so every player has an in-season state and team.
    monday = all_days[0] - timedelta(days=all_days[0].weekday()) + timedelta(days=7)
    rng = np.random.default_rng(bt.seed)
    z0 = matchup.zero_to_date(cfg)
    rows, league, owned, elig = [], None, set(), {}
    for w in range(bt.max_weeks):
        start = monday + timedelta(days=7 * w)
        days = [start + timedelta(days=i) for i in range(7) if start + timedelta(days=i) in set(all_days)]
        if not days:
            break
        pw = week_projections(model, logs, team_ctx, schedule, start, days, test_season, cfg)
        for pid in pw["player_id"].unique():
            elig.setdefault(int(pid), eligibility(positions.get(int(pid))))
        if league is None:
            # The simulated draft uses the first replayed week's states (one week into the season).
            league = draft_league(season_values(pw, days, cfg), bt.teams, bt.roster_size)
            owned = {p for r in league for p in r}
        aw = actual[actual["date"].isin(days)]
        pool = roster_frame(sorted(set(pw["player_id"]) - owned), elig, names)
        pairs = round_robin(bt.teams, w)
        for k in rng.choice(len(pairs), size=min(bt.matchups_per_week, len(pairs)), replace=False):
            a, b = pairs[int(k)]
            me_r, opp_r = roster_frame(league[a], elig, names), roster_frame(league[b], elig, names)
            me_td, opp_td = matchup.team_days(me_r, pw, days, cfg), matchup.team_days(opp_r, pw, days, cfg)
            dn = matchup.matchup_now(me_td, opp_td, z0, z0, var_mult, cfg, corr)
            now = datetime.combine(start - timedelta(days=1), datetime.min.time(), matchup.ET).replace(
                hour=12
            )
            inp = {
                "days": days,
                "now": now,
                "proj": pw,
                "me_roster": me_r,
                "opp_roster": opp_r,
                "me": me_td,
                "opp": opp_td,
                "me_done": z0,
                "opp_done": z0,
                "var_mult": var_mult,
                "corr": corr,
            }
            plan = optimizer.optimize(inp, pool, cfg.transactions.max_acquisitions_per_week, cfg)
            plan_td = matchup.team_days(plan.rosters or [me_r] * len(days), pw, days, cfg)
            opp_act = actual_totals(opp_td, aw, cfg)
            cats_dn = categories_won(actual_totals(me_td, aw, cfg), opp_act, cfg)
            cats_plan = categories_won(actual_totals(plan_td, aw, cfg), opp_act, cfg)
            need = len(cfg.categories) // 2 + 1
            rows.append(
                {
                    "season": test_season,
                    "week_start": start,
                    "team": a + 1,
                    "opponent": b + 1,
                    "p_dn": dn.p_win_week,
                    "p_plan": plan.p_win_week,
                    "cats_dn": cats_dn,
                    "cats_plan": cats_plan,
                    "won_dn": cats_dn >= need,
                    "won_plan": cats_plan >= need,
                    "n_moves": len(plan.moves),
                    "solve_ms": plan.solve_ms,
                }
            )
        echo(f"week of {start}: {len(rows)} team-weeks so far")
    return pd.DataFrame(rows)


def summarize(res: pd.DataFrame) -> dict:
    """Calibration of the do-nothing predictions and the realized lift from the plans."""
    if res.empty:
        return {}
    y = res["won_dn"].astype(float)
    brier = float(((res["p_dn"] - y) ** 2).mean())
    bins = pd.cut(res["p_dn"], [0, 0.2, 0.4, 0.6, 0.8, 1.0], include_lowest=True)
    rel = (
        res.assign(y=y)
        .groupby(bins, observed=True)
        .agg(pred=("p_dn", "mean"), actual=("y", "mean"), n=("y", "size"))
    )
    rel.index = rel.index.astype(str)
    rng = np.random.default_rng(0)
    lift = (res["won_plan"].astype(float) - y).to_numpy()
    cats = (res["cats_plan"] - res["cats_dn"]).to_numpy(float)
    boot = [rng.choice(lift, len(lift)).mean() for _ in range(2000)]
    return {
        "team_weeks": len(res),
        "brier_do_nothing": brier,
        "reliability": rel.rename_axis("predicted").reset_index().to_dict("records"),
        "win_rate_do_nothing": float(y.mean()),
        "win_rate_plan": float(res["won_plan"].mean()),
        "lift_win_rate": float(lift.mean()),
        "lift_win_rate_80": [float(np.quantile(boot, 0.1)), float(np.quantile(boot, 0.9))],
        "lift_categories": float(cats.mean()),
        "predicted_lift": float((res["p_plan"] - res["p_dn"]).mean()),
        "moves_per_week": float(res["n_moves"].mean()),
        "solve_s": float(res["solve_ms"].mean() / 1000),
    }


def run_from_store(con, cfg: Settings | None = None, echo=print) -> tuple[pd.DataFrame, dict]:
    cfg = cfg or settings()
    seasons = sorted(cfg.bdl.backfill_seasons)
    logs, team_ctx = features.load_logs(con, seasons), features.team_context(con, seasons)
    games = con.execute(
        "SELECT game_id, season, game_date, home_team_id, visitor_team_id, postseason FROM games"
    ).df()
    pl = con.execute("SELECT player_id, position, full_name FROM players").df()
    positions = dict(zip(pl["player_id"], pl["position"], strict=True))
    names = dict(zip(pl["player_id"], pl["full_name"], strict=True))
    t0 = time.perf_counter()
    res = run(logs, team_ctx, games, positions, names, cfg, echo=echo)
    echo(f"backtest: {len(res)} team-weeks in {time.perf_counter() - t0:.0f}s")
    return res, summarize(res)


def write(con, res: pd.DataFrame) -> int:
    return store.upsert(con, "backtest_results", res.assign(run_at=store.utcnow()))

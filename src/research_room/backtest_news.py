"""News backtest: replay a past season day by day, as the live app runs on game days.

Inputs: game logs and team context (features.py), the season's games (with tip times), player
positions, the NBA injury reports stored for that season (`make report-backfill`), the baseline
model (with and without teammates out) and the simulator calibration, fitted on earlier seasons.
Outputs: one row per sampled team-week and version: P(win week) at each day's decision time, and
the categories and week each version's lineups actually won. A summary by version and day.
Tables: reads nba_report_rows, nba_report_teams (the rest comes in as frames).

The weekly backtest (backtest.py) projects once, as of the Sunday plan, with no game-day news, and
sets lineups from who actually played. The live app instead re-projects each game day and sets
each day's lineup from that day's projections. This replays that, for the weekly backtest's own
league and matchups (its draft and its Sunday projections), in five versions:
- monday: the weekly backtest's projections all week (no news), lineups from them.
- daily: re-projected each day from every player's state that morning (games before the day), no
  news.
- daily_news: as daily, plus the NBA injury report: for each game, the latest report published by
  the day's decision time (`backtest.decision_hour_et`, 5:30 PM Eastern) and at least 30 minutes
  before its tip. Listed statuses at the calibrated P(plays); for a team that has filed, a
  rotation player not listed plays by his recent play rate (overrides.fill_unlisted; "not listed"
  uses that season's rosters, not today's). Teammates out on.
- daily_news_no_tmo: daily_news with teammates out switched off.
- hindsight: lineups set from who actually played (perfect news), Monday's projections.
P(win week) at day k (its decision time): the real totals of that version's starters on days
before k, plus that version's day-k projections for the rest of the week (including day k's
games), for both sides (both managers equally informed). Rosters are as drafted (no adds), so
lineups and news are the only levers. Known approximation: a player who never plays again keeps a
one-game-old state (features.monday_states).

The X forward test (x_forward_test, `make x-forward-test`; the rule is in DECISIONS.md, written
before opening night) replays this season's finished game days the same way, per player-game: each
morning's states, the same model, and the overrides as the live app resolves them
(overrides.resolve) at each game's decision time, in two arms: with X statuses, and without (the
NBA report and BallDontLie only). Manual entries are left out of both (they carry no time they
were known). Only what was known by then counts: an X status first seen after the decision time,
or held for review (unmatched, team_conflict), is not used. Scored on P(plays) (Brier, on the
player-games where X gave a status) and points (average miss, every graded player-game), paired by
player-game, with ranges from resampling whole game days. Graded: player-games with a box-score
row (BallDontLie lists inactive players too, so a game he sat counts, as 0).
"""

from __future__ import annotations

import time
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd

from research_room import backtest, calibration, features, matchup, optimizer, overrides
from research_room.config import Settings, settings
from research_room.projections.baseline import STATS, BaselineModel

VERSIONS = ("monday", "daily", "daily_news", "daily_news_no_tmo", "hindsight")
TIP_MARGIN = pd.Timedelta(minutes=30)  # news counts only when out this long before the tip (audit F01)


def _cut(day: date) -> pd.Timestamp:
    return pd.Timestamp(datetime.combine(day, datetime.min.time()), tz=matchup.ET).tz_convert("UTC")


def decision_times(games: pd.DataFrame, cfg: Settings) -> pd.Series:
    """Per game_id (UTC): when the replay decides for that game, the day's decision time
    (`backtest.decision_hour_et`, Eastern wall clock, so a daylight-saving change day is right) or
    30 minutes before its tip, whichever is first (audit F01)."""
    g = games.drop_duplicates("game_id").set_index("game_id")
    tips = pd.to_datetime(g["tip_utc"], utc=True) - TIP_MARGIN
    wall = pd.to_datetime(g["game_date"]) + pd.Timedelta(hours=cfg.backtest.decision_hour_et)
    decide = wall.dt.tz_localize(matchup.ET).dt.tz_convert("UTC")
    return pd.concat([tips, decide], axis=1).min(axis=1)


def report_news(con, games: pd.DataFrame, cfg: Settings) -> tuple[pd.DataFrame, set[tuple[int, int]]]:
    """Per game, the latest stored report published by that day's decision time
    (`backtest.decision_hour_et`) and at least 30 minutes before its tip (audit F01): listed
    players (game_id, player_id, status, p) and the (game_id, team_id) pairs that had filed."""
    teams = con.execute("SELECT report_ts, game_id, team_id, submitted FROM nba_report_teams").df()
    rows = con.execute("SELECT report_ts, game_id, player_id, status FROM nba_report_rows").df()
    if teams.empty:
        return pd.DataFrame(columns=["game_id", "player_id", "status", "p"]), set()
    teams["deadline"] = teams["game_id"].map(decision_times(games, cfg))
    ok = teams[pd.to_datetime(teams["report_ts"], utc=True) <= pd.to_datetime(teams["deadline"], utc=True)]
    pick = ok.groupby("game_id")["report_ts"].max().rename("pick").reset_index()
    filed = ok.merge(pick, on="game_id")
    filed = filed[(filed["report_ts"] == filed["pick"]) & filed["submitted"]]
    listed = rows.merge(pick, on="game_id")
    listed = listed[listed["report_ts"] == listed["pick"]]
    probs = {k.lower(): v for k, v in cfg.overrides.status_play_prob.items()}
    listed = listed.assign(p=listed["status"].str.lower().map(probs))[["game_id", "player_id", "status", "p"]]
    return listed, {(int(g), int(t)) for g, t in zip(filed["game_id"], filed["team_id"], strict=True)}


def _rows(states: pd.DataFrame, schedule: pd.DataFrame, days: list[date]) -> pd.DataFrame:
    """Projection inputs: each player's state (one row per player) on every game his team plays
    on `days`."""
    rows = schedule[schedule["date"].isin(days)].merge(states, on="team_id")
    return rows.assign(play_prob=rows["play_rate_ewma"], season_games=10_000)


def project(
    model: BaselineModel,
    states: pd.DataFrame,
    schedule: pd.DataFrame,
    days: list[date],
    news: tuple[pd.DataFrame, set] | None,
    news_day: date | None,
    cfg: Settings,
    ov: pd.DataFrame | None = None,
    extra: tuple[str, ...] = (),
) -> pd.DataFrame:
    """Long projection rows for `days` from `states` (one row per player), with the report news
    applied to `news_day`'s games when given. `ov`: overrides per (game_id, player_id)
    [play_prob, minutes_cap, status] (x_arms), applied as the live app applies them
    (baseline.project_window). `extra`: more columns to keep (game_id, p_play)."""
    cols = ["player_id", "date", "stat", "mean", "sd", *extra]
    rows = _rows(states, schedule, days)
    if rows.empty:
        return pd.DataFrame(columns=cols)
    if ov is not None:
        keys = ["game_id", "player_id"]
        o = ov.rename(columns={"play_prob": "play_prob_override", "status": "status_override"})
        o = o[[*keys, "play_prob_override", "minutes_cap", "status_override"]].astype({k: int for k in keys})
        rows = rows.merge(o, on=keys, how="left")
        rows["play_prob_override"] = pd.to_numeric(rows["play_prob_override"], errors="coerce").fillna(
            overrides.fill_unlisted(rows, cfg)
        )
    if news is not None and news_day is not None:
        listed, filed = news
        today = rows["date"] == news_day
        lk = listed.set_index(["game_id", "player_id"])["p"]
        key = pd.MultiIndex.from_frame(rows[["game_id", "player_id"]].astype(int))
        p = pd.Series(lk.reindex(key).to_numpy(), index=rows.index).where(today)
        is_filed = pd.Series(
            [(int(g), int(t)) in filed for g, t in zip(rows["game_id"], rows["team_id"], strict=True)],
            index=rows.index,
        )
        rows["status_override"] = np.where(today & p.isna() & is_filed, overrides.NOT_LISTED, None)
        rows["play_prob_override"] = p.fillna(overrides.fill_unlisted(rows, cfg))
    pred = model.predict(rows)
    pred["date"] = pd.to_datetime(pred["date"]).dt.date
    return pred[cols]


def done_totals(td: matchup.TeamDays, upto: int, actual: pd.DataFrame, cfg: Settings) -> matchup.ToDate:
    """Real totals of a version's starters over its first `upto` days, as the live to-date."""
    out = matchup.zero_to_date(cfg)
    if upto == 0:
        return out
    a = actual.set_index(["player_id", "date"])
    tot = {s: 0.0 for s in STATS}
    for day, starters in zip(td.days[:upto], td.starters[:upto], strict=True):
        for pid in starters:
            if (pid, day) in a.index:
                row = a.loc[(pid, day)]
                row = row.iloc[0] if isinstance(row, pd.DataFrame) else row
                for s in STATS:
                    tot[s] += float(row[f"y_{s}"] or 0.0)
    for c in cfg.categories:
        if c.kind == "pct":
            out.made[c.key], out.att[c.key] = tot[c.made], tot[c.attempts]
        else:
            out.total[c.key] = tot[c.key]
    return out


def _states_on_rosters(
    built: pd.DataFrame, season: int, cuts: list[pd.Timestamp], rosters: dict[int, int]
) -> pd.DataFrame:
    """Each morning's state for everyone who played this season or last, as the live app projects
    (baseline.project_window). A player with no game yet this season before that morning plays for
    his team on `rosters` (today's players table), and isn't projected without one."""
    st = features.monday_states(built[built["season"] >= season - 1], cuts)
    first = built[built["season"] == season].groupby("player_id")["tip_utc"].min()
    started = st["player_id"].map(first).lt(st["monday"]).fillna(False).astype(bool)
    st["team_id"] = st["team_id"].where(started, st["player_id"].map(rosters))
    st = st[st["team_id"].notna()].copy()
    st["team_id"] = st["team_id"].astype(int)
    return st


def _season(
    logs: pd.DataFrame,
    team_ctx: pd.DataFrame,
    games: pd.DataFrame,
    cfg: Settings,
    test_season: int | None,
    days: list[date] | None = None,
    rosters: dict[int, int] | None = None,
) -> dict:
    """The replayed season: the feature table, the model fitted on earlier seasons, actual lines,
    schedule, and every player's state each morning of `days` (default: every game day).
    Players: those who have played this season before the morning, or with `rosters` also last
    season's (_states_on_rosters; the X forward test)."""
    built = features.build(logs, team_ctx, cfg)
    test_season = test_season or int(built.loc[built["min_played_ewma"].notna(), "season"].max())
    train = built[(built["season"] < test_season) & built["min_played_ewma"].notna()]
    sg = games[games["season"] == test_season]
    schedule = backtest.team_schedule(sg)
    all_days = sorted(schedule["date"].unique()) if days is None else sorted(days)
    cuts = [_cut(d) for d in all_days]
    if rosters is None:
        states = features.monday_states(built[built["season"] == test_season], cuts)
    else:
        states = _states_on_rosters(built, test_season, cuts, rosters)
    states["day"] = states["monday"].dt.tz_convert(matchup.ET).dt.date
    return {
        "built": built,
        "season": test_season,
        "train": train,
        "games": sg,
        "model": BaselineModel(cfg).fit(train),
        "actual": backtest.actuals(built[built["season"] == test_season]),
        "schedule": schedule,
        "all_days": all_days,
        "states": states,
    }


def _prepare(
    con,
    logs: pd.DataFrame,
    team_ctx: pd.DataFrame,
    games: pd.DataFrame,
    cfg: Settings,
    test_season: int | None,
) -> dict:
    """The replayed season (_season), plus the model with teammates out off, the simulator
    calibration and the report news."""
    off = cfg.model_copy(
        update={
            "baseline": cfg.baseline.model_copy(
                update={"teammates": cfg.baseline.teammates.model_copy(update={"enabled": False})}
            )
        }
    )
    ctx = _season(logs, team_ctx, games, cfg, test_season)
    built = ctx["built"]
    season_sched = backtest.team_schedule(games).merge(games[["game_id", "season"]], on="game_id")
    cal = calibration.calibrate(
        built[built["min_played_ewma"].notna()], cfg, ctx["season"], schedule=season_sched
    )
    return ctx | {
        "logs": logs,
        "team_ctx": team_ctx,
        "model_off": BaselineModel(off).fit(ctx["train"]),
        "var_mult": dict(zip(cal["category"], cal["multiplier"], strict=True)),
        "corr": cal.attrs["corr"].to_numpy(float),
        "news": report_news(con, ctx["games"], cfg),
    }


def _weeks(ctx: dict, positions: dict, cfg: Settings, versions=("daily", "daily_news", "daily_news_no_tmo")):
    """Per replayed week: days, the simulated league, Monday's projections, each version's
    projections made each morning, the real lines, and the sampled matchups (the weekly
    backtest's draws)."""
    bt, keep = cfg.backtest, ["player_id", "team_id", *features.STATE_COLUMNS]
    all_days = ctx["all_days"]
    monday = all_days[0] - timedelta(days=all_days[0].weekday()) + timedelta(days=7)
    rng = np.random.default_rng(bt.seed)
    league, elig = None, {}
    spec = {
        "daily": ("model", False),
        "daily_news": ("model", True),
        "daily_news_no_tmo": ("model_off", True),
    }
    for w in range(bt.max_weeks):
        start = monday + timedelta(days=7 * w)
        days = [start + timedelta(days=i) for i in range(7) if start + timedelta(days=i) in set(all_days)]
        if not days:
            return
        st = {d: ctx["states"].loc[ctx["states"]["day"] == d, keep] for d in days}
        # The weekly backtest's own projections (state as of the Sunday plan), so every replay
        # drafts the same league and the Monday version is the weekly one (audit F02, F12).
        mon = backtest.week_projections(
            ctx["model"], ctx["logs"], ctx["team_ctx"], ctx["schedule"], start, days, ctx["season"], cfg
        )
        for pid in mon["player_id"].unique():
            elig.setdefault(int(pid), backtest.eligibility(positions.get(int(pid))))
        if league is None:
            league = backtest.draft_league(backtest.season_values(mon, days, cfg), bt.teams, bt.roster_size)
        made = {"monday": {k: mon for k in range(len(days))}}
        for v in versions:
            m, with_news = spec[v]
            made[v] = {
                k: project(
                    ctx[m], st[d], ctx["schedule"], days[k:], ctx["news"] if with_news else None, d, cfg
                )
                for k, d in enumerate(days)
            }
        pairs = backtest.round_robin(bt.teams, w)
        picks = rng.choice(len(pairs), size=min(bt.matchups_per_week, len(pairs)), replace=False)
        yield {
            "start": start,
            "days": days,
            "league": league,
            "elig": elig,
            "mon": mon,
            "made": made,
            "aw": ctx["actual"][ctx["actual"]["date"].isin(days)],
            "matchups": [pairs[int(i)] for i in picks],
        }


def _decide(made: dict, days: list[date]) -> pd.DataFrame:
    """The rows a version sets each day's lineup from: day k's rows of its day-k projections."""
    return pd.concat([made[k][made[k]["date"] == d] for k, d in enumerate(days)])


def run(
    con,
    logs: pd.DataFrame,
    team_ctx: pd.DataFrame,
    games: pd.DataFrame,
    positions: dict[int, str | None],
    names: dict[int, str],
    cfg: Settings | None = None,
    test_season: int | None = None,
    echo=print,
) -> pd.DataFrame:
    cfg = cfg or settings()
    ctx = _prepare(con, logs, team_ctx, games, cfg, test_season)
    var_mult, corr = ctx["var_mult"], ctx["corr"]
    out = []
    for wk in _weeks(ctx, positions, cfg):
        days, made, aw = wk["days"], dict(wk["made"]), wk["aw"]
        made["hindsight"] = made["monday"]
        decide = {v: _decide(p, days) for v, p in made.items()}
        suited = aw.loc[aw["y_did_play"].astype(bool), ["player_id", "date"]].drop_duplicates()
        decide["hindsight"] = wk["mon"].merge(suited, on=["player_id", "date"])
        for a, b in wk["matchups"]:
            me_r = backtest.roster_frame(wk["league"][a], wk["elig"], names)
            opp_r = backtest.roster_frame(wk["league"][b], wk["elig"], names)
            for v in VERSIONS:
                me_td = matchup.team_days(me_r, decide[v], days, cfg)
                opp_td = matchup.team_days(opp_r, decide[v], days, cfg)
                me_act = backtest.actual_totals(me_td, aw, cfg)
                opp_act = backtest.actual_totals(opp_td, aw, cfg)
                cats = backtest.categories_won(me_act, opp_act, cfg)
                cats_opp = backtest.categories_won(opp_act, me_act, cfg)
                row = {
                    "season": ctx["season"],
                    "week_start": wk["start"],
                    "team": a + 1,
                    "opponent": b + 1,
                    "version": v,
                    "days": len(days),
                    "cats": cats,
                    "cats_opp": cats_opp,
                    "won": cats > cats_opp,
                    "tie": cats == cats_opp,
                }
                for k in range(len(days)):
                    rem = made[v][k]
                    m_now = matchup.matchup_now(
                        matchup.team_days(me_r, rem, days[k:], cfg),
                        matchup.team_days(opp_r, rem, days[k:], cfg),
                        done_totals(me_td, k, aw, cfg),
                        done_totals(opp_td, k, aw, cfg),
                        var_mult,
                        cfg,
                        corr,
                    )
                    row[f"p{k}"] = m_now.p_win_week
                out.append(row)
        echo(f"week of {wk['start']}: {len(out) // len(VERSIONS)} team-weeks so far")
    return pd.DataFrame(out)


MOVE_VERSIONS = ("do_nothing", "monday_plan", "replan_daily", "replan_news")


def _commit(roster: pd.DataFrame, pool: pd.DataFrame, moves: list, day: date) -> pd.DataFrame:
    return optimizer.apply_moves(roster, pool, moves, [day])[0]


def run_moves(
    con,
    logs: pd.DataFrame,
    team_ctx: pd.DataFrame,
    games: pd.DataFrame,
    positions: dict[int, str | None],
    names: dict[int, str],
    cfg: Settings | None = None,
    test_season: int | None = None,
    echo=print,
) -> pd.DataFrame:
    """Add/drop replay. My side under four versions; the opponent never streams:
    - do_nothing: the roster as drafted, lineups from Monday's projections.
    - monday_plan: the optimizer's Sunday plan for the week (Monday projections), as the weekly
      backtest does.
    - replan_daily: the same Sunday plan's Monday moves, then each day at the decision time a
      re-plan for the rest of the week with that day's projections and the acquisitions left; only
      the moves that must
      be made that day (the adds counting from tomorrow) are made, the rest wait for the next re-plan.
    - replan_news: replan_daily with that day's NBA report (by the decision time) and teammates out.
    Each day's lineups (both sides) come from the version's projections that day; outcomes are
    real box scores."""
    cfg = cfg or settings()
    ctx = _prepare(con, logs, team_ctx, games, cfg, test_season)
    var_mult, corr = ctx["var_mult"], ctx["corr"]
    acq = cfg.transactions.max_acquisitions_per_week
    out = []
    for wk in _weeks(ctx, positions, cfg, versions=("daily", "daily_news")):
        days, made, aw, league = wk["days"], wk["made"], wk["aw"], wk["league"]
        owned = {p for r in league for p in r}
        pool = backtest.roster_frame(sorted(set(wk["mon"]["player_id"]) - owned), wk["elig"], names)
        sunday = datetime.combine(days[0] - timedelta(days=1), datetime.min.time(), matchup.ET) + timedelta(
            hours=cfg.backtest.plan_hour_et
        )
        for a, b in wk["matchups"]:
            me_r = backtest.roster_frame(league[a], wk["elig"], names)
            opp_r = backtest.roster_frame(league[b], wk["elig"], names)
            mon = made["monday"][0]
            inp = {
                "days": days,
                "now": sunday,
                "proj": mon,
                "me_roster": me_r,
                "opp_roster": opp_r,
                "me": matchup.team_days(me_r, mon, days, cfg),
                "opp": matchup.team_days(opp_r, mon, days, cfg),
                "me_done": matchup.zero_to_date(cfg),
                "opp_done": matchup.zero_to_date(cfg),
                "var_mult": var_mult,
                "corr": corr,
            }
            sunday_plan = optimizer.optimize(inp, pool, acq, cfg)
            for v in MOVE_VERSIONS:
                src = {
                    "do_nothing": "monday",
                    "monday_plan": "monday",
                    "replan_daily": "daily",
                    "replan_news": "daily_news",
                }[v]
                decide = _decide(made[src], days)
                opp_td = matchup.team_days(opp_r, decide, days, cfg)
                if v == "do_nothing":
                    rosters, n_moves = [me_r] * len(days), 0
                elif v == "monday_plan":
                    rosters, n_moves = sunday_plan.rosters or [me_r] * len(days), len(sunday_plan.moves)
                else:
                    first = [m for m in sunday_plan.moves if m.effective == days[0]]
                    released = {m.drop for m in first if m.drop is not None}
                    roster, left, n_moves = _commit(me_r, pool, first, days[0]), acq, len(first)
                    left -= sum(m.add is not None for m in first)
                    rosters = [roster]
                    for k in range(len(days) - 1):
                        rem, rest = made[src][k], days[k:]
                        mine = matchup.team_days(rosters[:k] + [roster], decide, days[: k + 1], cfg)
                        step = {
                            "days": rest,
                            "now": datetime.combine(days[k], datetime.min.time(), matchup.ET)
                            + timedelta(hours=cfg.backtest.decision_hour_et),
                            "proj": rem,
                            "me_roster": roster,
                            "opp_roster": opp_r,
                            "me": matchup.team_days(roster, rem, rest, cfg),
                            "opp": matchup.team_days(opp_r, rem, rest, cfg),
                            "me_done": done_totals(mine, k, aw, cfg),
                            "opp_done": done_totals(opp_td, k, aw, cfg),
                            "var_mult": var_mult,
                            "corr": corr,
                        }
                        taken = set(roster["player_id"]) | owned | released  # dropped: on waivers
                        plan = optimizer.optimize(step, pool[~pool["player_id"].isin(taken)], left, cfg)
                        now_moves = [m for m in plan.moves if m.effective == days[k + 1]]
                        released |= {m.drop for m in now_moves if m.drop is not None}
                        roster = _commit(roster, pool, now_moves, days[k + 1])
                        left -= sum(m.add is not None for m in now_moves)
                        n_moves += len(now_moves)
                        rosters.append(roster)
                me_td = matchup.team_days(rosters, decide, days, cfg)
                me_act, opp_act = (
                    backtest.actual_totals(me_td, aw, cfg),
                    backtest.actual_totals(opp_td, aw, cfg),
                )
                cats = backtest.categories_won(me_act, opp_act, cfg)
                cats_opp = backtest.categories_won(opp_act, me_act, cfg)
                out.append(
                    {
                        "season": ctx["season"],
                        "week_start": wk["start"],
                        "team": a + 1,
                        "opponent": b + 1,
                        "version": v,
                        "moves": n_moves,
                        "cats": cats,
                        "cats_opp": cats_opp,
                        "won": cats > cats_opp,
                        "tie": cats == cats_opp,
                    }
                )
        echo(f"week of {wk['start']}: {len(out) // len(MOVE_VERSIONS)} team-weeks so far")
    return pd.DataFrame(out)


def summarize_moves(res: pd.DataFrame) -> dict:
    """By version: win rate (a tie scores 0.5), categories, moves made, and the win-rate difference
    to the Monday plan, paired by team-week (80% bootstrap range)."""
    if res.empty:
        return {}
    res = res.assign(y=res["won"].astype(float) + 0.5 * res["tie"].astype(float))
    wide = res.pivot_table(index=["week_start", "team"], columns="version", values="y")
    rng = np.random.default_rng(0)
    out = {"team_weeks": int(len(wide)), "versions": {}}
    for v, g in res.groupby("version", sort=False):
        d = (wide[v] - wide["monday_plan"]).to_numpy()
        boot = [rng.choice(d, len(d)).mean() for _ in range(2000)]
        out["versions"][v] = {
            "win_rate": float(g["y"].mean()),
            "categories": float(g["cats"].mean()),
            "moves": float(g["moves"].mean()),
            "vs_monday_plan": float(d.mean()),
            "vs_monday_plan_80": [float(np.quantile(boot, 0.1)), float(np.quantile(boot, 0.9))],
        }
    return out


def summarize(res: pd.DataFrame) -> dict:
    """By version: weekly-odds Brier at each day's decision time and pooled, and the pooled Brier
    difference against the Monday-only version, paired by team-week (80% bootstrap range). Both
    sides use the same version, so lineup gains cancel: `same_result_as_monday` says how often a
    version's lineups changed the week's result at all. A tied week scores 0.5."""
    if res.empty:
        return {}
    res = res.assign(y=res["won"].astype(float) + 0.5 * res["tie"].astype(float))
    pcols = sorted(c for c in res.columns if c.startswith("p") and c[1:].isdigit())
    res["sq"] = pd.concat([(res[c] - res["y"]) ** 2 for c in pcols], axis=1).mean(axis=1)
    wide = res.pivot_table(index=["week_start", "team"], columns="version", values=["sq", "y"])
    out = {"team_weeks": int(len(wide)), "versions": {}}
    rng = np.random.default_rng(0)
    for v, g in res.groupby("version", sort=False):
        d = (wide["sq"][v] - wide["sq"]["monday"]).to_numpy()
        boot = [rng.choice(d, len(d)).mean() for _ in range(2000)]
        out["versions"][v] = {
            "brier_by_day": {c: float(((g[c] - g["y"]) ** 2).mean()) for c in pcols if g[c].notna().any()},
            "brier_all_days": float(g["sq"].mean()),
            "vs_monday": float(d.mean()),
            "vs_monday_80": [float(np.quantile(boot, 0.1)), float(np.quantile(boot, 0.9))],
            "same_result_as_monday": float((wide["y"][v] == wide["y"]["monday"]).mean()),
        }
    return out


def run_from_store(
    con, cfg: Settings | None = None, echo=print, moves: bool = False
) -> tuple[pd.DataFrame, dict]:
    cfg = cfg or settings()
    seasons = sorted(cfg.bdl.backfill_seasons)
    logs, team_ctx = features.load_logs(con, seasons), features.team_context(con, seasons)
    games = con.execute("""
        SELECT game_id, season, game_date, tip_utc, home_team_id, visitor_team_id, postseason FROM games
    """).df()
    pl = con.execute("SELECT player_id, position, full_name FROM players").df()
    positions = dict(zip(pl["player_id"], pl["position"], strict=True))
    names = dict(zip(pl["player_id"], pl["full_name"], strict=True))
    t0 = time.perf_counter()
    res = (run_moves if moves else run)(con, logs, team_ctx, games, positions, names, cfg, echo=echo)
    echo(f"news backtest: {len(res)} rows in {time.perf_counter() - t0:.0f}s")
    return res, (summarize_moves if moves else summarize)(res)


# ------------------------------------------------------------------ the X forward test

X_ARMS = ("without_x", "with_x")
X_VERDICTS = {
    "pass": "PASS: X keeps its place in the authority order",
    "demote": "PRIMARY NOT MET: X drops below the NBA injury report in the authority order",
    "switch_off": "WORSE WITH X: X is switched off until fixed",
}
_OV = ["player_id", "date", "play_prob", "minutes_cap", "status", "source"]


def x_arms(
    con, rows: pd.DataFrame, games: pd.DataFrame, day: date, cfg: Settings
) -> tuple[dict[str, pd.DataFrame], pd.DataFrame]:
    """For one game day's projection rows (game_id, player_id, date): the overrides each arm
    applies, resolved as the live app resolves them (overrides.resolve) at each game's decision
    time (decision_times): with X statuses, and without (the NBA report and BallDontLie only);
    manual entries in neither. Also the player-games X gave a status for, known by then
    (overrides.from_status_events: first seen by the decision time, never unmatched or
    team_conflict), with `carried` when all of them were carried from an earlier game."""
    keyed = rows[["game_id", "player_id", "date"]].drop_duplicates()
    keyed = keyed.astype({"game_id": int, "player_id": int})
    at = decision_times(games[games["game_id"].isin(keyed["game_id"])], cfg)
    keyed = keyed.assign(decide_at=keyed["game_id"].map(at))
    arms: dict[str, list[pd.DataFrame]] = {a: [] for a in X_ARMS}
    spoke = []
    for t, part in keyed.groupby("decide_at"):
        as_of = pd.Timestamp(t).to_pydatetime()
        for a in X_ARMS:
            ov = overrides.resolve(con, day, day, as_of=as_of, cfg=cfg, x=a == "with_x", manual=False)
            if not ov.empty:
                arms[a].append(part.merge(ov[_OV].astype({"player_id": int}), on=["player_id", "date"]))
        xs = overrides.from_status_events(con, day, day, as_of, cfg)
        if not xs.empty:
            xs = xs.astype({"player_id": int}).groupby(["player_id", "date"], as_index=False)["carried"].all()
            spoke.append(part.merge(xs, on=["player_id", "date"]))
    base = list(keyed.columns)
    out = {
        a: pd.concat(p, ignore_index=True) if p else pd.DataFrame(columns=[*base, *_OV[2:]])
        for a, p in arms.items()
    }
    return out, pd.concat(spoke, ignore_index=True) if spoke else pd.DataFrame(columns=[*base, "carried"])


def x_day(
    con,
    model: BaselineModel,
    states: pd.DataFrame,
    schedule: pd.DataFrame,
    games: pd.DataFrame,
    day: date,
    actual: pd.DataFrame,
    cfg: Settings,
) -> pd.DataFrame:
    """One game day of the X forward test, one row per graded player-game (a box-score row in
    `actual`: game_id, player_id, y_did_play, y_pts): each arm's P(plays) and points, the source
    that decided each arm, and whether X gave a status for it by the decision time."""
    rows = _rows(states, schedule, [day])
    if rows.empty:
        return pd.DataFrame()
    arms, spoke = x_arms(con, rows, games, day, cfg)
    keys = ["game_id", "player_id"]
    out = rows[keys].drop_duplicates().astype(int)
    for a in X_ARMS:
        pred = project(
            model, states, schedule, [day], None, day, cfg, ov=arms[a], extra=("game_id", "p_play")
        )
        pts = pred.loc[pred["stat"] == "pts", [*keys, "p_play", "mean"]].astype({k: int for k in keys})
        out = out.merge(pts.rename(columns={"p_play": f"p_{a}", "mean": f"pts_{a}"}), on=keys)
        src = arms[a][[*keys, "source"]].astype({k: int for k in keys})
        out = out.merge(src.rename(columns={"source": f"source_{a}"}), on=keys, how="left")
    sp = spoke[[*keys, "carried"]].astype({k: int for k in keys})
    out = out.merge(sp, on=keys, how="left")
    out["x_status"] = out["carried"].notna()
    out["x_carried"] = out["carried"].fillna(False).astype(bool)
    act = actual[[*keys, "y_did_play", "y_pts"]].astype({k: int for k in keys})
    out = out.drop(columns="carried").merge(act, on=keys)
    return out.assign(
        day=day, did_play=out["y_did_play"].astype(bool), y_pts=out["y_pts"].fillna(0.0).astype(float)
    ).drop(columns="y_did_play")


def run_x(
    con,
    logs: pd.DataFrame,
    team_ctx: pd.DataFrame,
    games: pd.DataFrame,
    rosters: dict[int, int],
    days: list[date],
    cfg: Settings,
    season: int,
    echo=print,
) -> pd.DataFrame:
    """Both arms over `days` of `season`, one row per graded player-game (x_day)."""
    ctx = _season(logs, team_ctx, games, cfg, season, days=days, rosters=rosters)
    b = ctx["built"]
    actual = b.loc[b["season"] == ctx["season"], ["game_id", "player_id", "y_did_play", "y_pts"]]
    keep = ["player_id", "team_id", *features.STATE_COLUMNS]
    out = []
    for d in days:
        st = ctx["states"].loc[ctx["states"]["day"] == d, keep]
        pg = x_day(con, ctx["model"], st, ctx["schedule"], ctx["games"], d, actual, cfg)
        if not pg.empty:
            out.append(pg)
        echo(f"{d}: {len(pg)} player-games, X spoke to {int(pg['x_status'].sum()) if len(pg) else 0}")
    return pd.concat(out, ignore_index=True) if out else pd.DataFrame()


def day_range(d: pd.Series, days: pd.Series, cfg: Settings, seed_offset: int = 0) -> list[float]:
    """The rule's range (settings.x_forward_test.level) for the mean of paired differences `d`,
    resampling whole game days (`days`, one per row)."""
    xt = cfg.x_forward_test
    frame = pd.DataFrame({"d": d.to_numpy(float), "day": days.to_numpy()})
    by = frame.groupby("day")["d"].agg(["sum", "size"])
    sums, cnt = by["sum"].to_numpy(float), by["size"].to_numpy(float)
    rng = np.random.default_rng(xt.seed + seed_offset)
    idx = rng.integers(0, len(sums), (xt.draws, len(sums)))
    draws = sums[idx].sum(axis=1) / cnt[idx].sum(axis=1)
    tail = (1 - xt.level) / 2 * 100
    return [float(np.percentile(draws, tail)), float(np.percentile(draws, 100 - tail))]


def x_verdict(brier_range: list[float], points_range: list[float]) -> str:
    """The rule's outcome (with X minus without X; negative is better with X). Worse with X, either
    range entirely above zero: switch_off. Else the primary met (the P(plays) Brier range entirely
    below zero; the guard holds, since its range is not above zero): pass. Else: demote."""
    if brier_range[0] > 0 or points_range[0] > 0:
        return "switch_off"
    if brier_range[1] < 0:
        return "pass"
    return "demote"


def summarize_x(pg: pd.DataFrame, cfg: Settings) -> dict:
    """The rule's numbers from paired player-games (run_x). Primary: the P(plays) Brier on the
    player-games where X gave a status, with X minus without. Guard: the points average miss on
    every graded player-game, with X minus without (X moves teammates' minutes too); the same on
    X's player-games is shown for reading, not judged."""
    if pg.empty:
        return {"player_games": 0, "verdict": None, "verdict_line": "nothing graded: no finished game day"}
    xs = pg[pg["x_status"].astype(bool)]

    def brier(f: pd.DataFrame, a: str) -> pd.Series:
        return (f[f"p_{a}"] - f["did_play"].astype(float)) ** 2

    def miss(f: pd.DataFrame, a: str) -> pd.Series:
        return (f[f"pts_{a}"] - f["y_pts"]).abs()

    d_pts = miss(pg, "with_x") - miss(pg, "without_x")
    r_pts = day_range(d_pts, pg["day"], cfg, seed_offset=1)
    out = {
        "game_days": int(pg["day"].nunique()),
        "player_games": int(len(pg)),
        "x_player_games": int(len(xs)),
        "x_carried_only": int(xs["x_carried"].sum()),
        "decided_by_x": int(pg["source_with_x"].fillna("").str.startswith("X @").sum()),
        "guard": {
            "points_miss_with_x": float(miss(pg, "with_x").mean()),
            "points_miss_without_x": float(miss(pg, "without_x").mean()),
            "diff": float(d_pts.mean()),
            "range": r_pts,
            "met": not r_pts[0] > 0,
        },
    }
    if xs.empty:
        out |= {"primary": None, "verdict": None,
                "verdict_line": "X gave no status known by a decision time: no verdict"}
        return out
    d_b = brier(xs, "with_x") - brier(xs, "without_x")
    r_b = day_range(d_b, xs["day"], cfg)
    v = x_verdict(r_b, r_pts)
    out["guard"]["on_x_player_games"] = {
        "points_miss_with_x": float(miss(xs, "with_x").mean()),
        "points_miss_without_x": float(miss(xs, "without_x").mean()),
    }
    out |= {
        "primary": {
            "brier_with_x": float(brier(xs, "with_x").mean()),
            "brier_without_x": float(brier(xs, "without_x").mean()),
            "diff": float(d_b.mean()),
            "range": r_b,
            "met": r_b[1] < 0,
        },
        "verdict": v,
        "verdict_line": X_VERDICTS[v],
    }
    return out


def finished_days(games: pd.DataFrame, season: int, through: date) -> list[date]:
    """`season`'s regular-season game days up to `through` whose games are all final."""
    g = games[(games["season"] == season) & ~games["postseason"].fillna(False).astype(bool)]
    g = g[~g["postponed"].fillna(False).astype(bool)]
    g = g.assign(date=pd.to_datetime(g["game_date"]).dt.date, final=g["status_state"].fillna("") == "final")
    done = g[g["date"] <= through].groupby("date")["final"].all()
    return sorted(done[done].index)


def x_statuses_tied(con, game_ids) -> int:
    """X statuses tied to one of `game_ids` (x_feed.target_games; held-for-review ones never are)."""
    have = {
        r[0]
        for r in con.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'status_events'"
        ).fetchall()
    }
    if not {"game_id", "game_basis"} <= have:   # a store written before statuses were tied to games
        return 0
    ev = con.execute("""
        SELECT game_id FROM status_events
        WHERE game_id IS NOT NULL AND player_id IS NOT NULL
          AND coalesce(game_basis, '') NOT IN ('unmatched', 'team_conflict')
    """).df()
    return int(ev["game_id"].isin(set(game_ids)).sum())


def x_forward_test(
    con,
    cfg: Settings | None = None,
    through: date | None = None,
    season: int | None = None,
    force: bool = False,
    echo=print,
) -> tuple[pd.DataFrame, dict]:
    """The X forward test on `season`'s finished game days through `through` (default: this
    season, through yesterday Eastern). Without enough data (settings.x_forward_test: the game days
    span `min_weeks` and hold `min_statuses` X statuses tied to a game) it says so and replays
    nothing; `force` replays anyway, and still gives no verdict."""
    cfg = cfg or settings()
    xt = cfg.x_forward_test
    season = season or cfg.season.nba_season
    through = through or (pd.Timestamp.now(tz=matchup.ET).date() - timedelta(days=1))
    games = con.execute("""
        SELECT game_id, season, game_date, tip_utc, home_team_id, visitor_team_id, postseason, postponed,
               status_state FROM games
    """).df()
    days = finished_days(games, season, through)
    span = (days[-1] - days[0]).days + 1 if days else 0
    on_days = games.loc[pd.to_datetime(games["game_date"]).dt.date.isin(set(days)), "game_id"]
    tied = x_statuses_tied(con, on_days)
    need_days = 7 * xt.min_weeks
    enough = span >= need_days and tied >= xt.min_statuses
    summary: dict = {
        "season": season,
        "through": str(through),
        "game_days": len(days),
        "first_day": str(days[0]) if days else None,
        "last_day": str(days[-1]) if days else None,
        "span_days": span,
        "x_statuses_tied": tied,
        "needs": {"span_days": need_days, "x_statuses_tied": xt.min_statuses},
        "enough_data": enough,
    }
    short = (
        f"not enough data yet: {tied} X statuses tied to a game (needs {xt.min_statuses}) over "
        f"{span} days of finished games (needs {need_days}); no verdict"
    )
    if not enough and not (force and days):
        return pd.DataFrame(), summary | {"verdict": None, "verdict_line": short}
    seasons = sorted({*cfg.bdl.backfill_seasons, season})
    logs, team_ctx = features.load_logs(con, seasons), features.team_context(con, seasons)
    rosters = {
        int(p): int(t)
        for p, t in con.execute("SELECT player_id, team_id FROM players WHERE team_id IS NOT NULL").fetchall()
    }
    t0 = time.perf_counter()
    pg = run_x(con, logs, team_ctx, games, rosters, days, cfg, season, echo)
    echo(f"X forward test: {len(pg)} player-games in {time.perf_counter() - t0:.0f}s")
    res = summary | summarize_x(pg, cfg)
    if not enough:
        res |= {"verdict": None, "verdict_line": short + " (replayed anyway: numbers only)"}
    return pg, res

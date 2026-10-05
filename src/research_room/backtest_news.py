"""News backtest: replay a past season day by day, as the live app runs on game days.

Inputs: game logs and team context (features.py), the season's games (with tip times), player
positions, the NBA injury reports stored for that season (`make report-backfill`), the baseline
model (with and without teammates out) and the simulator calibration, fitted on earlier seasons.
Outputs: one row per sampled team-week and version: P(win week) at the start of each day, and
the categories and week each version's lineups actually won. A summary by version and day.
Tables: reads nba_report_rows, nba_report_teams (the rest comes in as frames).

The weekly backtest (backtest.py) projects once, on Monday, with no game-day news, and sets
lineups from who actually played. The live app instead re-projects each morning and sets each
day's lineup from that day's projections. This replays that, for the same simulated league
(backtest.draft_league), in five versions:
- monday: Monday's projections all week (no news), lineups from them.
- daily: re-projected each day from every player's state that morning, no news.
- daily_news: as daily, plus the NBA injury report published before each game (the latest at
  least 30 minutes before tip): listed statuses at the calibrated P(plays), and for a team that
  has filed, a rotation player not listed plays by his recent play rate (overrides.fill_unlisted;
  "not listed" uses that season's rosters, not today's). Teammates out on.
- daily_news_no_tmo: daily_news with teammates out switched off.
- hindsight: lineups set from who actually played (perfect news), Monday's projections.
P(win week) at day k: the real totals of that version's starters on days before k, plus that
version's day-k projections for the rest of the week, for both sides (both managers equally
informed). Rosters are as drafted (no adds), so lineups and news are the only levers.
"""

from __future__ import annotations

import time
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd

from research_room import backtest, calibration, features, matchup, overrides
from research_room.config import Settings, settings
from research_room.projections.baseline import STATS, BaselineModel

VERSIONS = ("monday", "daily", "daily_news", "daily_news_no_tmo", "hindsight")


def _cut(day: date) -> pd.Timestamp:
    return pd.Timestamp(datetime.combine(day, datetime.min.time()), tz=matchup.ET).tz_convert("UTC")


def report_news(con, games: pd.DataFrame, cfg: Settings) -> tuple[pd.DataFrame, set[tuple[int, int]]]:
    """Per game, the latest stored report at least 30 minutes before tip: listed players
    (game_id, player_id, status, p) and the (game_id, team_id) pairs that had filed."""
    teams = con.execute("SELECT report_ts, game_id, team_id, submitted FROM nba_report_teams").df()
    rows = con.execute("SELECT report_ts, game_id, player_id, status FROM nba_report_rows").df()
    if teams.empty:
        return pd.DataFrame(columns=["game_id", "player_id", "status", "p"]), set()
    tips = games.set_index("game_id")["tip_utc"]
    teams["deadline"] = teams["game_id"].map(tips) - pd.Timedelta(minutes=30)
    ok = teams[pd.to_datetime(teams["report_ts"], utc=True) <= pd.to_datetime(teams["deadline"], utc=True)]
    pick = ok.groupby("game_id")["report_ts"].max().rename("pick").reset_index()
    filed = ok.merge(pick, on="game_id")
    filed = filed[(filed["report_ts"] == filed["pick"]) & filed["submitted"]]
    listed = rows.merge(pick, on="game_id")
    listed = listed[listed["report_ts"] == listed["pick"]]
    probs = {k.lower(): v for k, v in cfg.overrides.status_play_prob.items()}
    listed = listed.assign(p=listed["status"].str.lower().map(probs))[["game_id", "player_id", "status", "p"]]
    return listed, {(int(g), int(t)) for g, t in zip(filed["game_id"], filed["team_id"], strict=True)}


def project(model: BaselineModel, states: pd.DataFrame, schedule: pd.DataFrame, days: list[date],
            news: tuple[pd.DataFrame, set] | None, news_day: date | None, cfg: Settings) -> pd.DataFrame:
    """Long projection rows for `days` from `states` (one row per player), with the report news
    applied to `news_day`'s games when given."""
    rows = schedule[schedule["date"].isin(days)].merge(states, on="team_id")
    if rows.empty:
        return pd.DataFrame(columns=["player_id", "date", "stat", "mean", "sd"])
    rows = rows.assign(play_prob=rows["play_rate_ewma"], season_games=10_000)
    if news is not None and news_day is not None:
        listed, filed = news
        today = rows["date"] == news_day
        lk = listed.set_index(["game_id", "player_id"])["p"]
        key = pd.MultiIndex.from_frame(rows[["game_id", "player_id"]].astype(int))
        p = pd.Series(lk.reindex(key).to_numpy(), index=rows.index).where(today)
        is_filed = pd.Series([(int(g), int(t)) in filed for g, t in zip(rows["game_id"], rows["team_id"],
                                                                           strict=True)], index=rows.index)
        rows["status_override"] = np.where(today & p.isna() & is_filed, overrides.NOT_LISTED, None)
        rows["play_prob_override"] = p.fillna(overrides.fill_unlisted(rows, cfg))
    pred = model.predict(rows)
    pred["date"] = pd.to_datetime(pred["date"]).dt.date
    return pred[["player_id", "date", "stat", "mean", "sd"]]


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


def run(con, logs: pd.DataFrame, team_ctx: pd.DataFrame, games: pd.DataFrame,
        positions: dict[int, str | None], names: dict[int, str], cfg: Settings | None = None,
        test_season: int | None = None, echo=print) -> pd.DataFrame:
    cfg = cfg or settings()
    bt = cfg.backtest
    off = cfg.model_copy(update={"baseline": cfg.baseline.model_copy(
        update={"teammates": cfg.baseline.teammates.model_copy(update={"enabled": False})})})
    built = features.build(logs, team_ctx, cfg)
    test_season = test_season or int(built.loc[built["min_played_ewma"].notna(), "season"].max())
    train = built[(built["season"] < test_season) & built["min_played_ewma"].notna()]
    model, model_off = BaselineModel(cfg).fit(train), BaselineModel(off).fit(train)
    season_sched = backtest.team_schedule(games).merge(games[["game_id", "season"]], on="game_id")
    cal = calibration.calibrate(built[built["min_played_ewma"].notna()], cfg, test_season,
                                schedule=season_sched)
    var_mult = dict(zip(cal["category"], cal["multiplier"], strict=True))
    corr = cal.attrs["corr"].to_numpy(float)
    actual = backtest.actuals(built[built["season"] == test_season])
    sg = games[games["season"] == test_season]
    schedule = backtest.team_schedule(sg)
    news = report_news(con, sg, cfg)
    all_days = sorted(schedule["date"].unique())
    monday = all_days[0] - timedelta(days=all_days[0].weekday()) + timedelta(days=7)
    season_built = built[built["season"] == test_season]
    states_all = features.monday_states(season_built, [_cut(d) for d in all_days])
    states_all["day"] = states_all["monday"].dt.tz_convert(matchup.ET).dt.date
    keep = ["player_id", "team_id", *features.STATE_COLUMNS]
    rng = np.random.default_rng(bt.seed)
    out, league, elig = [], None, {}
    for w in range(bt.max_weeks):
        start = monday + timedelta(days=7 * w)
        days = [start + timedelta(days=i) for i in range(7) if start + timedelta(days=i) in set(all_days)]
        if not days:
            break
        st = {d: states_all.loc[states_all["day"] == d, keep] for d in days}
        mon = project(model, st[days[0]], schedule, days, None, None, cfg)
        for pid in mon["player_id"].unique():
            elig.setdefault(int(pid), backtest.eligibility(positions.get(int(pid))))
        if league is None:
            league = backtest.draft_league(backtest.season_values(mon, days, cfg), bt.teams, bt.roster_size)
        # Projections made on each day k for days k.., per version.
        same = {k: mon for k in range(len(days))}
        made = {"monday": same, "hindsight": same}
        for v, m, with_news in (("daily", model, False), ("daily_news", model, True),
                                ("daily_news_no_tmo", model_off, True)):
            made[v] = {k: project(m, st[d], schedule, days[k:], news if with_news else None, d, cfg)
                       for k, d in enumerate(days)}
        # The lineup each version sets on day k comes from its day-k projections.
        decide = {v: pd.concat([p[k][p[k]["date"] == d] for k, d in enumerate(days)])
                  for v, p in made.items()}
        aw = actual[actual["date"].isin(days)]
        suited = aw.loc[aw["y_did_play"].astype(bool), ["player_id", "date"]].drop_duplicates()
        decide["hindsight"] = mon.merge(suited, on=["player_id", "date"])
        pairs = backtest.round_robin(bt.teams, w)
        for idx in rng.choice(len(pairs), size=min(bt.matchups_per_week, len(pairs)), replace=False):
            a, b = pairs[int(idx)]
            me_r = backtest.roster_frame(league[a], elig, names)
            opp_r = backtest.roster_frame(league[b], elig, names)
            for v in VERSIONS:
                me_td = matchup.team_days(me_r, decide[v], days, cfg)
                opp_td = matchup.team_days(opp_r, decide[v], days, cfg)
                me_act = backtest.actual_totals(me_td, aw, cfg)
                opp_act = backtest.actual_totals(opp_td, aw, cfg)
                cats = backtest.categories_won(me_act, opp_act, cfg)
                cats_opp = backtest.categories_won(opp_act, me_act, cfg)
                row = {"season": test_season, "week_start": start, "team": a + 1, "opponent": b + 1,
                       "version": v, "days": len(days), "cats": cats, "cats_opp": cats_opp,
                       "won": cats > cats_opp, "tie": cats == cats_opp}
                for k in range(len(days)):
                    rem = made[v][k]
                    m_now = matchup.matchup_now(
                        matchup.team_days(me_r, rem, days[k:], cfg),
                        matchup.team_days(opp_r, rem, days[k:], cfg),
                        done_totals(me_td, k, aw, cfg), done_totals(opp_td, k, aw, cfg), var_mult, cfg, corr)
                    row[f"p{k}"] = m_now.p_win_week
                out.append(row)
        echo(f"week of {start}: {len(out) // len(VERSIONS)} team-weeks so far")
    return pd.DataFrame(out)


def summarize(res: pd.DataFrame) -> dict:
    """By version: weekly-odds Brier at the start of each day and pooled, and the pooled Brier
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


def run_from_store(con, cfg: Settings | None = None, echo=print) -> tuple[pd.DataFrame, dict]:
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
    res = run(con, logs, team_ctx, games, positions, names, cfg, echo=echo)
    echo(f"news backtest: {len(res)} rows in {time.perf_counter() - t0:.0f}s")
    return res, summarize(res)

"""Weekly head-to-head matchup engine: my team vs this week's opponent.

Inputs: both teams' latest Yahoo rosters (yahoo_rosters), this week's opponent and live
week-to-date totals (yahoo_matchups), the latest baseline projections per player per game day
(projections: mean and sd per stat, already including P(plays)), box scores for attempts so far
(game_logs), the calibrated team-week variance multipliers (calibration.py), settings.
Outputs: `MatchupNow` (P(win each category), expected categories, P(win week), projected final
totals with sd) and a "do nothing" path: P(win week) at the end of each remaining day with its
80% band. Tables: reads the above; `snapshot()` writes matchup_snapshots.

Model:
- Counted games. Each remaining day, each team's lineup comes from lineup.assign_day (10 active
  slots, eligibility, IL), valued like the daily lineup tool. Only starters with a game count, so
  a 12-game day on a 10-slot roster counts 10. The opponent is assumed to set its best lineup.
- A counted game adds the player's projected mean and variance (sd^2) per stat; percentages add
  makes, attempts and the binomial term, as in simulate.contributions.
- Week total = live Yahoo total so far + projected remaining days. Yahoo gives FG%/FT% as ratios
  only, so attempts so far are estimated from box scores of each roster's active players and
  makes = Yahoo % x those attempts (the ratio then matches Yahoo exactly); this is flagged in
  `missing`.
- P(win category) = simulate.analytic with the calibrated multipliers, applied to the remaining
  variance only (what has happened has no spread). P(win week) draws the nine category edges
  together with the calibrated correlation (simulate.p_win_week_correlated).
- Path: Monte Carlo draws of each remaining day (normal per category, same variances). At the end
  of each day the engine computes P(win week) given that draw; the path's point is the mean of those
  (it stays near today's value: nothing is expected to change by itself) and lo/hi are the 10th and
  90th percentiles: how far the week could swing by then.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from research_room import calibration, lineup, schedule, simulate, store
from research_room.config import Settings, settings

ET = ZoneInfo("America/New_York")
BAND = (0.10, 0.90)                     # 80% band on the path
ACTIVE_SLOTS = {"PG", "SG", "G", "SF", "PF", "F", "C", "Util", "UTIL"}


# ------------------------------------------------------------------ team days (pure)

@dataclass
class TeamDays:
    """Per remaining day: summed projected contributions of the players who count."""
    days: list[date]
    mean: dict[str, np.ndarray]          # counting categories, shape (days,)
    var: dict[str, np.ndarray]
    made: dict[str, np.ndarray]          # percentage categories
    att: dict[str, np.ndarray]
    bin_var: dict[str, np.ndarray]
    scheduled: list[int] = field(default_factory=list)   # roster players with a game
    counted: list[int] = field(default_factory=list)     # of those, in an active slot
    starters: list[list[int]] = field(default_factory=list)


@dataclass
class ToDate:
    """Live week-to-date totals for one side (zeros before the week's first game)."""
    total: dict[str, float]              # counting categories
    made: dict[str, float]               # percentage categories (estimated, see module doc)
    att: dict[str, float]


def zero_to_date(cfg: Settings) -> ToDate:
    pct = [c.key for c in cfg.categories if c.kind == "pct"]
    cnt = [c.key for c in cfg.categories if c.kind != "pct"]
    return ToDate({k: 0.0 for k in cnt}, {k: 0.0 for k in pct}, {k: 0.0 for k in pct})


def _wide(proj: pd.DataFrame, day: date, value: str) -> pd.DataFrame:
    d = proj[proj["date"] == day]
    return d.pivot_table(index="player_id", columns="stat", values=value, aggfunc="sum").fillna(0.0) \
        if not d.empty else pd.DataFrame()


def team_days(roster: pd.DataFrame | list[pd.DataFrame], proj: pd.DataFrame, days: list[date],
              cfg: Settings | None = None) -> TeamDays:
    """`roster`: player_id, name, eligible (list), status, current_slot; or one such frame per day
    (a roster that changes mid-week with adds and drops). `proj`: long rows player_id, date, stat,
    mean, sd for every projected player (the day's pool sets the lineup weights). A player has a
    game on a day when he has projection rows that day."""
    cfg = cfg or settings()
    cats = cfg.categories
    out = {k: {c.key: np.zeros(len(days)) for c in cats} for k in ("mean", "var", "made", "att", "bin_var")}
    scheduled, counted, starters_by_day = [], [], []
    by_day = roster if isinstance(roster, list) else [roster] * len(days)
    for i, day in enumerate(days):
        roster = by_day[i]
        ids = roster["player_id"].astype(int).tolist()
        mean_day, sd_day = _wide(proj, day, "mean"), _wide(proj, day, "sd")
        if mean_day.empty:
            scheduled.append(0), counted.append(0), starters_by_day.append([])
            continue
        has_game = pd.Series({p: p in mean_day.index for p in ids})
        weights = lineup.category_weights(mean_day, cfg)
        values = lineup.player_value(mean_day.reindex(ids).fillna(0.0), weights,
                                     lineup.league_pct(mean_day, cfg), cfg)
        res = lineup.assign_day(roster, values, has_game, cfg=cfg)
        starting = [p for p in res.starters.values() if p is not None and bool(has_game.get(p, False))]
        scheduled.append(int(has_game.sum())), counted.append(len(starting)), starters_by_day.append(starting)
        if not starting:
            continue
        m, s = mean_day.reindex(starting).fillna(0.0), sd_day.reindex(starting).fillna(0.0)
        for c in cats:
            if c.kind == "pct":
                made, att = m[c.made], m[c.attempts]
                p = (made / att.where(att > 0, 1.0)).where(att > 0, 0.0)
                out["made"][c.key][i] = made.sum()
                out["att"][c.key][i] = att.sum()
                out["bin_var"][c.key][i] = (att * p * (1 - p)).sum()
            else:
                out["mean"][c.key][i] = m[c.key].sum()
                out["var"][c.key][i] = (s[c.key] ** 2).sum()
    pick = lambda k, kind: {c.key: out[k][c.key] for c in cats if (c.kind == "pct") == (kind == "pct")}  # noqa: E731
    return TeamDays(days, pick("mean", "count"), pick("var", "count"), pick("made", "pct"),
                    pick("att", "pct"), pick("bin_var", "pct"), scheduled, counted, starters_by_day)


# ------------------------------------------------------------------ matchup (pure)

def _team(td: TeamDays, done: ToDate, from_day: int, realized: dict | None = None) -> simulate.TeamWeek:
    """TeamWeek for: to-date totals + (realized draws through day from_day-1) + days from_day on."""
    rem = slice(from_day, None)
    real = realized or {}
    return simulate.TeamWeek(
        {k: done.total[k] + real.get(("mean", k), 0.0) + v[rem].sum() for k, v in td.mean.items()},
        {k: v[rem].sum() for k, v in td.var.items()},                  # what happened has no spread
        {k: done.made[k] + real.get(("made", k), 0.0) + v[rem].sum() for k, v in td.made.items()},
        {k: done.att[k] + td.att[k].sum() for k in td.att},
        {k: v[rem].sum() for k, v in td.bin_var.items()},
    )


@dataclass
class MatchupNow:
    p_cat: dict[str, float]
    expected_cats: float
    p_win_week: float
    final_me: dict[str, tuple[float, float]]      # category -> (projected final, sd)
    final_opp: dict[str, tuple[float, float]]


def matchup_now(me: TeamDays, opp: TeamDays, me_done: ToDate, opp_done: ToDate,
                var_mult: dict[str, float] | None = None, cfg: Settings | None = None,
                corr: np.ndarray | None = None) -> MatchupNow:
    cfg = cfg or settings()
    a, b = _team(me, me_done, 0), _team(opp, opp_done, 0)
    m = simulate.analytic(a, b, cfg, var_mult)
    k = var_mult or {}

    def finals(t: simulate.TeamWeek) -> dict:
        out = {}
        for c in cfg.categories:
            if c.kind == "pct":
                att = float(t.att[c.key])
                val = float(t.made[c.key]) / att if att > 0 else None
                sd = float(np.sqrt(t.bin_var[c.key] * k.get(c.key, 1.0))) / att if att > 0 else None
            else:
                val, sd = float(t.mean[c.key]), float(np.sqrt(t.var[c.key] * k.get(c.key, 1.0)))
            out[c.key] = (val, sd)
        return out

    s = m.summary()
    p_week = s["p_win_week"]
    if corr is not None:
        z = simulate.correlated_draws(corr, cfg.simulation.week_draws, cfg.simulation.seed)
        p_week = float(simulate.p_win_week_correlated(a, b, z, cfg, var_mult)[0])
    return MatchupNow(s["p_cat"], s["expected_cats"], p_week, finals(a), finals(b))


@dataclass
class PathPoint:
    day: date
    p_win_week: float
    lo: float
    hi: float
    expected_cats: float
    p_cats: dict[str, float]


def do_nothing_path(me: TeamDays, opp: TeamDays, me_done: ToDate, opp_done: ToDate,
                    var_mult: dict[str, float] | None = None, cfg: Settings | None = None,
                    draws: int | None = None, seed: int = 0,
                    corr: np.ndarray | None = None) -> list[PathPoint]:
    """P(win week) at the end of each remaining day if nothing changes, with an 80% band."""
    cfg = cfg or settings()
    n = draws or cfg.simulation.path_draws
    sim = cfg.simulation
    z = simulate.correlated_draws(corr, sim.week_draws, sim.seed) if corr is not None else None
    k = var_mult or {}
    rng = np.random.default_rng(seed)
    days = me.days
    # Daily draws, shape (n, days), per side and category.
    sims = {}
    for side, td in (("me", me), ("opp", opp)):
        for c in cfg.categories:
            mult = k.get(c.key, 1.0)
            if c.kind == "pct":
                mu, var = td.made[c.key], td.bin_var[c.key]
                sims[(side, "made", c.key)] = mu + np.sqrt(var * mult) * rng.standard_normal((n, len(days)))
            else:
                mu, var = td.mean[c.key], td.var[c.key]
                sims[(side, "mean", c.key)] = mu + np.sqrt(var * mult) * rng.standard_normal((n, len(days)))
    points = []
    for t, day in enumerate(days):
        teams = {}
        for side, td, done in (("me", me, me_done), ("opp", opp, opp_done)):
            realized = {(kind, key): v[:, : t + 1].sum(axis=1)
                        for (s, kind, key), v in sims.items() if s == side}
            teams[side] = _team(td, done, t + 1, realized)
        m = simulate.analytic(teams["me"], teams["opp"], cfg, var_mult)
        if z is None:
            p = np.asarray(m.p_win_week, dtype=float)
        else:
            p = simulate.p_win_week_correlated(teams["me"], teams["opp"], z, cfg, var_mult)
        points.append(PathPoint(day, float(p.mean()), float(np.quantile(p, BAND[0])),
                                float(np.quantile(p, BAND[1])), float(np.mean(m.expected_cats)),
                                {c: float(np.mean(v)) for c, v in m.p_cat.items()}))
    return points


# ------------------------------------------------------------------ loading from the store

class NoMatchup(Exception):
    """An input the matchup needs is missing; the message says what to do."""


def roster_of(con, team_id: int) -> pd.DataFrame:
    df = con.execute("""
        SELECT player_id, player_name AS name, eligible_positions, status, selected_slot AS current_slot
        FROM yahoo_rosters
        WHERE team_id = ? AND snapshot_at = (SELECT max(snapshot_at) FROM yahoo_rosters WHERE team_id = ?)
          AND player_id IS NOT NULL
    """, [team_id, team_id]).df()
    df["eligible"] = df["eligible_positions"].fillna("").map(lambda s: [p for p in s.split(",") if p])
    return df.assign(player_id=lambda d: d["player_id"].astype(int))


def opponent_for(con, week: int, my_team_id: int) -> tuple[int, pd.DataFrame | None]:
    """This week's opponent from the latest matchup.csv rows, and those rows (both sides)."""
    rows = con.execute("""
        SELECT * FROM yahoo_matchups WHERE week = ?
          AND snapshot_at = (SELECT max(snapshot_at) FROM yahoo_matchups WHERE week = ?)
    """, [week, week]).df()
    mine = rows[rows["team_id"] == my_team_id]
    if mine.empty:
        raise NoMatchup(f"No week {week} matchup yet: save matchup.csv to data/inbox and run `make inbox`.")
    return int(mine["opponent_team_id"].iloc[0]), rows


def _first_tip_et(con, day: date) -> datetime | None:
    v = con.execute("SELECT min(tip_utc) FROM games WHERE game_date = ?", [day]).fetchone()[0]
    return pd.Timestamp(v).tz_convert(ET).to_pydatetime() if v is not None else None


def remaining_days(con, start: date, end: date, cats_as_of: datetime | None, now: datetime) -> list[date]:
    """Days still to project. Yahoo totals read on day D after its first tip count D as played."""
    first = max(start, now.astimezone(ET).date())
    if cats_as_of is not None:
        seen = cats_as_of.astimezone(ET)
        tip = _first_tip_et(con, seen.date())
        last_done = seen.date() if tip is not None and seen >= tip else seen.date() - timedelta(days=1)
        first = max(first, last_done + timedelta(days=1))
    return [first + timedelta(days=i) for i in range((end - first).days + 1)] if first <= end else []


def to_date(con, rows: pd.DataFrame | None, team_id: int, roster: pd.DataFrame, start: date,
            through: date | None, cfg: Settings) -> tuple[ToDate, list[dict]]:
    """Live totals for one side; FG%/FT% makes and attempts estimated (see module doc)."""
    done, missing = zero_to_date(cfg), []
    if rows is None or through is None or through < start:
        return done, missing
    r = rows[rows["team_id"] == team_id]
    if r.empty:
        return done, missing
    r = r.iloc[0]
    for k in done.total:
        done.total[k] = float(r[k]) if pd.notna(r[k]) else 0.0
    active = roster[roster["current_slot"].fillna("BN").str.split("#").str[0].isin(ACTIVE_SLOTS)]
    logs = con.execute("""SELECT sum(fga) AS fga, sum(fta) AS fta FROM game_logs
                          WHERE player_id IN (SELECT unnest(?)) AND game_date BETWEEN ? AND ?""",
                       [active["player_id"].astype(int).tolist(), start, through]).fetchone()
    for c in cfg.categories:
        if c.kind != "pct":
            continue
        att = float({"fga": logs[0], "fta": logs[1]}.get(c.attempts) or 0.0)
        done.att[c.key] = att
        done.made[c.key] = float(r[c.key]) * att if pd.notna(r[c.key]) else 0.0
    missing.append({"key": "pct_attempts", "label": "Yahoo shows FG%/FT% as ratios, not makes and attempts",
                    "effect": "Attempts so far estimated from box scores of the active players in the latest "
                              "roster.csv; the ratio matches Yahoo."})
    return done, missing


def week_inputs(con, cfg: Settings | None = None, now: datetime | None = None) -> dict:
    """Everything the endpoints need for the current week, or NoMatchup with the next step."""
    cfg = cfg or settings()
    now = (now or datetime.now(ET)).astimezone(ET)
    today = now.date()
    week_no = schedule.week_of(today, cfg.season)
    if week_no is None:
        raise NoMatchup("No fantasy week today (the season has not started or is over).")
    weeks = schedule.fantasy_weeks(cfg.season).set_index("week")
    start = pd.Timestamp(weeks.at[week_no, "start"]).date()
    end = pd.Timestamp(weeks.at[week_no, "end"]).date()
    me_id = cfg.league.my_team_id
    opp_id, rows = opponent_for(con, week_no, me_id)
    me_roster, opp_roster = roster_of(con, me_id), roster_of(con, opp_id)
    if me_roster.empty:
        raise NoMatchup("No Yahoo roster yet: save roster.csv to data/inbox and run `make inbox`.")
    if opp_roster.empty:
        raise NoMatchup(f"No roster for team {opp_id}: roster.csv must list every team's players.")
    run = con.execute("SELECT max(run_at) FROM projections WHERE model = 'baseline'").fetchone()[0]
    if run is None:
        raise NoMatchup("No projections yet: run `make nightly`.")
    cats_as_of = con.execute("SELECT max(snapshot_at) FROM yahoo_matchups WHERE week = ?",
                             [week_no]).fetchone()[0]
    cats_as_of = pd.Timestamp(cats_as_of).to_pydatetime() if cats_as_of is not None else None
    days = remaining_days(con, start, end, cats_as_of, now)
    proj = con.execute("""SELECT player_id, date, stat, mean, sd FROM projections
                          WHERE model = 'baseline' AND run_at = ? AND date BETWEEN ? AND ?""",
                       [run, days[0] if days else end, end]).df()
    proj["date"] = pd.to_datetime(proj["date"]).dt.date
    through = (days[0] - timedelta(days=1)) if days else end
    me_done, miss = to_date(con, rows, me_id, me_roster, start, through, cfg)
    opp_done, _ = to_date(con, rows, opp_id, opp_roster, start, through, cfg)
    return {"week": week_no, "start": start, "end": end, "days": days, "now": now, "run_at": run,
            "cats_as_of": cats_as_of, "me_id": me_id, "opp_id": opp_id,
            "me": team_days(me_roster, proj, days, cfg), "opp": team_days(opp_roster, proj, days, cfg),
            "me_roster": me_roster, "opp_roster": opp_roster, "proj": proj,
            "me_done": me_done, "opp_done": opp_done, "missing": miss,
            "var_mult": calibration.load_multipliers(con), "corr": calibration.load_correlation(con, cfg)}


def cats_lead(me_done: ToDate, opp_done: ToDate, cfg: Settings) -> dict[str, int]:
    """Categories each side leads on week-to-date totals (TO: fewer leads; ties lead for nobody)."""
    me = opp = 0
    for c in cfg.categories:
        if c.kind == "pct":
            a = me_done.made[c.key] / me_done.att[c.key] if me_done.att[c.key] else None
            b = opp_done.made[c.key] / opp_done.att[c.key] if opp_done.att[c.key] else None
            if a is None or b is None:
                continue
        else:
            a, b = me_done.total[c.key], opp_done.total[c.key]
        if a == b:
            continue
        better = (a > b) if c.higher_is_better else (a < b)
        me, opp = me + better, opp + (not better)
    return {"me": int(me), "opp": int(opp)}


def day_end_ts(day: date) -> str:
    """The path's point for a day sits at the end of its games (11:59 pm Eastern)."""
    return datetime.combine(day, time(23, 59), ET).isoformat()


def snapshot(con, cfg: Settings | None = None, now: datetime | None = None,
             event: tuple[str, str] = ("nightly", "Nightly run")) -> dict:
    """Store this moment's P(win week) for the chart history (matchup_snapshots)."""
    cfg = cfg or settings()
    inp = week_inputs(con, cfg, now)
    m = matchup_now(inp["me"], inp["opp"], inp["me_done"], inp["opp_done"], inp["var_mult"], cfg, inp["corr"])
    lead = cats_lead(inp["me_done"], inp["opp_done"], cfg)
    row = {"week": inp["week"], "ts": inp["now"], "opponent_team_id": inp["opp_id"],
           "p_win_week": m.p_win_week, "expected_cats": m.expected_cats, "p_cats": json.dumps(m.p_cat),
           "cats_me": lead["me"], "cats_opp": lead["opp"], "event_kind": event[0], "event_label": event[1],
           "projections_run_at": inp["run_at"]}
    store.upsert(con, "matchup_snapshots", pd.DataFrame([row]))
    return {"week": inp["week"], "p_win_week": round(m.p_win_week, 4)}

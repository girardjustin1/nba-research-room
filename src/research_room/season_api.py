"""Season responses for the front ends, shaped to web/src/api/season.ts (the contract the
Storybook screens were designed against). Phase 1 implements GET /season/lineup.

Inputs: my Yahoo roster (latest snapshot), the latest baseline projections, overrides, the schedule,
settings. Outputs: plain dicts matching the TypeScript types (LineupResponse, ...).
Tables: reads yahoo_rosters, projections, games, teams, players, injuries, status_events.

Honesty rules from the contract: every response carries `as_of`, `stale` and `provenance`;
a number the engine cannot produce yet is null (e.g. delta_p_win until the Phase 2 weekly
optimizer), never a made-up default.
"""

from __future__ import annotations

import json
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import duckdb
import pandas as pd

from research_room import images, lineup, matchup, overrides, schedule
from research_room.config import Settings, settings
from research_room.draft import tracker
from research_room.pipeline import my_roster

ET = ZoneInfo("America/New_York")
STALE_AFTER = timedelta(hours=30)        # nightly runs at 18:30; a missed night makes it stale
STATUS_CODES = {"out": ("out", "O"), "out for season": ("out", "O"), "doubtful": ("doubtful", "D"),
                "questionable": ("questionable", "Q"), "day-to-day": ("day_to_day", "DTD"),
                "probable": ("probable", "P")}


class NotReady(Exception):
    """The engine lacks an input the response needs; the message says what to do."""


def _iso(ts) -> str | None:
    if ts is None or (isinstance(ts, float) and pd.isna(ts)) or ts is pd.NaT:
        return None
    return pd.Timestamp(ts).tz_convert(ET).isoformat() if pd.Timestamp(ts).tzinfo else \
        pd.Timestamp(ts).tz_localize("UTC").tz_convert(ET).isoformat()


def week_context(day: date, cfg: Settings, punts: list[str] | None = None) -> dict:
    weeks = schedule.fantasy_weeks(cfg.season)
    hit = weeks[(weeks["start"] <= day) & (weeks["end"] >= day)]
    w = hit.iloc[0] if not hit.empty else weeks.iloc[0]
    days_left = (w["end"] - day).days + 1
    rounds = {cfg.season.playoff_weeks[i]: r for i, r in enumerate(["quarterfinal", "semifinal", "final"])
              if i < len(cfg.season.playoff_weeks)}
    return {"week": int(w["week"]), "label": f"Week {int(w['week'])}", "start": str(w["start"]),
            "end": str(w["end"]), "today": str(day), "days_left": int(days_left),
            "is_last_day": days_left == 1, "is_playoffs": bool(w["is_playoff"]),
            "playoff_round": rounds.get(int(w["week"])), "punts": punts or [],
            "categories": [{"key": c.key, "label": c.label, "higher_is_better": c.higher_is_better,
                            "is_ratio": c.kind == "pct"} for c in cfg.categories],
            "cats_to_win": len(cfg.categories) // 2 + 1}


def _player_refs(con, roster: pd.DataFrame, status_by_pid: dict, now: datetime) -> dict[int, dict]:
    info = con.execute("""SELECT p.player_id, t.abbreviation AS team_abbr
                          FROM players p LEFT JOIN teams t USING (team_id)""").df().set_index("player_id")
    refs = {}
    for r in roster.itertuples(index=False):
        pid = int(r.player_id)
        abbr = info["team_abbr"].get(pid)
        abbr = abbr if isinstance(abbr, str) else None
        eligible = list(dict.fromkeys([*r.eligible, "Util"])) if r.eligible else ["Util"]
        refs[pid] = {
            "player_id": pid, "name": r.name, "team_abbr": abbr, "eligible": eligible,
            "headshot_url": (f"/images/players/{pid}.png" if images.player_path(pid).exists() else None),
            "team_logo_url": (f"/images/teams/{abbr}.svg"
                              if abbr and images.team_path(abbr).exists() else None),
            "owner": "mine", "status": status_by_pid.get(pid) or {
                "code": "healthy", "label": "", "play_prob": None, "minutes_cap": None, "note": None,
                "source": None, "as_of": now.isoformat()},
            "pct_rostered": None}
    return refs


def _status(row: pd.Series, now: datetime) -> dict:
    code, label = STATUS_CODES.get(str(row["status"] or "").lower(), ("healthy", ""))
    kind = {"bdl": "bdl", "manual": "manual", "nba_report": "nba_report"}.get(row["authority"], "x")
    tiers = ("official", "insider", "beat", "aggregator")

    def num(v):
        return None if pd.isna(v) else float(v)
    return {"code": code, "label": label, "play_prob": num(row["play_prob"]),
            "minutes_cap": num(row["minutes_cap"]), "note": row["note"] or None,
            "source": {"kind": kind, "handle": None, "display_name": row["source"],
                       "tier": row["authority"] if row["authority"] in tiers else None},
            "as_of": _iso(row["ts"]) or now.isoformat()}


def _games(con, start: date, end: date, cfg: Settings) -> pd.DataFrame:
    """Per team-game rows in [start, end]: game_id, date, tip, opponent, home, back-to-back."""
    all_games = schedule.load_games(con, cfg.season.nba_season)
    b2b = schedule.flag_back_to_backs(schedule.team_games(all_games)).set_index(["game_id", "team_id"])["b2b"]
    days = pd.to_datetime(all_games["game_date"]).dt.date
    g = all_games[(days >= start) & (days <= end)]
    abbr = dict(con.execute("SELECT team_id, abbreviation FROM teams").fetchall())
    rows = []
    for x in g.itertuples(index=False):
        sides = ((x.home_team_id, x.visitor_team_id, True), (x.visitor_team_id, x.home_team_id, False))
        for team, opp, home in sides:
            rows.append({"team_id": int(team), "game_id": int(x.game_id),
                         "date": pd.Timestamp(x.game_date).date(), "tip_at": _iso(x.tip_utc),
                         "tip_utc": x.tip_utc, "opp_abbr": abbr.get(opp), "home": home,
                         "b2b": bool(b2b.get((x.game_id, team), False))})
    return pd.DataFrame(rows)


def lineup_response(con: duckdb.DuckDBPyConnection, cfg: Settings | None = None,
                    now: datetime | None = None) -> dict:
    """LineupResponse: today first, then the rest of the fantasy week."""
    cfg = cfg or settings()
    now = (now or datetime.now(ET)).astimezone(ET)
    today = now.date()
    roster = my_roster(con, cfg)
    if roster.empty:
        raise NotReady("No roster yet: enter it on Team → My roster (or sign in to Yahoo).")
    roster = roster.dropna(subset=["player_id"]).assign(player_id=lambda d: d["player_id"].astype(int))
    run = con.execute("SELECT max(run_at) FROM projections WHERE model = 'baseline'").fetchone()[0]
    if run is None:
        raise NotReady("No projections yet: run `make nightly`.")
    wk = week_context(today, cfg)
    end = pd.Timestamp(wk["end"]).date()
    proj = con.execute("""SELECT player_id, date, stat, mean FROM projections
                          WHERE model = 'baseline' AND run_at = ? AND date BETWEEN ? AND ?""",
                       [run, today, end]).df()
    proj["date"] = pd.to_datetime(proj["date"]).dt.date
    ov = overrides.resolve(con, today, end, cfg=cfg)
    status_by_pid = {int(r.player_id): _status(pd.Series(r._asdict()), now)
                     for r in ov.sort_values("date").drop_duplicates("player_id").itertuples(index=False)}
    refs = _player_refs(con, roster, status_by_pid, now)
    team_of = con.execute("SELECT player_id, team_id FROM players").df().set_index("player_id")["team_id"]
    games = _games(con, today, end, cfg)
    snapshot = con.execute("SELECT max(snapshot_at) FROM yahoo_rosters WHERE team_id = ?",
                           [cfg.league.my_team_id]).fetchone()[0]

    t0 = time.perf_counter()
    days, statuses = [], []
    for i in range((end - today).days + 1):
        day = today + timedelta(days=i)
        pool_day = lineup.wide_day(proj, day)
        mine_games = {}
        if not games.empty:
            todays = games[games["date"] == day].set_index("team_id")
            for pid in roster["player_id"]:
                t = team_of.get(pid)
                if t in todays.index:
                    mine_games[pid] = todays.loc[t]
        if pool_day.empty:
            values = pd.Series(0.0, index=roster["player_id"])
        else:
            weights = lineup.category_weights(pool_day, cfg)
            values = lineup.player_value(pool_day.reindex(roster["player_id"]).fillna(0.0), weights,
                                         lineup.league_pct(pool_day, cfg), cfg)
        has_game = pd.Series({p: p in mine_games for p in roster["player_id"]})
        locked = {}
        if day == today:
            current = _current_slots(roster)
            for pid, g in mine_games.items():
                if g["tip_utc"] is not None and pd.Timestamp(g["tip_utc"]) <= pd.Timestamp(now) \
                        and current.get(pid) not in (None, "BN", "IL"):
                    locked[pid] = current[pid]
        res = lineup.assign_day(roster, values, has_game, locked=locked, cfg=cfg)
        statuses.append((res.status, res.reason))
        days.append(_day_json(day, today, roster, res, refs, mine_games, locked))
    solve_ms = round(1000 * (time.perf_counter() - t0), 1)
    bad = [r for s, r in statuses if s != "optimal"]
    run_iso = _iso(run)
    stale = (pd.Timestamp(now) - pd.Timestamp(run)) > STALE_AFTER
    return {
        "as_of": run_iso, "stale": bool(stale),
        "stale_reason": f"Projections are from {run_iso}; the nightly run is overdue." if stale else None,
        "provenance": [
            {"module": "projections", "as_of": run_iso, "run_id": None,
             "note": "baseline: EWMA per-minute rates x minutes x P(plays)"},
            {"module": "overrides", "as_of": now.isoformat(), "run_id": None,
             "note": "injuries + X events + overrides.yaml"},
            {"module": "yahoo", "as_of": _iso(snapshot), "run_id": None, "note": "roster.csv snapshot"},
        ],
        "week": wk, "days": days, "roster": list(refs.values()),
        "optimizer": {"status": "optimal" if not bad else "infeasible",
                      "message": ("Phase 1: maximises category-weighted projected value per day; the "
                                  "P(win week) objective arrives with the weekly optimizer (Phase 2).")
                      if not bad else "; ".join(r for r in bad if r),
                      "solved_at": now.isoformat(), "solve_ms": solve_ms,
                      "horizon": [d["date"] for d in days], "objective": "p_win_week"},
    }


def _current_slots(roster: pd.DataFrame) -> dict[int, str]:
    """Yahoo current slots as labels with duplicates numbered in roster order (C#1, C#2)."""
    counts: dict[str, int] = {}
    out = {}
    dup = {"C", "Util"}
    for r in roster.itertuples(index=False):
        s = str(r.current_slot or "BN")
        s = "Util" if s.upper() == "UTIL" else s
        if s in dup:
            counts[s] = counts.get(s, 0) + 1
            s = f"{s}#{counts[s]}"
        out[int(r.player_id)] = s
    return out


def _assignment(slot: str, pid: int | None, refs: dict, mine_games: dict, locked: dict) -> dict:
    g = mine_games.get(pid) if pid is not None else None
    return {"slot": slot.split("#")[0], "player": refs.get(pid) if pid is not None else None,
            "game": None if g is None else {"game_id": int(g["game_id"]), "date": str(g["date"]),
                                            "tip_at": g["tip_at"], "opp_abbr": g["opp_abbr"],
                                            "home": bool(g["home"]), "b2b": bool(g["b2b"])},
            "locked": pid in locked}


def _day_json(day: date, today: date, roster: pd.DataFrame, res: lineup.DayLineup, refs: dict,
              mine_games: dict, locked: dict) -> dict:
    current = _current_slots(roster)
    by_slot_current = {s: p for p, s in current.items()}
    reasons = {c["player_id"]: c for c in res.changes}
    slots = []
    for label, opt_pid in res.starters.items():
        cur_pid = by_slot_current.get(label)
        changed = cur_pid != opt_pid
        why = reasons.get(opt_pid) or reasons.get(cur_pid)
        tags = []
        if changed and cur_pid is not None and cur_pid not in mine_games:
            tags.append("games")
        if changed and opt_pid in mine_games:
            tags.append("games")
        if cur_pid in locked or opt_pid in locked:
            tags.append("lock")
        index = int(label.split("#")[1]) - 1 if "#" in label else 0
        slots.append({"slot": label.split("#")[0], "slot_index": index,
                      "current": _assignment(label, cur_pid, refs, mine_games, locked),
                      "optimal": _assignment(label, opt_pid, refs, mine_games, locked),
                      "changed": changed, "reason": why["reason"] if (changed and why) else None,
                      "reason_tags": sorted(set(tags)), "delta_p_win": None})
    starting_current = {p for s, p in by_slot_current.items() if s.split("#")[0] not in ("BN", "IL")}
    bench_current = [p for p, s in current.items() if s.split("#")[0] == "BN"]
    tips = [g["tip_at"] for g in mine_games.values() if g["tip_at"]]
    return {"date": str(day), "weekday": day.strftime("%a"), "is_today": day == today, "is_past": False,
            "slots": slots,
            "bench_current": [_assignment("BN", p, refs, mine_games, locked) for p in bench_current],
            "bench_optimal": [_assignment("BN", p, refs, mine_games, locked) for p in res.bench],
            "il": [_assignment("IL", p, refs, mine_games, locked) for p in res.il],
            "games_available": len(mine_games),
            "games_started_current": sum(1 for p in starting_current if p in mine_games),
            "games_started_optimal": sum(1 for p in res.starters.values() if p in mine_games),
            "delta_p_win": None, "first_lock_at": min(tips) if tips else None}


# ------------------------------------------------------------------ win probability (Phase 2)

def _team_ref(con, team_id: int) -> dict:
    names = tracker.league_team_names(con)
    return {"team_id": int(team_id), "name": names.get(team_id) or f"Team {team_id}", "manager": None,
            "record": None, "logo_url": None}


def probability_response(con: duckdb.DuckDBPyConnection, cfg: Settings | None = None,
                         now: datetime | None = None) -> dict:
    """WinProbabilityResponse: snapshot history for this week plus the do-nothing path.
    The recommended plan and alternatives arrive with the weekly optimizer."""
    cfg = cfg or settings()
    try:
        inp = matchup.week_inputs(con, cfg, now)
    except matchup.NoMatchup as exc:
        raise NotReady(str(exc)) from exc
    now = inp["now"]
    m = matchup.matchup_now(inp["me"], inp["opp"], inp["me_done"], inp["opp_done"], inp["var_mult"], cfg,
                            inp["corr"])
    lead = matchup.cats_lead(inp["me_done"], inp["opp_done"], cfg)
    snaps = con.execute("""SELECT ts, p_win_week, p_cats, cats_me, cats_opp, event_kind, event_label
                           FROM matchup_snapshots WHERE week = ? AND opponent_team_id = ? ORDER BY ts""",
                        [inp["week"], inp["opp_id"]]).df()
    history, prev = [], None
    for r in snaps.itertuples(index=False):
        p = float(r.p_win_week)
        history.append({"ts": _iso(r.ts), "p_win_week": p, "lo": p, "hi": p,
                        "cats_lead": {"me": int(r.cats_me), "opp": int(r.cats_opp)},
                        "event": {"kind": r.event_kind, "label": r.event_label,
                                  "delta_p": 0.0 if prev is None else p - prev},
                        "p_cats": json.loads(r.p_cats) if r.p_cats else None})
        prev = p
    history.append({"ts": now.isoformat(), "p_win_week": m.p_win_week, "lo": m.p_win_week,
                    "hi": m.p_win_week, "cats_lead": lead, "event": None, "p_cats": m.p_cat})
    today = now.date()
    before = snaps
    if not snaps.empty:
        before = snaps[pd.to_datetime(snaps["ts"]).dt.tz_convert(ET).dt.date < today]
    since = m.p_win_week - float(before["p_win_week"].iloc[-1]) if not before.empty else None

    scenarios = []
    if inp["days"]:
        path = matchup.do_nothing_path(inp["me"], inp["opp"], inp["me_done"], inp["opp_done"],
                                       inp["var_mult"], cfg, seed=cfg.simulation.seed, corr=inp["corr"])
        pw = m.p_win_week
        pts = [{"ts": now.isoformat(), "p_win_week": pw, "lo": pw, "hi": pw, "expected_cats": m.expected_cats,
                "moves_applied": [], "cat_deltas": [], "p_cats": m.p_cat}]
        pts += [{"ts": matchup.day_end_ts(p.day), "p_win_week": p.p_win_week, "lo": p.lo, "hi": p.hi,
                 "expected_cats": p.expected_cats, "moves_applied": [], "cat_deltas": [], "p_cats": p.p_cats}
                for p in path]
        last = pts[-1]
        scenarios.append({"scenario_id": "do_nothing", "label": "Do nothing", "kind": "do_nothing",
                          "move_ids": [], "points": pts, "delta_vs_do_nothing": None,
                          "final": {k: last[k] for k in ("p_win_week", "lo", "hi", "expected_cats")}})
    run_iso = _iso(inp["run_at"])
    stale = (pd.Timestamp(now) - pd.Timestamp(inp["run_at"])) > STALE_AFTER
    sim = cfg.simulation
    return {
        "as_of": run_iso, "stale": bool(stale),
        "stale_reason": f"Projections are from {run_iso}; the nightly run is overdue." if stale else None,
        "provenance": [
            {"module": "projections", "as_of": run_iso, "run_id": None,
             "note": "baseline: EWMA per-minute rates x minutes x P(plays)"},
            {"module": "simulate", "as_of": now.isoformat(), "run_id": None,
             "note": (f"10 active slots per day; calibrated weekly spreads; categories drawn together "
                      f"({sim.week_draws:,} draws); path from {sim.path_draws:,} simulated weeks")
                     + ("" if inp["corr"] is not None else "; correlation not fitted yet (independent)")},
            {"module": "yahoo", "as_of": _iso(inp["cats_as_of"]), "run_id": None,
             "note": "matchup.csv totals; FG%/FT% attempts so far estimated from box scores"},
        ],
        "week": week_context(today, cfg), "opponent": _team_ref(con, inp["opp_id"]),
        "history": history, "scenarios": scenarios, "recommended_move_ids": [],
        "current": {"p_win_week": m.p_win_week, "delta_since_yesterday": since},
        "cats_as_of": _iso(inp["cats_as_of"]),
    }


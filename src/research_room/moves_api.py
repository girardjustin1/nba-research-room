"""Season moves: the optimizer's weekly plan as API responses.

Inputs: matchup.week_inputs (the week), optimizer (plan, feasibility, exact scoring), the latest
players.csv free agents, matchup.csv acquisitions_used when present.
Outputs: dicts for GET /season/moves (MovesResponse), POST /season/scenario (ScenarioResponse),
and the recommended scenario inside GET /season/week/probability (web/src/api/season.ts).
Tables: reads only.

The plan is cached per (week, projections run, Yahoo snapshots, day, my roster) so the Matchup and
Moves screens share one solve (about 2 s).
"""

from __future__ import annotations

import time
from datetime import date, datetime, timedelta

import duckdb
import pandas as pd

from research_room import matchup, optimizer, season_api
from research_room.config import Settings, settings
from research_room.season_api import STALE_AFTER, NotReady, _iso, _player_refs

_PLAN_CACHE: dict = {}


def _week_and_plan(
    con, cfg: Settings, now: datetime | None
) -> tuple[dict, pd.DataFrame, optimizer.Plan, dict]:
    """The week's inputs, the free-agent pool, the optimizer's plan and the acquisitions, with the
    plan cached per (week, projections run, Yahoo snapshots, day) so the screens share one solve."""
    try:
        inp = matchup.week_inputs(con, cfg, now)
    except matchup.NoMatchup as exc:
        raise NotReady(str(exc)) from exc
    pool = optimizer.free_agents(con, cfg)
    if pool.empty:
        raise NotReady(
            "No free agents yet: save players.csv (available players) to data/inbox and run `make inbox`."
        )
    acq = _acquisitions(con, inp, cfg)
    snap = con.execute("SELECT max(snapshot_at) FROM yahoo_players").fetchone()[0]
    key = (
        inp["week"],
        str(inp["run_at"]),
        str(inp["cats_as_of"]),
        str(snap),
        inp["now"].date(),
        acq["used"],
        tuple(sorted(inp["me_roster"]["player_id"])),
    )
    plan = _PLAN_CACHE.get(key)
    if plan is None:
        _PLAN_CACHE.clear()
        plan = optimizer.optimize(inp, pool, acq["max"] - acq["used"] - acq["pending"], cfg)
        _PLAN_CACHE[key] = plan
    return inp, pool, plan, acq


def _acquisitions(con, inp: dict, cfg: Settings) -> dict:
    used = con.execute(
        """SELECT acquisitions_used FROM yahoo_matchups
                          WHERE week = ? AND team_id = ? ORDER BY snapshot_at DESC LIMIT 1""",
        [inp["week"], inp["me_id"]],
    ).fetchone()
    known = used is not None and used[0] is not None
    return {
        "used": int(used[0]) if known else 0,
        "max": cfg.transactions.max_acquisitions_per_week,
        "pending": 0,
        "resets_on": str(inp["end"] + timedelta(days=1)),
        "known": known,
    }


def _cat_deltas(after: dict, before: dict, cfg: Settings, floor: float = 0.01) -> list[dict]:
    out = [
        {"key": c.key, "delta_p": after[c.key] - before[c.key], "p_after": after[c.key]}
        for c in cfg.categories
        if abs(after[c.key] - before[c.key]) >= floor
    ]
    return sorted(out, key=lambda d: -abs(d["delta_p"]))


def _scenario(
    inp: dict,
    pool: pd.DataFrame,
    moves: list,
    sid: str,
    label: str,
    kind: str,
    cfg: Settings,
    baseline: matchup.MatchupNow,
) -> dict:
    """A scenario path: at each day's end, P(win week) if the moves due by then are made (a move is
    due the day before it takes effect) and nothing after; the band is the full plan's simulated
    10th-90th percentile at that day, widened to contain the point."""
    base, days, now = inp["me_roster"], inp["days"], inp["now"]
    full_days = matchup.team_days(optimizer.apply_moves(base, pool, moves, days), inp["proj"], days, cfg)
    band = matchup.do_nothing_path(
        full_days,
        inp["opp"],
        inp["me_done"],
        inp["opp_done"],
        inp["var_mult"],
        cfg,
        seed=cfg.simulation.seed,
        corr=inp["corr"],
    )
    cache: dict = {}

    def at(due_by):
        made = [m for m in moves if m.effective <= due_by]
        k = tuple(m.move_id for m in made)
        if k not in cache:
            cache[k] = (made, optimizer.evaluate(inp, base, pool, made, cfg) if made else baseline)
        return cache[k]

    pw = baseline.p_win_week
    points = [
        {
            "ts": now.isoformat(),
            "p_win_week": pw,
            "lo": pw,
            "hi": pw,
            "expected_cats": baseline.expected_cats,
            "moves_applied": [],
            "cat_deltas": [],
            "p_cats": baseline.p_cat,
        }
    ]
    for b in band:
        made, m = at(b.day + timedelta(days=cfg.optimizer.add_takes_effect_days))
        p = m.p_win_week
        points.append(
            {
                "ts": matchup.day_end_ts(b.day),
                "p_win_week": p,
                "lo": min(b.lo, p),
                "hi": max(b.hi, p),
                "expected_cats": m.expected_cats,
                "moves_applied": [x.move_id for x in made],
                "cat_deltas": _cat_deltas(m.p_cat, baseline.p_cat, cfg),
                "p_cats": m.p_cat,
            }
        )
    full = at(days[-1] + timedelta(days=365))[1]
    last = points[-1]
    return {
        "scenario_id": sid,
        "label": label,
        "kind": kind,
        "move_ids": [m.move_id for m in moves],
        "points": points,
        "delta_vs_do_nothing": full.p_win_week - pw,
        "final": {
            "p_win_week": full.p_win_week,
            "lo": last["lo"],
            "hi": last["hi"],
            "expected_cats": full.expected_cats,
        },
    }


def _missing_acq(acq: dict) -> list[dict]:
    if acq["known"]:
        return []
    return [
        {
            "key": "acquisitions_used",
            "label": "This week's acquisitions used is not in matchup.csv",
            "effect": f"Assumed 0 of {acq['max']} used; add an acquisitions_used column to matchup.csv.",
        }
    ]


def _move_json(
    m: optimizer.Move,
    rank: int,
    refs: dict,
    single: matchup.MatchupNow,
    baseline: matchup.MatchupNow,
    inp: dict,
    cfg: Settings,
    missing: list[dict],
) -> dict:
    days = inp["days"]
    adds_games = sum(
        1
        for d in days
        if d >= m.effective
        and not inp["proj"][(inp["proj"]["player_id"] == m.add) & (inp["proj"]["date"] == d)].empty
    )
    deltas = _cat_deltas(single.p_cat, baseline.p_cat, cfg)
    label = {c.key: c.label for c in cfg.categories}
    top = ", ".join(f"{label[d['key']]} {d['delta_p'] * 100:+.0f} pts" for d in deltas[:3]) or "small changes"
    add, drop = refs.get(m.add), refs.get(m.drop)
    d = single.p_win_week - baseline.p_win_week
    reason = f"Adds {adds_games} game{'s' if adds_games != 1 else ''} from {m.effective:%a}: {top}."
    details = [
        f"P(win week) {baseline.p_win_week:.0%} -> {single.p_win_week:.0%} with this move alone.",
        f"Expected categories {baseline.expected_cats:.1f} -> {single.expected_cats:.1f} of "
        f"{len(cfg.categories)}.",
    ]
    if drop:
        details.append(f"{drop['name']} leaves from {m.effective:%a %b %-d}.")
    return {
        "move_id": m.move_id,
        "rank": rank,
        "kind": "add_drop",
        "player": add,
        "counterpart": drop,
        "slot": None,
        "dates": [str(x) for x in days if x >= m.effective],
        "delta_p_win": {"mean": d, "sd": 0.0, "lo": d, "hi": d, "level": 0.8},
        "p_win_after": single.p_win_week,
        "delta_expected_cats": single.expected_cats - baseline.expected_cats,
        "cat_deltas": deltas,
        "reason": reason,
        "details": details,
        "confidence": {
            "level": "medium",
            "score": None,
            "missing": [
                *missing,
                {
                    "key": "move_band",
                    "label": "No uncertainty band for a single move's effect yet",
                    "effect": "The change is the engine's expected effect; lo and hi equal it.",
                },
            ],
        },
        "deadline": {"kind": "add_before_game", "at": matchup.day_end_ts(m.effective - timedelta(days=1))},
        "uses_acquisition": True,
        "playable": None,
        "depends_on": [],
        "provenance": [
            {
                "module": "optimizer",
                "as_of": inp["now"].isoformat(),
                "run_id": None,
                "note": "weekly MILP linearized at the matchup, scored exactly by simulate",
            }
        ],
    }


def _refs_for(con, inp: dict, pool: pd.DataFrame) -> dict:
    now = inp["now"]
    refs = _player_refs(con, inp["me_roster"], {}, now)
    fa = _player_refs(con, pool, {}, now)
    pct = dict(zip(pool["player_id"], pool["pct_rostered"], strict=True))
    for pid, r in fa.items():
        r["owner"] = "free_agent"
        v = pct.get(pid)
        r["pct_rostered"] = None if v is None or pd.isna(v) else float(v) / 100.0
    return {**refs, **fa}


def moves_response(
    con: duckdb.DuckDBPyConnection, cfg: Settings | None = None, now: datetime | None = None
) -> dict:
    """MovesResponse: the optimizer's add/drop plan, each move scored alone and all together."""
    cfg = cfg or settings()
    inp, pool, plan, acq = _week_and_plan(con, cfg, now)
    baseline = matchup.matchup_now(
        inp["me"], inp["opp"], inp["me_done"], inp["opp_done"], inp["var_mult"], cfg, inp["corr"]
    )
    refs, missing = _refs_for(con, inp, pool), _missing_acq(acq)
    singles = {m.move_id: optimizer.evaluate(inp, inp["me_roster"], pool, [m], cfg) for m in plan.moves}
    order = sorted(plan.moves, key=lambda m: -singles[m.move_id].p_win_week)
    moves = [
        _move_json(m, i + 1, refs, singles[m.move_id], baseline, inp, cfg, missing)
        for i, m in enumerate(order)
    ]
    run_iso = _iso(inp["run_at"])
    band = lambda p: {"p": p, "lo": p, "hi": p, "level": 0.8}  # noqa: E731
    return {
        "as_of": run_iso,
        "stale": bool((pd.Timestamp(inp["now"]) - pd.Timestamp(inp["run_at"])) > STALE_AFTER),
        "stale_reason": None,
        "provenance": [
            {
                "module": "optimizer",
                "as_of": inp["now"].isoformat(),
                "run_id": None,
                "note": f"{len(pool)} free agents from players.csv; "
                f"{cfg.optimizer.candidate_pool} considered",
            },
            {"module": "projections", "as_of": run_iso, "run_id": None, "note": "baseline"},
        ],
        "baseline": {"p_win_week": band(baseline.p_win_week), "expected_cats": baseline.expected_cats},
        "with_all": (
            {
                "p_win_week": band(plan.p_win_week),
                "expected_cats": plan.expected_cats,
                "delta_vs_baseline": plan.p_win_week - baseline.p_win_week,
            }
            if plan.moves
            else None
        ),
        "moves": moves,
        "acquisitions": {k: v for k, v in acq.items() if k != "known"},
        "optimizer": {
            "status": plan.status if plan.status in ("optimal", "infeasible") else "not_run",
            "message": plan.message,
            "solved_at": inp["now"].isoformat(),
            "solve_ms": plan.solve_ms,
            "horizon": [str(d) for d in inp["days"]],
            "objective": "p_win_week",
        },
    }


def parse_move_id(mid: str) -> optimizer.Move:
    """'add-201-drop-12-2026-11-04' -> Move (0 means none)."""
    try:
        _, add, _, drop, y, mo, d = mid.split("-")
        return optimizer.Move(mid, int(add) or None, int(drop) or None, date(int(y), int(mo), int(d)))
    except ValueError as exc:
        raise ValueError(f"not a move id: {mid}") from exc


def scenario_response(
    con: duckdb.DuckDBPyConnection,
    move_ids: list[str],
    cfg: Settings | None = None,
    now: datetime | None = None,
) -> dict:
    """ScenarioResponse: re-simulate the chosen moves (feasibility from the optimizer's rules)."""
    cfg = cfg or settings()
    t0 = time.perf_counter()
    inp, pool, plan, acq = _week_and_plan(con, cfg, now)
    left = acq["max"] - acq["used"] - acq["pending"]
    earliest = (
        inp["days"][optimizer.first_add_index(inp["days"], inp["now"].date(), cfg)]
        if optimizer.first_add_index(inp["days"], inp["now"].date(), cfg) < len(inp["days"])
        else None
    )
    try:
        chosen = [parse_move_id(m) for m in move_ids]
    except ValueError as exc:
        return {
            "scenario": None,
            "feasible": False,
            "message": str(exc),
            "solve_ms": None,
            "incompatible": [],
        }
    why = optimizer.check(inp["me_roster"], chosen, left, cfg, inp["days"], earliest)
    offered = [m for m in plan.moves if m.move_id not in set(move_ids)]
    incompatible = [
        {"move_id": m.move_id, "reason": r}
        for m in offered
        if (r := optimizer.check(inp["me_roster"], [*chosen, m], left, cfg, inp["days"], earliest))
    ]
    if why:
        return {
            "scenario": None,
            "feasible": False,
            "message": why,
            "solve_ms": None,
            "incompatible": incompatible,
        }
    baseline = matchup.matchup_now(
        inp["me"], inp["opp"], inp["me_done"], inp["opp_done"], inp["var_mult"], cfg, inp["corr"]
    )
    sc = _scenario(inp, pool, chosen, "custom", "Your selection", "custom", cfg, baseline)
    return {
        "scenario": sc,
        "feasible": True,
        "message": None,
        "solve_ms": round((time.perf_counter() - t0) * 1000, 1),
        "incompatible": incompatible,
    }


def with_recommended(
    resp: dict, con: duckdb.DuckDBPyConnection, cfg: Settings | None = None, now: datetime | None = None
) -> dict:
    """Add the optimizer's recommended scenario to a WinProbabilityResponse. Without free agents
    (no players.csv yet) the response keeps only "do nothing" and says why in its provenance."""
    cfg = cfg or settings()
    if not resp.get("scenarios"):
        return resp
    try:
        inp, pool, plan, _acq = _week_and_plan(con, cfg, now)
    except NotReady as exc:
        resp["provenance"].append({"module": "optimizer", "as_of": None, "run_id": None, "note": str(exc)})
        return resp
    if plan.moves:
        baseline = matchup.matchup_now(
            inp["me"], inp["opp"], inp["me_done"], inp["opp_done"], inp["var_mult"], cfg, inp["corr"]
        )
        rec = _scenario(inp, pool, plan.moves, "recommended", "With moves", "recommended", cfg, baseline)
        resp["scenarios"].append(rec)
        resp["recommended_move_ids"] = rec["move_ids"]
    resp["provenance"].append(
        {
            "module": "optimizer",
            "as_of": inp["now"].isoformat(),
            "run_id": None,
            "note": plan.message or f"{len(plan.moves)} moves, solved in {plan.solve_ms:.0f} ms",
        }
    )
    return resp


# ------------------------------------------------------------------ one player's analysis


def _player_ref(con, player_id: int, now: datetime) -> dict:
    row = con.execute(
        """SELECT p.full_name, p.position FROM players p WHERE p.player_id = ?""", [player_id]
    ).fetchone()
    if row is None:
        raise KeyError(f"Unknown player {player_id}.")
    yel = con.execute(
        """SELECT eligible_positions FROM yahoo_players WHERE player_id = ?
                         ORDER BY snapshot_at DESC LIMIT 1""",
        [player_id],
    ).fetchone()
    if yel and yel[0]:
        elig = [p for p in yel[0].split(",") if p]
    else:
        from research_room.backtest import eligibility  # BallDontLie position -> Yahoo-style slots

        elig = eligibility(row[1])
    frame = pd.DataFrame({"player_id": [player_id], "name": [row[0]], "eligible": [elig]})
    ref = _player_refs(con, frame, {}, now)[player_id]
    on_mine = con.execute(
        """SELECT count(*) FROM yahoo_rosters WHERE player_id = ? AND team_id = ?
                             AND snapshot_at = (SELECT max(snapshot_at) FROM yahoo_rosters
                                                WHERE team_id = ?)""",
        [player_id, settings().league.my_team_id, settings().league.my_team_id],
    ).fetchone()[0]
    ref["owner"] = "mine" if on_mine else "free_agent"
    return ref


def _player_plan(con, inp: dict, plan: optimizer.Plan, player_id: int, cfg: Settings) -> tuple[dict, dict]:
    """Recommendation and schedule factor for one player from the week's plan."""
    days, base = inp["days"], inp["me_roster"]
    rosters = plan.rosters or [base] * len(days)
    td = matchup.team_days(rosters, inp["proj"], days, cfg)
    has_game = {
        d: not inp["proj"][(inp["proj"]["player_id"] == player_id) & (inp["proj"]["date"] == d)].empty
        for d in days
    }
    on_roster = [player_id in set(r["player_id"]) for r in rosters]
    added = next((m for m in plan.moves if m.add == player_id), None)
    dropped = next((m for m in plan.moves if m.drop == player_id), None)
    day_plan, starts = [], []
    for i, d in enumerate(days):
        if not on_roster[i]:
            action = "not_rostered"
        elif not has_game[d]:
            action = "no_game"
        elif player_id in td.starters[i]:
            action = "start"
            starts.append(d)
        else:
            action = "bench"
        day_plan.append({"date": str(d), "weekday": f"{d:%a}", "action": action, "slot": None})
    fmt_days = ", ".join(f"{d:%a}" for d in starts)
    if added is not None:
        action, move_id = "add", added.move_id
        headline = f"Add from {added.effective:%a}" + (f"; start {fmt_days}" if fmt_days else "")
    elif dropped is not None:
        action, move_id, headline = (
            "drop",
            dropped.move_id,
            f"Drop from {dropped.effective:%a} for a better week",
        )
    elif on_roster[0]:
        action, move_id = ("start" if starts else "bench"), None
        headline = f"Start {fmt_days}" if starts else "Bench: no start fits this week"
    else:
        action, move_id, headline = "hold", None, "Not in this week's plan"
    rec = {
        "action": action,
        "headline": headline,
        "slot": None,
        "plan": day_plan,
        "delta_p_win": None,
        "versus": None,
        "confidence": {"level": "medium", "score": None, "missing": []},
        "move_id": move_id,
    }
    games = season_api._games(con, days[0], days[-1], cfg) if days else pd.DataFrame()
    team = con.execute("SELECT team_id FROM players WHERE player_id = ?", [player_id]).fetchone()
    mine = games[games["team_id"] == (team[0] if team else -1)] if not games.empty else games
    sched_days = []
    for i, d in enumerate(days):
        g = mine[mine["date"] == d] if not mine.empty else mine
        game = None
        if not g.empty:
            r = g.iloc[0]
            game = {
                "game_id": int(r["game_id"]),
                "date": str(d),
                "tip_at": r["tip_at"],
                "opp_abbr": r["opp_abbr"],
                "home": bool(r["home"]),
                "b2b": bool(r["b2b"]),
            }
        sched_days.append(
            {
                "date": str(d),
                "weekday": f"{d:%a}",
                "game": game,
                "open_slots": max(0, cfg.roster.active_per_day - td.counted[i]),
                "would_start": player_id in td.starters[i],
                "light_day": False,
            }
        )
    n = sum(1 for x in sched_days if x["game"])
    factor = {
        "id": "schedule",
        "kind": "schedule",
        "title": "Schedule",
        "value": float(n),
        "format": "count",
        "value_note": "games left",
        "reading": (
            f"{n} games left this week; would start {len(starts)} of them."
            if on_roster[0] or added
            else f"{n} games left this week."
        ),
        "push": "for" if starts else "neutral",
        "confidence": {"level": "high", "score": None, "missing": []},
        "provenance": [
            {
                "module": "optimizer",
                "as_of": inp["now"].isoformat(),
                "run_id": None,
                "note": "10 active slots per day; the week's plan applied",
            }
        ],
        "detail": {"kind": "schedule", "days": sched_days},
    }
    return rec, factor


def player_response(
    con: duckdb.DuckDBPyConnection, player_id: int, cfg: Settings | None = None, now: datetime | None = None
) -> dict:
    """PlayerAnalysisResponse: the explained projection, plus advice when the week's inputs exist."""
    from research_room.projections import explain

    cfg = cfg or settings()
    when = (now or datetime.now(matchup.ET)).astimezone(matchup.ET)
    ref = _player_ref(con, player_id, when)
    rec = sched = None
    try:
        inp, _pool, plan, _acq = _week_and_plan(con, cfg, now)
        rec, sched = _player_plan(con, inp, plan, player_id, cfg)
    except NotReady:
        pass
    try:
        return explain.player_analysis(
            con, player_id, cfg, when, season_api.week_context(when.date(), cfg), ref, rec, sched
        )
    except explain.NotReady as exc:
        raise NotReady(str(exc)) from exc

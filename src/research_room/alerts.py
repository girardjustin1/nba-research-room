"""In-app notifications: what changed that matters for my week, from the engine's own numbers.

Inputs: the latest Yahoo rosters (mine and my opponent's), games, the resolved overrides (X posts,
the NBA injury report, BallDontLie, manual), the lineup response (current vs recommended slots),
the add/drop plan (moves_api), matchup snapshots (P(win week) before and after news),
settings.alerts.
Outputs: rows in `notifications` (kind, priority, title, body, player, impact, action, deadline,
provenance), each written once (its id is a key for what it says), and
`notifications_response` for GET /season/notifications. Read state lives in
data/notifications_read.json, so marking read from the app never waits on a job holding the store.
Tables: writes notifications; reads yahoo_rosters, games, players, projections, matchup_snapshots
(through the modules above).

Kinds (web/src/api/season.ts `NotificationKind`):
- injury: one of my players with a game today is ruled out, doubtful, questionable or limited.
  Urgent when he's in my lineup, before his tip, and out or doubtful.
- news: the same for my opponent's players (it moves my odds the other way).
- lineup_lock: today's recommended lineup differs from my Yahoo lineup before the first lock.
- game_day: who plays today, mine and my opponent's.
- waiver: an add/drop the plan says is worth at least `alerts.waiver_min_gain` of P(win week).
- model: the nightly run finished (projections refreshed).
The effect on my week is the change between the matchup snapshot before the news and after it
(simulate.py), never a number written here. Titles and bodies only restate engine values.
"""

from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timedelta
from pathlib import Path

import duckdb
import pandas as pd

from research_room import overrides, store
from research_room.config import Settings, settings

ET = "America/New_York"
LIMITING = {
    "out": "ruled out",
    "out for season": "out for the season",
    "doubtful": "doubtful",
    "questionable": "questionable",
    "day-to-day": "day-to-day",
}
SEVERITY = ((0.05, "high"), (0.02, "medium"), (0.0, "low"))


def _json(v):
    """A stored JSON column, or None (an empty one reads back as NaN)."""
    return json.loads(v) if isinstance(v, str) and v else None


def _id(key: str) -> str:
    return "n-" + hashlib.sha1(key.encode()).hexdigest()[:16]


def _today(now: datetime) -> date:
    return pd.Timestamp(now).tz_convert(ET).date()


def _roster(con, team_id: int) -> pd.DataFrame:
    return con.execute(
        """
        SELECT r.player_id, r.player_name, r.selected_slot FROM yahoo_rosters r
        WHERE r.team_id = ? AND r.player_id IS NOT NULL
          AND r.snapshot_at = (SELECT max(snapshot_at) FROM yahoo_rosters WHERE team_id = ?)
    """,
        [team_id, team_id],
    ).df()


def _tips(con, day: date) -> dict[int, pd.Timestamp]:
    """team_id -> tip time of its game that day."""
    g = con.execute(
        "SELECT home_team_id, visitor_team_id, tip_utc FROM games WHERE game_date = ?", [day]
    ).df()
    out = {}
    for r in g.itertuples(index=False):
        if pd.notna(r.tip_utc):
            out[int(r.home_team_id)] = out[int(r.visitor_team_id)] = pd.Timestamp(r.tip_utc)
    return out


def _team_of(con) -> dict[int, int]:
    return {
        int(p): int(t)
        for p, t in con.execute("SELECT player_id, team_id FROM players WHERE team_id IS NOT NULL").fetchall()
    }


def _opponent(con, cfg: Settings, day: date) -> int | None:
    from research_room import matchup, schedule

    week = schedule.week_of(day, cfg.season)
    if week is None:
        return None
    try:
        opp, _ = matchup.opponent_for(con, week, cfg.league.my_team_id)
        return int(opp) if opp is not None else None
    except Exception:  # noqa: BLE001 - no matchup file yet: opponent alerts wait
        return None


def week_impact(con, cfg: Settings, now: datetime) -> dict | None:
    """Impact of the latest news refresh: P(win week) after it minus the snapshot before it."""
    from research_room.moves_api import _cat_deltas

    snaps = con.execute(
        """
        SELECT ts, p_win_week, p_cats, event_kind FROM matchup_snapshots
        WHERE ts <= ? ORDER BY ts DESC LIMIT 2
    """,
        [now],
    ).df()
    if len(snaps) < 2 or snaps.iloc[0]["event_kind"] != "news":
        return None
    after, before = snaps.iloc[0], snaps.iloc[1]
    d = float(after["p_win_week"]) - float(before["p_win_week"])
    try:
        cats = _cat_deltas(json.loads(after["p_cats"]), json.loads(before["p_cats"]), cfg)
    except (TypeError, ValueError, KeyError):
        cats = []
    sev = next((s for t, s in SEVERITY if abs(d) >= t and (t > 0 or d != 0)), "none")
    return {
        "delta_p_win": d,
        "cat_deltas": cats,
        "summary": (
            f"Your win-the-week chance {float(before['p_win_week']):.0%} -> {float(after['p_win_week']):.0%}."
        ),
        "suggestion": None,
        "move_id": None,
        "severity": sev,
        "confidence": {"level": "medium", "score": None, "missing": []},
        "computed_at": pd.Timestamp(after["ts"]).isoformat(),
    }


def _status_alerts(con, cfg: Settings, now: datetime, impact: dict | None) -> list[dict]:
    """injury (mine) and news (my opponent's) for players with a game today."""
    today = _today(now)
    tips, team_of = _tips(con, today), _team_of(con)
    ov = overrides.resolve(con, today, today, as_of=pd.Timestamp(now).to_pydatetime(), cfg=cfg)
    if ov.empty:
        return []
    ov = ov.set_index("player_id")
    out = []
    sides = [("mine", cfg.league.my_team_id)]
    opp = _opponent(con, cfg, today)
    if opp is not None:
        sides.append(("opponent", opp))
    for side, team in sides:
        for r in _roster(con, team).itertuples(index=False):
            pid = int(r.player_id)
            tip = tips.get(team_of.get(pid, -1))
            if tip is None or pid not in ov.index:
                continue
            o = ov.loc[pid]
            o = o.iloc[0] if isinstance(o, pd.DataFrame) else o
            status = str(o["status"] or "")
            cap = o["minutes_cap"] if pd.notna(o["minutes_cap"]) else None
            phrase = LIMITING.get(status.lower())
            if not phrase and cap is None:
                continue
            what = phrase or f"limited to {cap:.0f} minutes"
            active = str(r.selected_slot or "").upper() not in ("BN", "IL", "IL+", "")
            before_tip = pd.Timestamp(now) < tip
            hard = status.lower() in ("out", "out for season", "doubtful")
            if side == "mine":
                kind = "injury"
                priority = "urgent" if (active and before_tip and hard) else "high" if hard else "normal"
                body = (
                    f"{o['source']} reports {status or 'a minutes limit'} for his "
                    f"{tip.tz_convert(ET):%-I:%M %p} game"
                    + (f" (minutes limit {cap:.0f})" if cap is not None and phrase else "")
                    + (". He's in your lineup." if active else ". He's on your bench.")
                )
                action = {"label": "Check today's lineup", "target": "lineup", "ref": str(today)}
            else:
                kind = "news"
                priority = "normal"
                body = (
                    f"Your opponent's player: {o['source']} reports {status or 'a minutes limit'} for today."
                )
                action = {"label": "See the matchup", "target": "feed", "ref": None}
            key = f"{kind}:{pid}:{today}:{status}:{cap}"
            out.append(
                {
                    "id": _id(key),
                    "kind": kind,
                    "priority": priority,
                    "title": f"{r.player_name} {what} today",
                    "body": body,
                    "player_id": pid,
                    "owner": side,
                    "impact": impact if impact and impact["severity"] != "none" else None,
                    "action": action,
                    "deadline": {"kind": "lineup_lock", "at": tip.isoformat()}
                    if side == "mine" and before_tip
                    else None,
                    "provenance": [
                        {
                            "module": "overrides",
                            "as_of": pd.Timestamp(o["ts"]).isoformat() if pd.notna(o["ts"]) else None,
                            "run_id": None,
                            "note": str(o["source"]),
                        }
                    ],
                }
            )
    return out


def _lineup_alert(con, cfg: Settings, now: datetime) -> list[dict]:
    from research_room import season_api

    try:
        lr = season_api.lineup_response(con, cfg, now)
    except Exception:  # noqa: BLE001 - no roster or projections yet
        return []
    today = next((d for d in lr.get("days", []) if d.get("is_today")), None)
    if not today or not today.get("first_lock_at"):
        return []
    lock = pd.Timestamp(today["first_lock_at"])
    window = timedelta(hours=cfg.alerts.lock_window_hours)
    if not (lock - window <= pd.Timestamp(now) < lock):
        return []
    changes = [s for s in today["slots"] if s.get("changed") and s["optimal"].get("player")]
    if not changes:
        return []
    named = [f"{s['optimal']['player']['name']} at {s['slot']}" for s in changes[:3]]
    gain = today["games_started_optimal"] - today["games_started_current"]
    key = f"lock:{today['date']}:" + ",".join(sorted(named))
    return [
        {
            "id": _id(key),
            "kind": "lineup_lock",
            "priority": "high",
            "title": f"Lineup locks start at {lock.tz_convert(ET):%-I:%M %p}",
            "body": (
                f"{len(changes)} change{'s' if len(changes) != 1 else ''} not made in Yahoo yet: "
                + "; ".join(named)
                + "."
                + (f" Starts {gain} more game{'s' if gain != 1 else ''} today." if gain > 0 else "")
            ),
            "player_id": None,
            "owner": None,
            "impact": None,
            "action": {"label": "Open today's lineup", "target": "lineup", "ref": today["date"]},
            "deadline": {"kind": "lineup_lock", "at": lock.isoformat()},
            "provenance": [
                {"module": "optimizer", "as_of": lr.get("as_of"), "run_id": None, "note": "lineup.py"}
            ],
        }
    ]


def _game_day(con, cfg: Settings, now: datetime) -> list[dict]:
    today = _today(now)
    tips, team_of = _tips(con, today), _team_of(con)
    mine = _roster(con, cfg.league.my_team_id)
    if mine.empty or not tips:
        return []
    n = sum(1 for p in mine["player_id"] if team_of.get(int(p)) in tips)
    opp = _opponent(con, cfg, today)
    m = (
        sum(1 for p in _roster(con, opp)["player_id"] if team_of.get(int(p)) in tips)
        if opp is not None
        else None
    )
    return [
        {
            "id": _id(f"gameday:{today}"),
            "kind": "game_day",
            "priority": "low",
            "title": f"{n} of your players play today",
            "body": f"{n} of your players have a game today"
            + (f"; your opponent has {m}." if m is not None else "."),
            "player_id": None,
            "owner": None,
            "impact": None,
            "action": {"label": "See today's lineup", "target": "lineup", "ref": str(today)},
            "deadline": None,
            "provenance": [{"module": "projections", "as_of": None, "run_id": None, "note": "schedule"}],
        }
    ]


def _waiver_alerts(con, cfg: Settings, now: datetime) -> list[dict]:
    from research_room import moves_api

    try:
        moves = moves_api.moves_response(con, cfg, now).get("moves", [])
    except Exception:  # noqa: BLE001 - no week inputs yet
        return []
    out = []
    for mv in moves:
        d = (mv.get("delta_p_win") or {}).get("mean")
        if d is None or d < cfg.alerts.waiver_min_gain or not mv.get("player"):
            continue
        drop = mv.get("counterpart")
        out.append(
            {
                "id": _id(f"move:{mv['move_id']}"),
                "kind": "waiver",
                "priority": "high",
                "title": f"Add {mv['player']['name']}" + (f" for {drop['name']}" if drop else ""),
                "body": f"{mv['reason']} P(win week) {d * 100:+.1f} pts with this move alone.",
                "player_id": mv["player"]["player_id"],
                "owner": "free_agent",
                "impact": {
                    "delta_p_win": d,
                    "cat_deltas": mv.get("cat_deltas", []),
                    "summary": f"P(win week) {d * 100:+.1f} pts.",
                    "suggestion": None,
                    "move_id": mv["move_id"],
                    "severity": "high" if d >= 0.05 else "medium",
                    "confidence": mv.get("confidence") or {"level": "medium", "score": None, "missing": []},
                    "computed_at": pd.Timestamp(now).isoformat(),
                },
                "action": {"label": "Review the move", "target": "move", "ref": mv["move_id"]},
                "deadline": mv.get("deadline"),
                "provenance": mv.get("provenance") or [],
            }
        )
    return out


def _model_note(con, now: datetime, report: dict | None) -> list[dict]:
    n = (report or {}).get("projections")
    if not n:
        return []
    day = _today(now)
    return [
        {
            "id": _id(f"model:{day}"),
            "kind": "model",
            "priority": "low",
            "title": "Projections updated",
            "body": f"The nightly run refreshed {int(n):,} projected player-game lines.",
            "player_id": None,
            "owner": None,
            "impact": None,
            "action": None,
            "deadline": None,
            "provenance": [
                {
                    "module": "projections",
                    "as_of": pd.Timestamp(now).isoformat(),
                    "run_id": None,
                    "note": "nightly run",
                }
            ],
        }
    ]


def generate(
    con: duckdb.DuckDBPyConnection,
    cfg: Settings | None = None,
    now: datetime | None = None,
    run: str = "pregame",
    report: dict | None = None,
) -> dict:
    """Build this run's notifications and store the new ones. Returns counts by kind."""
    cfg = cfg or settings()
    now = pd.Timestamp(now or store.utcnow())
    now = now if now.tzinfo else now.tz_localize("UTC")
    items: list[dict] = []
    builders = [
        lambda: _status_alerts(con, cfg, now, week_impact(con, cfg, now)),
        lambda: _lineup_alert(con, cfg, now),
        lambda: _game_day(con, cfg, now),
    ]
    if run == "nightly":
        builders = [lambda: _waiver_alerts(con, cfg, now), lambda: _model_note(con, now, report)]
    errors = []
    for b in builders:
        try:
            items += b()
        except Exception as exc:  # noqa: BLE001 - one kind failing never stops the others
            errors.append(f"{type(exc).__name__}: {exc}"[:200])
    have = {r[0] for r in con.execute("SELECT id FROM notifications").fetchall()} if items else set()
    new = [i for i in items if i["id"] not in have]
    if new:
        store.upsert(
            con,
            "notifications",
            pd.DataFrame(
                [
                    {
                        "id": i["id"],
                        "kind": i["kind"],
                        "priority": i["priority"],
                        "created_at": now,
                        "title": i["title"],
                        "body": i["body"],
                        "player_id": i["player_id"],
                        "owner": i.get("owner"),
                        "impact": json.dumps(i["impact"]) if i["impact"] else None,
                        "action": json.dumps(i["action"]) if i["action"] else None,
                        "deadline": json.dumps(i["deadline"]) if i["deadline"] else None,
                        "provenance": json.dumps(i["provenance"]),
                        "run": run,
                    }
                    for i in new
                ]
            ),
        )
    counts: dict = {}
    for i in new:
        counts[i["kind"]] = counts.get(i["kind"], 0) + 1
    return {"new": len(new), "by_kind": counts, "errors": errors}


# -------------------------------------------------------------------- read state (outside the store)
def _read_path(cfg: Settings, db_path: Path | str | None = None) -> Path:
    """Next to the store in use (tests pass their own)."""
    return Path(db_path or cfg.paths.db).resolve().parent / "notifications_read.json"


def read_state(cfg: Settings, db_path: Path | str | None = None) -> dict:
    try:
        return json.loads(_read_path(cfg, db_path).read_text())
    except (OSError, ValueError):
        return {"ids": [], "all_before": None}


def mark_read(
    cfg: Settings,
    ids: list[str] | None = None,
    now: datetime | None = None,
    db_path: Path | str | None = None,
) -> dict:
    """Mark these ids read, or everything up to now when ids is empty."""
    st = read_state(cfg, db_path)
    if ids:
        st["ids"] = sorted(set(st.get("ids", [])) | set(ids))
    else:
        st["all_before"] = pd.Timestamp(now or store.utcnow()).isoformat()
    p = _read_path(cfg, db_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(st))
    return st


def notifications_response(
    con: duckdb.DuckDBPyConnection,
    cfg: Settings | None = None,
    now: datetime | None = None,
    db_path: Path | str | None = None,
) -> dict:
    """NotificationsResponse: the last `alerts.lookback_days` of notifications, newest first."""
    from research_room.moves_api import _player_ref

    cfg = cfg or settings()
    now = pd.Timestamp(now or store.utcnow())
    now = now if now.tzinfo else now.tz_localize("UTC")
    have = store.has_table(con, "notifications")
    rows = (
        con.execute(
            "SELECT * FROM notifications WHERE created_at >= ? ORDER BY created_at DESC",
            [now - timedelta(days=cfg.alerts.lookback_days)],
        ).df()
        if have
        else pd.DataFrame()
    )
    st = read_state(cfg, db_path)
    read_ids, all_before = set(st.get("ids", [])), st.get("all_before")
    items = []
    for r in rows.itertuples(index=False):
        player = None
        if pd.notna(r.player_id):
            try:
                player = _player_ref(con, int(r.player_id), now.to_pydatetime())
                if r.owner in ("opponent", "free_agent", "mine"):
                    player["owner"] = r.owner
            except KeyError:
                player = None
        created = pd.Timestamp(r.created_at)
        read = r.id in read_ids or (all_before is not None and created <= pd.Timestamp(all_before))
        items.append(
            {
                "id": r.id,
                "kind": r.kind,
                "priority": r.priority,
                "created_at": created.isoformat(),
                "title": r.title,
                "body": r.body,
                "read": bool(read),
                "player": player,
                "impact": _json(r.impact),
                "action": _json(r.action),
                "deadline": _json(r.deadline),
                "claim": None,
                "provenance": _json(r.provenance) or [],
            }
        )
    last = (
        con.execute(
            "SELECT max(finished_at) FROM ingest_runs WHERE source = 'alerts' AND status = 'ok'"
        ).fetchone()[0]
        if store.has_table(con, "ingest_runs")
        else None
    )
    in_season = now.tz_convert(ET).date() >= cfg.season.first_game_date
    stale = bool(in_season and (last is None or now - pd.Timestamp(last) > timedelta(hours=30)))
    return {
        "as_of": pd.Timestamp(last).isoformat() if last is not None else now.isoformat(),
        "stale": stale,
        "stale_reason": "Alerts haven't been checked in over 30 hours: is the pre-game schedule running?"
        if stale
        else None,
        "provenance": [
            {
                "module": "overrides",
                "as_of": None,
                "run_id": None,
                "note": "X posts, the NBA injury report, BallDontLie, manual overrides",
            }
        ],
        "items": items,
        "unread": sum(1 for i in items if not i["read"]),
    }

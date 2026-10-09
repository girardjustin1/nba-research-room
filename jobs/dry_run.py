"""Game-day dry run: the nightly and pre-game jobs end to end on a copy of the store, with the
clock set to a chosen game day. The real store is never written.

Usage: make dry-run                                  (opening night, settings.season.first_game_date)
       make dry-run ARGS="--day 2027-03-15"          (any game day)
       make dry-run ARGS="--with-x"                  (also reads X and calls the parser: paid)
       make dry-run ARGS="--with-markets"            (also pulls TheRundown and Kalshi lines: paid)

1. Copies the store (and the read state beside it) to data/dry-run/.
2. Nightly run the night before DAY, at 23:30 Eastern (feeds on: BallDontLie and the NBA injury
   report; the paid feeds, X and the betting markets, are stubbed unless asked for). Feeds can
   only return what exists today, so a future date's box scores or report are honestly absent;
   those steps must fail softly, not stop the night.
3. Pre-game run on DAY at 17:00 Eastern. X is replaced by a stub unless --with-x. Yahoo is read
   from the CSV inbox only: the sign-in file is never refreshed or written.
4. Checks what a game day needs and prints ok, FAIL, or WAIT (waiting on the owner's Yahoo
   files, not broken) for each, then any step errors.
Needs the dev extra (time-machine) to move the clock.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
RANKED = 300  # Basketball Monster's top N: the players a fantasy league actually rosters


def _errors(obj, path="") -> list[str]:
    """Every {'error': ...} (and rejected inbox) inside a run report."""
    out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in ("error", "rejected") and isinstance(v, str):
                out.append(f"{path or '(run)'}: {v}")
            else:
                out += _errors(v, f"{path}.{k}" if path else str(k))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            out += _errors(v, f"{path}[{i}]")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--day", type=date.fromisoformat, default=None)
    ap.add_argument("--with-x", action="store_true")
    ap.add_argument("--with-markets", action="store_true")
    args = ap.parse_args(argv)

    import time_machine

    from research_room.config import settings

    real = settings()
    day = args.day or real.season.first_game_date
    work = real.paths.db.resolve().parent / "dry-run"
    work.mkdir(parents=True, exist_ok=True)
    db = work / "research_room.duckdb"
    shutil.copy2(real.paths.db, db)
    read = real.paths.db.resolve().parent / "notifications_read.json"
    if read.exists():
        shutil.copy2(read, work / read.name)
    os.environ["RESEARCH_ROOM_DB"] = str(db)
    settings.cache_clear()

    from research_room import pipeline, store
    from research_room.ingest import x_feed, yahoo_api

    # Never touch the Yahoo sign-in: a refresh under the moved clock would write a future token
    # time into oauth2.json and keep an expired token in use until that date. The CSV inbox is used.
    yahoo_api.signed_in = lambda *a, **k: False

    cfg = settings()
    assert cfg.paths.db == db, "the dry run must never touch the real store"
    if not args.with_x:
        x_feed.poll = lambda con, cfg=None, **k: {"status": "skipped", "reason": "dry run: X stubbed"}
    if not args.with_markets:   # TheRundown and Kalshi bill by usage: a dry run never calls them
        pipeline.sync_markets = lambda con, cfg=None, day=None: {
            "status": "skipped",
            "reason": "dry run: markets stubbed",
        }

    night = datetime.combine(day - timedelta(days=1), time(23, 30), ET)
    pre = datetime.combine(day, time(17, 0), ET)
    print(f"dry run on a copy: {db}\n\n== nightly, {night:%a %b %-d %-I:%M %p} ET ==", flush=True)
    with time_machine.travel(night, tick=True):
        con = store.connect(db)
        try:
            nightly = pipeline.run_nightly(con, cfg)
        finally:
            con.close()
    print(f"\n== pre-game, {pre:%a %b %-d %-I:%M %p} ET ==", flush=True)
    with time_machine.travel(pre, tick=True):
        con = store.connect(db)
        try:
            pregame = pipeline.run_pregame(con, cfg)
        finally:
            con.close()

    con = store.connect(db, read_only=True)
    one = lambda sql, *p: con.execute(sql, list(p)).fetchone()[0]  # noqa: E731
    run = one("SELECT max(run_at) FROM projections WHERE model = 'baseline'")
    # Who must be projected: every ranked player (Basketball Monster's top `RANKED`) with a game.
    # The players table also lists fringe and long-gone players under a team; they don't count.
    ranked = con.execute(
        """SELECT DISTINCT e.player_id FROM external_projections e
           JOIN players p USING (player_id)
           JOIN games g ON p.team_id IN (g.home_team_id, g.visitor_team_id) AND g.game_date = ?
           WHERE e.snapshot = (SELECT max(snapshot) FROM external_projections) AND e.ext_rank <= ?""",
        [day, RANKED],
    ).fetchall()
    projected = {
        r[0]
        for r in con.execute(
            "SELECT DISTINCT player_id FROM projections WHERE model = 'baseline' AND run_at = ? AND date = ?",
            [run, day],
        ).fetchall()
    }
    missing = [r[0] for r in ranked if r[0] not in projected]
    ok, fail, wait = "ok", "FAIL", "WAIT"
    checks = [
        (
            "ranked players",
            ok if ranked and not missing else fail,
            f"{len(ranked) - len(missing)} of {len(ranked)} top-{RANKED} players with a game projected"
            + (f"; missing ids {missing[:10]}" if missing else ""),
        ),
    ]
    for name in cfg.models.shadow:
        n = one(
            "SELECT count(DISTINCT player_id) FROM projections WHERE model = ? AND run_at = ? AND date = ?",
            name,
            run,
            day,
        )
        checks.append(
            (
                f"shadow {name}",
                ok if n == len(projected) else fail,
                f"{n} of {len(projected)} players at the baseline's run time",
            )
        )

    def needs_inbox(step: dict | None) -> bool:  # waiting on the owner's Yahoo files, not broken
        return (
            isinstance(step, dict) and step.get("status") == "skipped" and "inbox" in str(step.get("reason"))
        )

    lineup, snap = nightly.get("lineup"), pregame.get("matchup")
    checks += [
        (
            "lineup decision",
            ok
            if one("SELECT count(*) FROM decisions_log WHERE kind = 'lineup'")
            else wait
            if needs_inbox(lineup)
            else fail,
            str(lineup)[:120],
        ),
        (
            "matchup snapshot",
            ok
            if one("SELECT count(*) FROM matchup_snapshots WHERE ts >= ?", night)
            else wait
            if needs_inbox(snap)
            else fail,
            str(snap)[:120],
        ),
        (
            "alerts ran",
            ok if isinstance(pregame.get("alerts"), dict) and not pregame["alerts"].get("errors") else fail,
            str(pregame.get("alerts"))[:120],
        ),
        (
            "scorecard ran",
            ok if isinstance(nightly.get("scorecard"), dict) and "counts" in nightly["scorecard"] else fail,
            str((nightly.get("scorecard") or {}).get("counts", nightly.get("scorecard")))[:120],
        ),
    ]
    con.close()
    print("\n== checks ==")
    for name, status, detail in checks:
        print(f"  {status:<4}  {name:<18} {detail}")
    errs = _errors(nightly) + _errors(pregame)
    print(f"\n== step errors ({len(errs)}) ==")
    for e in errs:
        print(f"  {e[:200]}")
    (work / "report.json").write_text(
        json.dumps({"nightly": nightly, "pregame": pregame}, indent=1, default=str)
    )
    print(f"\nfull reports: {work / 'report.json'}")
    waiting = [n for n, st, _ in checks if st == "WAIT"]
    if waiting:
        print(f"waiting on your Yahoo files (make inbox), not broken: {', '.join(waiting)}")
    return 0 if all(st != "FAIL" for _, st, _ in checks) else 1


if __name__ == "__main__":
    sys.exit(main())

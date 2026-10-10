"""Game-day dry run: the nightly and pre-game jobs end to end on a copy of the store, with the
clock set to a chosen game day. The real store is never written.

Usage: make dry-run                                  (opening night, settings.season.first_game_date)
       make dry-run ARGS="--day 2027-03-15"          (any game day)
       make dry-run ARGS="--days 3 --sample-rosters" (the opener rehearsal: three days in a row, with
                                                      a mock draft's rosters as my roster and this
                                                      week's opponent, entered as I would enter them)
       make dry-run ARGS="--with-x"                  (also reads X and calls the parser: paid)
       make dry-run ARGS="--with-markets"            (also pulls TheRundown and Kalshi lines: paid)

1. Copies the store (and the read state beside it) to data/dry-run/, and the inbox to
   data/dry-run/inbox (my roster and opponent entries are read and written there, never in the
   real inbox). With --sample-rosters, a mock draft (jobs/mock_draft.py, my slot) fills that copy.
2. The real schedule (make nightly-schedule, pregame-schedule): the nightly run the evening before
   the first DAY at 18:30 Eastern, then on each DAY the pre-game run at 17:00 and the nightly run
   at 18:30, which sets that evening's lineup. Feeds on: BallDontLie and the NBA injury report;
   the paid feeds, X and the betting markets, are stubbed unless asked for. Feeds can only return
   what exists today, so a future date's box scores or report are honestly absent; those steps
   must fail softly, not stop the night.
3. Yahoo is read from the CSV inbox only: the sign-in file is never refreshed or written.
4. Checks what a game day needs and prints ok, FAIL, or WAIT (waiting on the owner's Yahoo
   files, not broken) for each, then any step errors. The season pages (lineup, moves, weekly
   odds, alerts, my roster, Yahoo status) are read through the API at 18:00 and must answer.
5. With --days N, steps 2-4 repeat for N game days in a row (each night feeds the next day).
Needs the dev extra (time-machine) to move the clock.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from datetime import date, datetime, time, timedelta
from pathlib import Path
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
    ap.add_argument("--days", type=int, default=1)
    ap.add_argument("--sample-rosters", action="store_true")
    ap.add_argument("--with-x", action="store_true")
    ap.add_argument("--with-markets", action="store_true")
    args = ap.parse_args(argv)

    import time_machine

    from research_room.config import settings

    real = settings()
    first = args.day or real.season.first_game_date
    work = real.paths.db.resolve().parent / "dry-run"
    work.mkdir(parents=True, exist_ok=True)
    db = work / "research_room.duckdb"
    shutil.copy2(real.paths.db, db)
    read = real.paths.db.resolve().parent / "notifications_read.json"
    if read.exists():
        shutil.copy2(read, work / read.name)
    inbox = work / "inbox"
    shutil.rmtree(inbox, ignore_errors=True)
    if real.paths.inbox_dir.exists():
        shutil.copytree(real.paths.inbox_dir, inbox)
    inbox.mkdir(exist_ok=True)
    os.environ["RESEARCH_ROOM_DB"] = str(db)
    os.environ["RESEARCH_ROOM_INBOX"] = str(inbox)
    settings.cache_clear()

    from research_room import pipeline
    from research_room.ingest import x_feed, yahoo_api

    # Never touch the Yahoo sign-in: a refresh under the moved clock would write a future token
    # time into oauth2.json and keep an expired token in use until that date. The CSV inbox is used.
    yahoo_api.signed_in = lambda *a, **k: False

    cfg = settings()
    assert cfg.paths.db == db, "the dry run must never touch the real store"
    assert cfg.paths.inbox_dir == inbox, "the dry run must never touch the real inbox"
    if not args.with_x:
        x_feed.poll = lambda con, cfg=None, **k: {"status": "skipped", "reason": "dry run: X stubbed"}
    if not args.with_markets:  # TheRundown and Kalshi bill by usage: a dry run never calls them
        pipeline.sync_markets = lambda con, cfg=None, day=None, **k: {
            "status": "skipped",
            "reason": "dry run: markets stubbed",
        }
    print(f"dry run on a copy: {db}", flush=True)
    if args.sample_rosters:
        with time_machine.travel(datetime.combine(first, time(12, 0), ET), tick=True):
            print(sample_rosters(cfg))

    days = [first + timedelta(days=i) for i in range(max(1, args.days))]
    reports, failed = {}, False
    for i, day in enumerate(days):
        checks, errs, report = run_day(day, cfg, db, time_machine, first=i == 0)
        reports[str(day)] = report
        print(f"\n== checks, {day:%a %b %-d} ==")
        for name, status, detail in checks:
            print(f"  {status:<4}  {name:<18} {detail}")
        print(f"\n== step errors ({len(errs)}) ==")
        for e in errs:
            print(f"  {e[:200]}")
        failed |= any(st == "FAIL" for _, st, _ in checks)
        waiting = [n for n, st, _ in checks if st == "WAIT"]
        if waiting:
            print(
                f"waiting on your roster and opponent (Team → My roster, Teams → This week's opponent), "
                f"not broken: {', '.join(waiting)}"
            )
    (work / "report.json").write_text(json.dumps(reports, indent=1, default=str))
    print(f"\nfull reports: {work / 'report.json'}")
    return 1 if failed else 0


def sample_rosters(cfg) -> str:
    """A mock draft at my slot; my picks become My roster and another team's this week's opponent,
    saved the way the app saves them (in the dry run's inbox copy)."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))   # run as a script: find jobs/
    from jobs.mock_draft import run_mock
    from research_room import opponent_roster, store

    slot = cfg.draft.my_slot or 6
    res = run_mock(teams=cfg.league.teams, slot=slot, seed=1)
    other = next(s for s in range(1, cfg.league.teams + 1) if s != slot)
    opp_team = next(t for t in range(1, cfg.league.teams + 1) if t != cfg.league.my_team_id)
    con = store.connect(cfg.paths.db)
    try:
        mine = opponent_roster.save_mine(con, res["rosters"][slot], [], [], cfg)
        opp = opponent_roster.save(con, opp_team, res["rosters"][other], [], cfg)
    finally:
        con.close()
    return (f"sample rosters from a mock draft at slot {slot}: my roster {len(mine['players'])} players, "
            f"this week's opponent (team {opp_team}) {len(opp['players'])} players")


PAGES = (
    "/season/lineup", "/season/moves", "/season/week/probability", "/season/notifications",
    "/season/my_roster", "/season/opponent_roster", "/system/yahoo",
)


def pages(db, at: datetime) -> list[tuple[str, str, str]]:
    """The season pages through the API at `at`: each must answer (409 = waiting on my entries)."""
    from fastapi.testclient import TestClient

    from research_room import api

    client = TestClient(api.create_app(db_path=str(db), run_mock_thread=False))
    out = []
    for path in PAGES:
        t = datetime.now()
        r = client.get(path, params={"now": at.isoformat()} if path.startswith("/season/") else None)
        ms = (datetime.now() - t).total_seconds() * 1000
        detail = f"HTTP {r.status_code}, {ms:.0f} ms"
        if r.status_code != 200:
            detail += f": {r.text[:100]}"
        status = "ok" if r.status_code == 200 else "WAIT" if r.status_code == 409 else "FAIL"
        out.append((f"page {path.rsplit('/', 1)[-1]}", status, detail))
    return out


NIGHTLY_AT, PREGAME_AT = time(18, 30), time(17, 0)   # Eastern: jobs/nightly.py, jobs/pregame.py


def _at(when: datetime, label: str, fn, cfg, db, time_machine):
    from research_room import store

    print(f"\n== {label}, {when:%a %b %-d %-I:%M %p} ET ==", flush=True)
    with time_machine.travel(when, tick=True):
        con = store.connect(db)
        try:
            return fn(con, cfg)
        finally:
            con.close()


def run_day(day: date, cfg, db, time_machine, first: bool = False):
    """One game day on the real schedule (the evening before as well, for the first day), then the
    checks and the season pages."""
    from research_room import pipeline

    report = {}
    if first:
        before = datetime.combine(day - timedelta(days=1), NIGHTLY_AT, ET)
        report["nightly_before"] = _at(before, "nightly", pipeline.run_nightly, cfg, db, time_machine)
    pre = datetime.combine(day, PREGAME_AT, ET)
    pregame = _at(pre, "pre-game", pipeline.run_pregame, cfg, db, time_machine)
    night = datetime.combine(day, NIGHTLY_AT, ET)
    nightly = _at(night, "nightly", pipeline.run_nightly, cfg, db, time_machine)
    report.update(pregame=pregame, nightly=nightly)
    checks = day_checks(day, cfg, db, pre, nightly, pregame)
    at = datetime.combine(day, time(18, 45), ET)
    with time_machine.travel(at, tick=True):
        checks += pages(db, at)
    return checks, _errors(report), report


def day_checks(day, cfg, db, night, nightly, pregame) -> list[tuple[str, str, str]]:
    from research_room import store

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

    def needs_inbox(step: dict | None) -> bool:  # waiting on the owner's roster or opponent, not broken
        reason = str(step.get("reason")) if isinstance(step, dict) else ""
        waits = ("inbox", "My roster", "This week's opponent", "sign in to Yahoo")
        return isinstance(step, dict) and step.get("status") == "skipped" and any(w in reason for w in waits)

    lineup, snap = nightly.get("lineup"), pregame.get("matchup")
    checks += [
        (
            "lineup decision",
            ok
            if isinstance(lineup, dict) and str(lineup.get("day")) == str(day)
            and lineup.get("status") == "optimal"
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
    return checks


if __name__ == "__main__":
    sys.exit(main())

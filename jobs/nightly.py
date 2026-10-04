"""Nightly job: ingest -> features -> projections -> lineup, then Parquet export.

Inputs/outputs: see research_room.pipeline.run_nightly. Usage:
  make nightly                      run once now
  .venv/bin/python jobs/nightly.py --schedule   stay running; run daily at 18:30 local (apscheduler)
Cron alternative (README): 30 18 * * * cd <repo> && make nightly >> data/nightly.log 2>&1
"""

from __future__ import annotations

import argparse
import sys
import time

from research_room import pipeline, store


def run_once(sync: bool = True) -> int:
    started = time.monotonic()
    con = store.connect()
    try:
        report = pipeline.run_nightly(con, sync=sync)
    finally:
        con.close()
    print(f"nightly done in {time.monotonic() - started:.0f}s; lineup: {report['lineup'].get('status')}"
          f" {report['lineup'].get('reason') or ''}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--schedule", action="store_true", help="run daily at 18:30 local time")
    parser.add_argument("--no-sync", action="store_true", help="skip the BallDontLie pull")
    args = parser.parse_args(argv)
    if not args.schedule:
        return run_once(sync=not args.no_sync)
    from apscheduler.schedulers.blocking import BlockingScheduler
    sched = BlockingScheduler()
    sched.add_job(run_once, "cron", hour=18, minute=30, kwargs={"sync": not args.no_sync},
                  id="nightly", max_instances=1, coalesce=True)
    print("scheduled: nightly at 18:30 local; Ctrl+C to stop")
    sched.start()
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Pre-game refresh: X news, BallDontLie injuries, markets, today's projections, a matchup snapshot.

Usage:
  make pregame              run once now
  make pregame-schedule     stay running; on game days, every settings.x_feed.poll_minutes during the
                            window_hours_before_tip before the day's first tip
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timedelta

import pandas as pd

from research_room import pipeline, store
from research_room.config import settings
from research_room.ingest.market_common import ET


def first_tip(day) -> datetime | None:
    con = store.connect(read_only=True)
    try:
        v = con.execute(
            "SELECT min(tip_utc) FROM games WHERE game_date = ? AND NOT coalesce(postseason, false)", [day]
        ).fetchone()[0]
    finally:
        con.close()
    return pd.Timestamp(v).tz_convert(ET).to_pydatetime() if v is not None else None


def run_once() -> int:
    con = store.connect()
    try:
        report = pipeline.run_pregame(con)
    finally:
        con.close()
    print({k: v for k, v in report.items() if k != "timings_s"})
    return 0


def schedule() -> int:
    xf = settings().x_feed
    print(
        f"pregame: polling every {xf.poll_minutes} min in the {xf.window_hours_before_tip} h before each "
        "game day's first tip (Ctrl+C to stop)"
    )
    while True:
        now = datetime.now(ET)
        tip = first_tip(now.date())
        if tip and tip - timedelta(hours=xf.window_hours_before_tip) <= now <= tip:
            run_once()
            time.sleep(xf.poll_minutes * 60)
        else:
            time.sleep(min(30 * 60, xf.poll_minutes * 60))


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument(
        "--schedule", action="store_true", help="stay running and poll before each game day's first tip"
    )
    a = p.parse_args(argv)
    return schedule() if a.schedule else run_once()


if __name__ == "__main__":
    sys.exit(main())

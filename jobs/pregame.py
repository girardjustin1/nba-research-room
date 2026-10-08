"""Pre-game refresh: X news, BallDontLie injuries, markets, today's projections, a matchup snapshot.

Usage:
  make pregame              run once now
  make pregame-schedule     stay running; on game days, every settings.x_feed.poll_minutes from
                            window_hours_before_tip before the day's first tip until its last tip
                            (late games get their news too; the X read budget still caps reads)
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


def tip_range(day) -> tuple[datetime, datetime] | None:
    """(first tip, last tip) of the day's games, Eastern; None without games."""
    con = store.connect(read_only=True)
    try:
        a, b = con.execute(
            "SELECT min(tip_utc), max(tip_utc) FROM games "
            "WHERE game_date = ? AND NOT coalesce(postseason, false) AND NOT coalesce(postponed, false)",
            [day],
        ).fetchone()
    finally:
        con.close()
    if a is None:
        return None
    return pd.Timestamp(a).tz_convert(ET).to_pydatetime(), pd.Timestamp(b).tz_convert(ET).to_pydatetime()


def in_window(now: datetime, tips: tuple[datetime, datetime] | None, hours_before: float) -> bool:
    """From `hours_before` the first tip until the last tip (audit B06: not only the first)."""
    return bool(tips) and tips[0] - timedelta(hours=hours_before) <= now <= tips[1]


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
        f"pregame: polling every {xf.poll_minutes} min from {xf.window_hours_before_tip} h before each "
        "game day's first tip until its last tip (Ctrl+C to stop)"
    )
    while True:
        now = datetime.now(ET)
        if in_window(now, tip_range(now.date()), xf.window_hours_before_tip):
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

"""Print the live scoreboard: what the app said before each game, graded against what happened.

Usage: make scoreboard-live            (season to date; grades any finished days first)
       make scoreboard-live ARGS="--days 7"   (the last 7 days)
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import timedelta

import pandas as pd

from research_room import live_scores, store
from research_room.config import settings


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=None)
    args = ap.parse_args()
    cfg = settings()
    con = store.connect()
    try:
        print(json.dumps(live_scores.update(con, cfg), default=str))
        today = pd.Timestamp.now(tz="America/New_York").date()
        since = today - timedelta(days=args.days) if args.days else None
        print(json.dumps(live_scores.summary(con, cfg, since), indent=2, default=str))
    finally:
        con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Store past seasons' NBA injury reports, as published before tip (for the news backtest).

Usage: make report-backfill SEASONS="2025"   (about 2 minutes a season; resumable: a stored
report is skipped)

Each regular-season game day: the noon report when a game tips before 5:30 PM Eastern, then the
5 PM report. Names are resolved without adding misses to the review queue.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, time

import pandas as pd

from research_room import store
from research_room.config import settings
from research_room.ingest import nba_injury_report as nr
from research_room.ingest.market_common import ET, RateLimited


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", nargs="+", type=int, required=True)
    args = ap.parse_args()
    cfg = settings()
    con = store.connect()
    client = RateLimited(cfg.nba_report.requests_per_second, headers={"User-Agent": "Mozilla/5.0"})
    days = con.execute("""
        SELECT game_date, min(tip_utc) AS first_tip FROM games
        WHERE season IN (SELECT unnest(?)) AND NOT coalesce(postseason, false) AND tip_utc IS NOT NULL
        GROUP BY 1 ORDER BY 1
    """, [args.seasons]).df()
    counts = {"ok": 0, "unchanged": 0, "skipped": 0, "error": 0}
    for i, r in enumerate(days.itertuples(index=False)):
        day = pd.Timestamp(r.game_date).date()
        first = pd.Timestamp(r.first_tip).tz_convert(ET)
        moments = [time(17, 10)]
        if first.hour * 60 + first.minute < 17 * 60 + 30:
            moments.insert(0, time(12, 10))
        for t in moments:
            out = nr.sync(con, cfg, client, now=datetime.combine(day, t, ET), record_names=False)
            counts[out["status"] if out["status"] in counts else "error"] += 1
        if i % 20 == 0:
            print(f"{day}: {counts}", flush=True)
    con.close()
    print(f"done: {counts} over {len(days)} game days")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Replay the latest backfilled season day by day with game-day news (see research_room.backtest_news).

Usage: make backtest-news   (needs `make report-backfill SEASONS="<season>"` first; prints the summary)
"""

from __future__ import annotations

import json
import sys

from research_room import backtest_news, store


def main() -> int:
    con = store.connect(read_only=True)
    try:
        _, summary = backtest_news.run_from_store(con)
    finally:
        con.close()
    print(json.dumps(summary, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())

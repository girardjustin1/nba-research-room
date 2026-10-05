"""Replay the latest backfilled season week by week (see research_room.backtest).

Usage: make backtest   (about 5-10 minutes; writes backtest_results and prints the summary)
"""

from __future__ import annotations

import json
import sys

from research_room import backtest, store


def main() -> int:
    con = store.connect()
    try:
        res, summary = backtest.run_from_store(con)
        backtest.write(con, res)
    finally:
        con.close()
    print(json.dumps(summary, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())

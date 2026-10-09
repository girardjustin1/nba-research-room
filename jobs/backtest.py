"""Replay the latest backfilled season week by week (see research_room.backtest).

Usage: make backtest   (about 5-10 minutes; writes backtest_results and prints the summary)
       make backtest ARGS=--opponent-streams   (the opponent streams by streaming.py's rule,
       whatever settings.opponent.streaming says; about twice as long: two plans a matchup)
"""

from __future__ import annotations

import json
import sys

from research_room import backtest, store


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    streams = True if "--opponent-streams" in argv else None
    con = store.connect()
    try:
        res, summary = backtest.run_from_store(con, opponent_streams=streams)
        backtest.write(con, res)
    finally:
        con.close()
    print(json.dumps(summary, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())

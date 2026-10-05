"""Archive betting markets now: Kalshi player-prop ladders and game markets, TheRundown sportsbook
lines and props (see research_room.ingest.kalshi / rundown). Nightly runs this too; run it by hand
before tip on game days for fresher prop ladders.

Usage: make markets
"""

from __future__ import annotations

import json
import sys

from research_room import pipeline, store
from research_room.config import settings


def main() -> int:
    con = store.connect()
    try:
        out = pipeline.sync_markets(con, settings())
    finally:
        con.close()
    print(json.dumps(out, indent=2))
    return 1 if all("error" in v for v in out.values()) else 0


if __name__ == "__main__":
    sys.exit(main())

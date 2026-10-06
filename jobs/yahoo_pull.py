"""Read every Yahoo snapshot from the API into the store (read only): teams, all rosters, free
agents, this week's matchup totals, draft picks.

Usage: make yahoo-pull   (needs `make yahoo-auth` once; the nightly run does this automatically
once signed in)
"""

from __future__ import annotations

import json
import sys

from research_room import store
from research_room.config import settings
from research_room.ingest import yahoo, yahoo_api


def main() -> int:
    cfg = settings()
    if not yahoo_api.signed_in():
        print("Not signed in to Yahoo yet: run `make yahoo-auth` in your terminal first.")
        return 1
    backend = yahoo_api.auto_backend(cfg)
    con = store.connect()
    try:
        counts = yahoo.ingest_inbox(con, backend=backend, cfg=cfg)
    finally:
        con.close()
    print(json.dumps(counts))
    return 0


if __name__ == "__main__":
    sys.exit(main())

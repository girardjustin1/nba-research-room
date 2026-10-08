"""Check the Yahoo API read end to end (read only): load every part live into memory, print what
came back, keep nothing.

Usage: make yahoo-pull   (needs `make yahoo-auth` once). Nothing is stored: Yahoo Fantasy
information is read live by each job and page (ingest/yahoo_live.py).
"""

from __future__ import annotations

import json
import sys

from research_room import store
from research_room.config import settings
from research_room.ingest import yahoo_api, yahoo_live


def main() -> int:
    cfg = settings()
    if not yahoo_api.signed_in():
        print("Not signed in to Yahoo yet: run `make yahoo-auth` in your terminal first.")
        return 1
    con = store.connect(read_only=True)
    try:
        out = yahoo_live.attach(con, cfg, show_names=True)
    finally:
        con.close()                      # the in-memory Yahoo tables go with it
    print(json.dumps(out, indent=1))
    return 0 if out["source"] == "api" else 1


if __name__ == "__main__":
    sys.exit(main())

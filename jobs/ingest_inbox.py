"""Load Yahoo CSV snapshots from data/inbox/ into the store.

Inputs: data/inbox/{roster,players,matchup,draft_results}.csv; with --from-downloads, any of
those files in ~/Downloads that are newer than the inbox copy are moved in first.
Outputs: yahoo_* tables, draft_picks, player_xref, unresolved_names.
Tables: see research_room.ingest.yahoo.ingest_inbox.

Usage: `make inbox` or `.venv/bin/python jobs/ingest_inbox.py --from-downloads`.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

from research_room import store
from research_room.config import settings
from research_room.ingest import yahoo


def pull_from_downloads(inbox: Path, downloads: Path) -> list[str]:
    """Move newer copies of the expected CSVs from `downloads` into `inbox`."""
    moved = []
    inbox.mkdir(parents=True, exist_ok=True)
    for name in yahoo.SCHEMAS:
        src, dst = downloads / f"{name}.csv", inbox / f"{name}.csv"
        if src.exists() and (not dst.exists() or src.stat().st_mtime > dst.stat().st_mtime):
            shutil.move(str(src), str(dst))
            moved.append(dst.name)
    return moved


def main(argv: list[str] | None = None) -> int:
    cfg = settings()
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--from-downloads", action="store_true",
                        help="first move newer roster/players/matchup/draft_results CSVs from ~/Downloads")
    args = parser.parse_args(argv)
    if args.from_downloads:
        moved = pull_from_downloads(cfg.paths.inbox_dir, Path.home() / "Downloads")
        print(f"moved from Downloads: {moved or 'nothing newer'}")
    con = store.connect()
    try:
        counts = yahoo.ingest_inbox(con)
    except yahoo.YahooCsvError as exc:
        print(f"REJECTED, nothing written: {exc}", file=sys.stderr)
        return 1
    unresolved = con.execute("SELECT count(*) FROM unresolved_names WHERE source = 'yahoo'").fetchone()[0]
    print(f"ingested: {counts or 'no files in inbox'}; names in quarantine: {unresolved}")
    con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

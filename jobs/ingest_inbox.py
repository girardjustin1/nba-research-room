"""Check the Yahoo CSV exports in data/inbox/: validate them, match the names, report.

Inputs: data/inbox/{teams,roster,players,matchup}.csv; with --from-downloads, any of those files in
~/Downloads that are newer than the inbox copy are moved in first.
Outputs: a printed report (rows per file, names that didn't match). Nothing is written to the
store: every job and page reads the files live (ingest/yahoo_live.py).

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
                        help="first move newer inbox CSVs (teams, roster, ...) from ~/Downloads")
    args = parser.parse_args(argv)
    if args.from_downloads:
        moved = pull_from_downloads(cfg.paths.inbox_dir, Path.home() / "Downloads")
        print(f"moved from Downloads: {moved or 'nothing newer'}")
    con = store.connect(read_only=True)
    try:
        out = yahoo.load_live(con, yahoo.CsvBackend(cfg.paths.inbox_dir), cfg, show_names=True)
    except yahoo.YahooCsvError as exc:
        print(f"REJECTED: {exc}", file=sys.stderr)
        return 1
    finally:
        con.close()
    print(f"read: {out['loaded'] or 'no files in inbox'}; names that didn't match: {out['unresolved']}")
    for line in out.get("unresolved_names", []):
        print(f"  {line}  (add it to config/aliases.yaml)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

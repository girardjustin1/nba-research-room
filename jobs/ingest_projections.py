"""Load the newest Basketball Monster projection exports from reference/ into the store.

Inputs: the newest raw-totals CSV ("Export to CSV") and newest .xls ("Export to Excel") under
reference/, or explicit --csv/--xls paths. Outputs: external_projections; unmatched names go to
the quarantine. Tables: see research_room.ingest.external_proj.ingest_bbm.

Usage: `make projections`.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from research_room import store
from research_room.ingest import external_proj


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--csv", type=Path, help="Basketball Monster 'Export to CSV' file")
    parser.add_argument("--xls", type=Path, help="Basketball Monster 'Export to Excel' file")
    args = parser.parse_args(argv)
    csv, xls = (args.csv, args.xls) if args.csv and args.xls else external_proj.find_latest()
    print(f"csv: {csv}\nxls: {xls}")
    con = store.connect()
    try:
        counts = external_proj.ingest_bbm(con, csv, xls)
    except external_proj.ProjectionFileError as exc:
        print(f"REJECTED: {exc}", file=sys.stderr)
        return 1
    print(f"loaded: {counts}")
    pool = external_proj.blend_preseason(con)
    print(f"draft pool: {len(pool)} players; sources {pool['sources'].value_counts().to_dict()}")
    con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

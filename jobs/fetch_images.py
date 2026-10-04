"""Cache player headshots and team logos from the NBA's public CDN into data/images/.

Inputs: external_projections (latest Basketball Monster snapshot, with NBA ids),
config/nba_teams.yaml. Outputs: data/images/ (gitignored). Tables: reads external_projections.
Personal use only; the images are never committed. Usage: `make images` (add --refresh to
re-download everything, e.g. after trades).
"""

from __future__ import annotations

import argparse
import sys

from research_room import images, store


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--refresh", action="store_true", help="re-download images already cached")
    args = parser.parse_args(argv)
    con = store.connect(read_only=True)
    try:
        counts = images.fetch_all(con, refresh=args.refresh)
    finally:
        con.close()
    print(f"images -> {images.IMAGE_DIR}: {counts}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

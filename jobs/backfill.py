"""Backfill historical seasons from BallDontLie into the store, then export Parquet.

Inputs: BDL_API_KEY (.env), settings.bdl.backfill_seasons (or --seasons).
Outputs: teams, players, games (history + the upcoming season's schedule), game_logs,
advanced_stats; Parquet copies in data/parquet/.
Tables: see research_room.ingest.bdl.backfill.

Resumable: re-running replays pages already cached in api_responses and only requests the
rest. Usage: `make backfill` or `.venv/bin/python jobs/backfill.py --seasons 2023 2024 2025`.
"""

from __future__ import annotations

import argparse
import sys
import time

from research_room import store
from research_room.config import settings
from research_room.ingest import bdl


def main(argv: list[str] | None = None) -> int:
    cfg = settings()
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--seasons", type=int, nargs="+", default=cfg.bdl.backfill_seasons,
                        help="BDL season start years, e.g. 2023 2024 2025")
    parser.add_argument("--no-schedule", action="store_true",
                        help=f"skip the {cfg.season.nba_season} schedule pull")
    args = parser.parse_args(argv)

    started = time.monotonic()
    con = store.connect()
    client = bdl.BdlClient.from_env()
    schedule = None if args.no_schedule else cfg.season.nba_season
    print(f"backfill seasons={args.seasons} schedule={schedule} -> {cfg.paths.db}", flush=True)
    counts = bdl.backfill(con, client, args.seasons, schedule_season=schedule,
                          echo=lambda m: print(m, flush=True))
    paths = store.export_parquet(con)
    print(f"parquet: {len(paths)} files -> {cfg.paths.parquet_dir}")
    print(f"done in {time.monotonic() - started:.0f}s, {client.requests_made} requests, "
          f"{sum(counts.values())} rows written")
    print(store.table_counts(con).to_string(index=False))
    con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Delete every Yahoo Fantasy item on this machine: for ending Yahoo API use.

Usage: make yahoo-purge            (asks first)
       make yahoo-purge ARGS="--yes"

Removes, from the store: any stored Yahoo table and Yahoo name matches, and every analysis made
from Yahoo data (week_outcomes, saved_plans, matchup_snapshots, decisions_log, notifications and their read
state, draft_picks, draft_teams). From disk: the Yahoo CSV exports in data/inbox and the Yahoo
sign-in file (oauth2.json). Projections, models and NBA data are kept: they never used Yahoo data.
Prints what it removed.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from research_room import store
from research_room.config import REPO_ROOT, settings
from research_room.ingest import yahoo

ANALYSES = (
    "week_outcomes",
    "saved_plans",
    "matchup_snapshots",
    "decisions_log",
    "notifications",
    "draft_picks",
    "draft_teams",
)


def purge(con, cfg, root: Path = REPO_ROOT) -> dict:
    out = {f"stored {k}": v for k, v in store.purge_stored_yahoo(con).items()}
    for table in ANALYSES:
        out[table] = con.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        con.execute(f"DELETE FROM {table}")
    files = [cfg.paths.inbox_dir / f"{n}.csv" for n in yahoo.SCHEMAS]
    files += [cfg.paths.inbox_dir / f for f in ("opponent.json", "league_teams.json", "my_roster.json")]
    files += [cfg.paths.db.resolve().parent / "notifications_read.json", root / "oauth2.json"]
    for f in files:
        if f.exists():
            f.unlink()
            out[str(f.relative_to(root)) if f.is_relative_to(root) else str(f)] = "deleted"
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true", help="don't ask")
    args = ap.parse_args(argv)
    if not args.yes:
        answer = input(
            "Delete all Yahoo data, every analysis made from it, the CSV exports and the "
            "Yahoo sign-in? Type 'delete' to go on: "
        )
        if answer.strip().lower() != "delete":
            print("Nothing deleted.")
            return 1
    cfg = settings()
    con = store.connect()
    try:
        out = purge(con, cfg)
    finally:
        con.close()
    for k, v in out.items():
        print(f"  {k}: {v}")
    print("Done. Yahoo sign-in removed: run `make yahoo-auth` again only if API use resumes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

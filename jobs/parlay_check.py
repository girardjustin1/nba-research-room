"""Check ParlayAPI before a backtest: the key, the plan, and one day of NBA prop closing lines.

Usage: make parlay-check                         (key check + last season's sample day)
       make parlay-check ARGS="--day 2026-01-15"  (another UTC day)

Prints the plan and credit headroom (the free key check), then for one day: rows delivered, the
credits it cost, rows per stat and per book after the filters (ingest/parlay.py), and how many
rungs matched a game and a player in the store. The response is cached under
data/props_test/parlay_cache, so the props test reads it again for free. Changes nothing else;
never prints the key.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd  # noqa: E402

from jobs.props_test import ParlayArchive, match_players  # noqa: E402
from research_room import store  # noqa: E402
from research_room.config import settings  # noqa: E402
from research_room.ingest import parlay  # noqa: E402
from research_room.ingest.market_common import GameIndex  # noqa: E402

SAMPLE_DAY = "2026-05-10"      # a playoff day: ParlayAPI's NBA book lines begin 2026-04-25


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--day", default=SAMPLE_DAY, help="UTC day to sample (YYYY-MM-DD)")
    args = ap.parse_args(argv)
    cfg = settings()
    pc = cfg.markets.parlay
    try:
        client = parlay.Client(pc)
    except RuntimeError as e:
        print(f"FAIL  {e}: paste the key after PARLAY_API_KEY= in .env and save")
        return 1
    check = client.key_check()
    if not check.get("valid"):
        print(f"FAIL  key check: {check.get('reason')} {check.get('message', '')}")
        return 1
    print("ok    key check: " + ", ".join(f"{k}={v}" for k, v in check.items() if k != "valid"))

    root = cfg.paths.db.resolve().parent / "props_test"
    arch = ParlayArchive(client, root / "parlay_cache")
    body = arch.day(args.day)
    raw = len(body.get("rows") or [])
    print(f"ok    {args.day}: {raw} rows delivered ({client.credits} credits this run; a cached day costs 0)")
    if raw >= parlay.ROW_LIMIT:
        print(f"WARN  the day hit the {parlay.ROW_LIMIT}-row limit: some rows may be missing")
    all_rows = pd.DataFrame(body.get("rows") or [])
    if not all_rows.empty:
        nba = all_rows[all_rows["market_key"].astype(str).str.startswith("player_")]
        print("      every source (before filters): "
              + ", ".join(f"{s} {n}" for s, n in nba["source"].value_counts().items()))
    rows = parlay.parse_closing(body, pc)
    if rows.empty:
        print("FAIL  no usable two-way prop closing lines that day")
        return 1
    counts = lambda col: ", ".join(f"{s} {n}" for s, n in col.value_counts().items())  # noqa: E731
    print("      usable rows per stat: " + counts(rows["stat"]))
    print("      usable rows per book: " + counts(rows["source"]))

    con = store.connect(read_only=True)
    try:
        tips = dict(con.execute("SELECT game_id, tip_utc FROM games WHERE tip_utc IS NOT NULL").fetchall())
        r = parlay.rungs(rows, GameIndex(con), parlay.team_codes(con), tips, pc.max_quote_age_hours)
        r = match_players(con, r)
    finally:
        con.close()
    if r.empty:
        print("FAIL  no rung matched a game in the store (team names or dates?)")
        return 1
    matched = r["player_id"].notna()
    print(f"ok    rungs: {len(r)} in {r['game_id'].nunique()} games; players matched {int(matched.sum())} "
          f"of {len(r)} ({matched.mean():.0%})")
    print("      rungs per stat: " + counts(r.loc[matched, "stat"])
          + f"; books per rung: median {r['n_books'].median():.0f}")
    missed = r.loc[~matched, "player_name"].drop_duplicates().head(8).tolist()
    if missed:
        print("      unmatched names (first few): " + ", ".join(missed))
    per_day = max(1, -(-raw // 1000))
    print(f"\nA season is about 170 days like this one: roughly {170 * per_day:,} credits "
          f"({per_day} a day, 1 per 1,000 rows).")
    return 0


if __name__ == "__main__":
    sys.exit(main())

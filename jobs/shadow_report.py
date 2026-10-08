"""Shadow models against the baseline, game by game, season to date (read only).

Usage: make shadow-report   (each shadow in settings.models.shadow; see research_room/shadow.py)
"""

from __future__ import annotations

import sys

import pandas as pd

from research_room import live_scores, shadow, store
from research_room.config import settings


def main() -> int:
    cfg = settings()
    con = store.connect(read_only=True)
    try:
        start = cfg.season.first_game_date
        end = pd.Timestamp.now(tz="America/New_York").date()
        base = live_scores.graded_rows(con, start, end)
        for name in cfg.models.shadow:
            table = shadow.compare(base, live_scores.graded_rows(con, start, end, model=name))
            print(f"\n{name} vs baseline, {start} to {end} (negative is better for {name}):")
            if table.empty:
                print("  nothing graded yet")
                continue
            for r in table.itertuples():
                lo, hi = r.mae_change_95
                print(
                    f"  {r.stat:<8} n {r.n:>6}  average miss {r.mae_change_pct:+.2f}% [{lo:+.2f}, {hi:+.2f}]"
                    f"  RMSE {r.rmse_change_pct:+.2f}%  ({r.days} days)"
                )
    finally:
        con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

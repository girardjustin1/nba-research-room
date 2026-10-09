"""The X forward test: this season's game days replayed with and without X statuses (read only).

Usage: make x-forward-test                                  (this season, through yesterday)
       make x-forward-test ARGS="--through 2026-11-15"      (stop at a day)
       make x-forward-test ARGS="--force"                   (replay before there is enough data;
                                                             numbers only, never a verdict)

The rule, written in DECISIONS.md before opening night ("In-season scorecard and the forward
tests"): replay the season's game days from the stored inputs twice, with and without X statuses in
the overrides (the NBA report and BallDontLie only), paired by player-game. Primary: the P(plays)
Brier on player-games where X gave a status is lower with X, its 95% range (resampling days) below
zero. Guard: the points average miss is not worse. Pass: X keeps its place. Primary not met: X
drops below the NBA injury report in the authority order. Worse with X (range above zero): X is
switched off until fixed. Only what was known at each decision time counts. No verdict before
3 weeks and 150 X statuses tied to a game (settings.x_forward_test).
Reads the store only (no network); prints the verdict, and saves data/x_forward_test/<date>/.
Changes nothing: acting on the verdict (the authority order in settings.yaml) is done by hand.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date

from research_room import backtest_news, store
from research_room.config import settings


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--through", type=date.fromisoformat, help="last game day replayed (default: yesterday)")
    ap.add_argument("--season", type=int, help="BallDontLie season (default: settings season.nba_season)")
    ap.add_argument("--force", action="store_true", help="replay without enough data (no verdict)")
    args = ap.parse_args(argv)
    cfg = settings()
    echo = lambda m: print(m, flush=True)  # noqa: E731
    con = store.connect(read_only=True)
    try:
        pg, summary = backtest_news.x_forward_test(
            con, cfg, through=args.through, season=args.season, force=args.force, echo=echo
        )
    finally:
        con.close()
    echo(
        f"\nseason {summary['season']}: {summary['game_days']} finished game days "
        f"({summary['first_day']} to {summary['last_day']}), "
        f"{summary['x_statuses_tied']} X statuses tied to a game"
    )
    if "primary" in summary:
        g = summary["guard"]
        echo(f"player-games graded: {summary['player_games']}, X gave a status on "
             f"{summary['x_player_games']} ({summary['x_carried_only']} carried only), "
             f"X decided {summary['decided_by_x']}")
        p = summary["primary"]
        if p:
            echo(f"P(plays) Brier where X spoke: with X {p['brier_with_x']:.4f}, "
                 f"without {p['brier_without_x']:.4f}")
            echo(f"  with - without {p['diff']:+.4f}  95% [{p['range'][0]:+.4f}, {p['range'][1]:+.4f}]  "
                 f"primary {'met' if p['met'] else 'not met'}")
        echo(f"points average miss, every player-game: with X {g['points_miss_with_x']:.3f}, "
             f"without {g['points_miss_without_x']:.3f}")
        echo(f"  with - without {g['diff']:+.4f}  95% [{g['range'][0]:+.4f}, {g['range'][1]:+.4f}]  "
             f"guard {'met' if g['met'] else 'not met'}")
    echo(f"verdict: {summary['verdict_line']}")
    out = cfg.paths.db.resolve().parent / "x_forward_test" / date.today().isoformat()
    out.mkdir(parents=True, exist_ok=True)
    if not pg.empty:
        pg.to_csv(out / "player_games.csv", index=False)
    (out / "summary.json").write_text(json.dumps(summary, indent=1, default=str))
    echo(f"saved to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""In-season scorecard: the live scoreboard held to rules written before the season.

Inputs: live_scores.summary (season to date), settings.scorecard. Outputs: one check per row
{area, item, value, reference, status, action}; status is ok, watch, act or not_enough (too few
games to judge yet). Tables: none written; reads live_scores, live_news_scores, matchup_snapshots.

The rules and why each threshold is where it is: DECISIONS.md, "In-season scorecard". Checks:
- projections, per stat, on every projected player-game (`all`): the average miss against the
  baseline's on 2025-26 without game-day news (live has the news, so it should do no worse), the
  lean as a share of that miss, and the share of outcomes inside the 80% band against the share
  then (small whole-number stats sit above 0.80 by construction, so each stat has its own).
- P(plays): mean P(plays) minus the share who played.
- news: for each source and status with enough listings, the share who played against the
  P(plays) assumed for that status.
- weekly odds: the Brier score of my matchup's odds, only after `min_weeks` results.
"""

from __future__ import annotations

import duckdb

from research_room import live_scores
from research_room.config import Settings, settings

ACTIONS = {
    "mae": "Find where the misses come from (segment, stat, player type) before changing the model.",
    "bias": "Projections lean one way: check minutes first (the usual cause), then that stat's rate.",
    "coverage": "Bands are off: refit that stat's spread (phi) on this season's games.",
    "p_play": "P(plays) leans one way: refit the play-rate and status probabilities.",
    "news": "This status means something else from this source: refit its P(plays).",
    "weekly": "The weekly odds are no better than a coin flip: recheck the simulator calibration.",
}


def _grade(x: float, watch: float, act: float) -> str:
    return "act" if x > act else "watch" if x > watch else "ok"


def evaluate(summary: dict, cfg: Settings | None = None) -> list[dict]:
    """The checks for a live_scores.summary() result. Pure."""
    sc = (cfg or settings()).scorecard
    out: list[dict] = []

    def add(area, item, value, reference, status, key):
        out.append(
            {
                "area": area,
                "item": item,
                "value": value,
                "reference": reference,
                "status": status,
                "action": ACTIONS[key] if status in ("watch", "act") else None,
            }
        )

    rows = {(r["stat"], r["segment"]): r for r in summary.get("projections", [])}
    for stat, ref in sc.reference_mae.items():
        r = rows.get((stat, "all"))
        enough = r is not None and r["n"] >= sc.min_player_games
        if not enough:
            for key, area in (("mae", "average miss"), ("bias", "lean"), ("coverage", "80% band")):
                add(area, stat, None, None, "not_enough", key)
            continue
        ratio = r["mae"] / ref
        add("average miss", stat, r["mae"], ref, _grade(ratio, *sc.mae_ratio), "mae")
        add("lean", stat, r["bias"], 0.0, _grade(abs(r["bias"]) / ref, *sc.bias_share), "bias")
        cov, cref = r.get("coverage_80"), sc.reference_coverage.get(stat)
        if cov is None or cref is None:
            add("80% band", stat, cov, cref, "not_enough", "coverage")
        else:
            add("80% band", stat, cov, cref, _grade(abs(cov - cref), *sc.coverage_gap), "coverage")

    pp = rows.get(("p_play", "brier"))
    if pp is None or pp["n"] < sc.min_player_games:
        add("P(plays)", "lean", None, 0.0, "not_enough", "p_play")
    else:
        add("P(plays)", "lean", pp["bias"], 0.0, _grade(abs(pp["bias"]), *sc.p_play_bias), "p_play")

    for n in summary.get("news", []):
        if n.get("assumed") is None:
            continue
        item = f"{n['source']} {n['status']}"
        if n["listed"] < sc.min_listed:
            add("news", item, n["played_rate"], n["assumed"], "not_enough", "news")
        else:
            gap = abs(n["played_rate"] - n["assumed"])
            add("news", item, n["played_rate"], n["assumed"], _grade(gap, *sc.status_gap), "news")

    wk = summary.get("weekly_odds")
    if not wk or wk["weeks"] < sc.min_weeks:
        add("weekly odds", "Brier", wk["brier_all_snapshots"] if wk else None, None, "not_enough", "weekly")
    else:
        b = wk["brier_all_snapshots"]
        add("weekly odds", "Brier", b, None, _grade(b, *sc.weekly_brier), "weekly")
    return out


def run(con: duckdb.DuckDBPyConnection, cfg: Settings | None = None) -> dict:
    """The season-to-date scorecard: a count by status and the flagged checks (watch, act)."""
    cfg = cfg or settings()
    checks = evaluate(live_scores.summary(con, cfg), cfg)
    counts: dict[str, int] = {}
    for c in checks:
        counts[c["status"]] = counts.get(c["status"], 0) + 1
    return {"counts": counts, "flagged": [c for c in checks if c["status"] in ("watch", "act")]}

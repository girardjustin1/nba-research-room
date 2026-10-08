"""In-season scorecard on invented scoreboard summaries: thresholds, too-few-games, and the alert."""

from __future__ import annotations

from datetime import UTC, datetime

from research_room import alerts, scorecard
from research_room.config import settings


def _summary(over=None):
    cfg = settings().scorecard
    rows = [
        {
            "stat": s,
            "segment": "all",
            "n": 5000,
            "mae": m,
            "rmse": m * 1.4,
            "bias": 0.0,
            "coverage_80": cfg.reference_coverage[s],
        }
        for s, m in cfg.reference_mae.items()
    ]
    rows.append(
        {
            "stat": "p_play",
            "segment": "brier",
            "n": 5000,
            "mae": 0.2,
            "rmse": 0.3,
            "bias": 0.01,
            "coverage_80": None,
        }
    )
    s = {
        "projections": rows,
        "news": [
            {
                "source": "x",
                "status": "Questionable",
                "listed": 60,
                "played": 30,
                "played_rate": 0.5,
                "assumed": 0.49,
            }
        ],
        "weekly_odds": {"weeks": 3, "brier_all_snapshots": 0.3, "brier_first_snapshot": 0.3},
    }
    for (stat, key), v in (over or {}).items():
        next(r for r in s["projections"] if r["stat"] == stat and r["segment"] in ("all", "brier"))[key] = v
    return s


def _by(checks):
    return {(c["area"], c["item"]): c for c in checks}


def test_everything_at_the_reference_is_ok_and_few_weeks_is_not_enough():
    checks = _by(scorecard.evaluate(_summary(), settings()))
    assert {c["status"] for k, c in checks.items() if k[0] != "weekly odds"} == {"ok"}
    assert checks[("weekly odds", "Brier")]["status"] == "not_enough"  # 3 weeks: too few to judge
    assert all(c["action"] is None for c in checks.values())


def test_thresholds_grade_watch_and_act():
    ref = settings().scorecard.reference_mae
    s = _summary(
        {
            ("pts", "mae"): ref["pts"] * 1.07,
            ("reb", "mae"): ref["reb"] * 1.2,
            ("minutes", "bias"): ref["minutes"] * 0.25,
            ("blk", "coverage_80"): 0.80,
            ("p_play", "bias"): 0.04,
        }
    )
    s["news"][0] |= {"played": 54, "played_rate": 0.9}  # questionable nearly always played
    checks = _by(scorecard.evaluate(s, settings()))
    assert checks[("average miss", "pts")]["status"] == "watch"
    assert checks[("average miss", "reb")]["status"] == "act"
    lean = checks[("lean", "minutes")]
    assert lean["status"] == "act" and "minutes" in lean["action"]
    assert checks[("80% band", "blk")]["status"] == "act"  # 0.80 against 0.908
    assert checks[("P(plays)", "lean")]["status"] == "watch"
    assert checks[("news", "x Questionable")]["status"] == "act"


def test_too_few_games_is_never_graded():
    s = _summary()
    for r in s["projections"]:
        r["n"] = 100
    s["news"][0]["listed"] = 5
    checks = scorecard.evaluate(s, settings())
    assert {c["status"] for c in checks} == {"not_enough"}


def test_an_act_check_becomes_one_high_alert_to_the_scorecard():
    ref = settings().scorecard.reference_mae
    checks = scorecard.evaluate(_summary({("reb", "mae"): ref["reb"] * 1.2}), settings())
    now = datetime(2026, 11, 20, 8, tzinfo=UTC)
    found = alerts._scorecard_alert(now, {"scorecard": {"flagged": checks}})
    assert len(found) == 1 and found[0]["priority"] == "high"
    assert found[0]["action"]["target"] == "scorecard" and "average miss reb" in found[0]["body"]
    calm = scorecard.evaluate(_summary(), settings())
    assert alerts._scorecard_alert(now, {"scorecard": {"flagged": calm}}) == []

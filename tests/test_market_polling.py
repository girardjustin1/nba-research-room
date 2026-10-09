"""Pre-game market pulls are throttled: TheRundown bills by use, and pre-game runs poll every 15 min."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from research_room.config import settings
from research_room.pipeline import markets_due

TIP = datetime(2026, 11, 4, 23, 30, tzinfo=UTC)     # first tip 7:30 pm ET


def at(minutes_before_tip: float) -> datetime:
    return TIP - timedelta(minutes=minutes_before_tip)


def test_first_pull_then_hourly_then_one_final_pull_before_tip():
    cfg = settings()                                          # 60 min apart, final pull in the last 45
    assert markets_due(None, at(180), TIP, cfg) == "first pull"
    assert markets_due(at(180), at(165), TIP, cfg) is None    # 15 min later: skipped
    assert markets_due(at(180), at(120), TIP, cfg) == "due"   # an hour later
    assert markets_due(at(120), at(60), TIP, cfg) == "due"
    assert markets_due(at(60), at(45), TIP, cfg) == "final pull before tip"   # inside the last 45
    assert markets_due(at(45), at(30), TIP, cfg) is None      # final pull done: no more before tip
    assert markets_due(at(45), at(-10), TIP, cfg) is None     # after tip: only hourly again
    assert markets_due(at(45), at(-20), TIP, cfg) == "due"    # 65 min since the final pull
    assert markets_due(at(45), at(-15), None, cfg) == "due"   # no tip known: hourly


def test_a_day_of_polling_pulls_a_handful_of_times_not_every_poll():
    cfg = settings()
    last, pulls = None, 0
    for m in range(180, -240, -15):                           # 3 h before first tip to 4 h after
        if markets_due(last, at(m), TIP, cfg):
            last, pulls = at(m), pulls + 1
    assert pulls <= 8                                         # not 28

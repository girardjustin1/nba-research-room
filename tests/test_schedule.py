from __future__ import annotations

from datetime import date, timedelta

import pandas as pd
import pytest

from research_room import schedule
from research_room.config import settings


@pytest.fixture
def season():
    return settings().season


def test_repo_week_layout_matches_league_settings(season):
    weeks = schedule.fantasy_weeks(season)
    assert len(weeks) == 22
    assert weeks.iloc[0]["start"] == date(2026, 10, 19)          # Monday before Oct 20 tip-off
    playoffs = weeks[weeks["is_playoff"]]
    assert playoffs["week"].tolist() == [20, 21, 22]
    assert playoffs.iloc[0]["start"] == date(2027, 3, 15)
    assert playoffs.iloc[-1]["end"] == date(2027, 4, 4)
    assert (weeks["start"].map(lambda d: d.weekday()) == 0).all()
    assert (weeks["end"].map(lambda d: d.weekday()) == 6).all()


def test_inconsistent_week_layout_is_rejected(season):
    bad = season.model_copy(update={"extended_weeks": {}})
    with pytest.raises(ValueError, match="extended_weeks"):
        schedule.fantasy_weeks(bad)


def _games(rows):
    base = {"tip_utc": None, "postseason": False, "season_type": None, "ist_stage": None,
            "postponed": False, "status_state": "scheduled"}
    return pd.DataFrame([{**base, "game_id": i, "game_date": d, "home_team_id": h, "visitor_team_id": a,
                          **extra} for i, (d, h, a, extra) in enumerate(rows)])


def test_back_to_backs_and_light_days(season):
    d0 = date(2026, 11, 2)                                       # a Monday in week 2
    games = _games([
        (d0, 1, 2, {}), (d0 + timedelta(days=1), 1, 3, {}),      # team 1 B2B
        (d0 + timedelta(days=3), 2, 3, {}),
        (d0 + timedelta(days=4), 4, 5, {"postseason": True}),    # excluded
        (d0 + timedelta(days=5), 4, 5, {"postponed": True}),     # excluded
    ])
    tg = schedule.flag_back_to_backs(schedule.team_games(games))
    b2b = tg.groupby("team_id")["b2b"].sum().to_dict()
    assert b2b == {1: 2, 2: 0, 3: 0}
    daily = schedule.daily_counts(tg, light_day_max_games=5)
    assert daily["light_day"].all() and daily["n_games"].tolist() == [1, 1, 1]


def test_team_week_matrix_counts_and_flags(season):
    games = _games([
        (date(2026, 10, 20), 1, 2, {}), (date(2026, 10, 28), 1, 3, {}),      # both in long week 1
        (date(2026, 12, 5), 1, 2, {"ist_stage": "Quarterfinals"}),            # cup window
        (date(2027, 3, 16), 1, 2, {}), (date(2027, 3, 17), 1, 3, {}),         # playoff week 20 B2B
    ])
    m = schedule.team_week_matrix(games, season)
    t1 = m[m["team_id"] == 1].set_index("week")
    assert t1.loc[1, "games"] == 2
    assert t1.loc[20, "games"] == 2 and t1.loc[20, "b2b_games"] == 2 and t1.loc[20, "is_playoff"]
    cup_week = schedule.week_of(date(2026, 12, 5), season)
    assert t1.loc[cup_week, "cup_window_games"] == 1 and t1.loc[cup_week, "cup_knockout_week"]
    # Break starts Fri of week 16 (loses Fri-Sun) and runs into merged week 17: both flagged.
    assert m.loc[m["all_star_week"], "week"].unique().tolist() == [16, 17]
    assert len(m) == 3 * 22                                        # full team x week grid


def test_schedule_matrix_from_store(con, season):
    from datetime import UTC, datetime

    from research_room import store
    now = datetime(2026, 10, 4, tzinfo=UTC)
    teams = [{"team_id": t, "abbreviation": a, "source": "t", "fetched_at": now}
             for t, a in [(1, "DEN"), (2, "BOS")]]
    store.upsert(con, "teams", pd.DataFrame(teams))
    g = _games([(date(2027, 3, 16), 1, 2, {}), (date(2026, 11, 3), 2, 1, {})])
    g["season"], g["source"], g["fetched_at"] = 2026, "t", now
    store.upsert(con, "games", g)
    wide = schedule.schedule_matrix(con, season)
    assert wide.loc["DEN", "W20"] == 1 and wide.loc["DEN", "playoffs"] == 1 and wide.loc["BOS", "total"] == 2

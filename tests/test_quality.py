from __future__ import annotations

from datetime import UTC, datetime

import pandas as pd

from research_room import quality, store

NOW = datetime(2026, 10, 4, tzinfo=UTC)


def _seed(con, home_pts: list[float], away_pts: list[float], home_score=100, away_score=90,
          minutes=48.0):
    store.upsert(con, "games", pd.DataFrame([{
        "game_id": 1, "season": 2023, "game_date": "2024-02-14", "status_state": "final",
        "home_team_id": 10, "visitor_team_id": 20, "home_score": home_score,
        "visitor_score": away_score, "postseason": False, "source": "t", "fetched_at": NOW}]))
    rows = [{"game_id": 1, "player_id": 100 + i, "team_id": 10, "pts": p, "minutes": minutes,
             "did_play": True, "source": "t", "fetched_at": NOW} for i, p in enumerate(home_pts)]
    rows += [{"game_id": 1, "player_id": 200 + i, "team_id": 20, "pts": p, "minutes": minutes,
              "did_play": True, "source": "t", "fetched_at": NOW} for i, p in enumerate(away_pts)]
    store.upsert(con, "game_logs", pd.DataFrame(rows))


def test_complete_game_reconciles(con):
    _seed(con, [20] * 5, [18] * 5)
    check = quality.box_score_check(con)
    assert check["complete"].all() and len(check) == 2
    assert quality.incomplete_games(con) == set()


def test_missing_player_rows_are_flagged(con):
    _seed(con, [20] * 5, [18] * 4)                       # away side missing a player: 72 != 90
    check = quality.box_score_check(con).set_index("team_id")
    assert check.loc[10, "complete"] and not check.loc[20, "complete"]
    assert quality.incomplete_games(con) == {1}
    s = quality.summary(con).iloc[0]
    assert (s["team_games"], s["complete"], s["incomplete"]) == (2, 1, 1)


def test_points_match_but_minutes_short_is_flagged(con):
    _seed(con, [20] * 5, [18] * 5, minutes=40.0)         # 200 team minutes
    assert not quality.box_score_check(con)["complete"].any()


def test_incomplete_team_games_names_only_the_bad_side(con):
    _seed(con, [20] * 5, [18] * 4)
    bad = quality.incomplete_team_games(con)
    assert bad.to_dict("records") == [{"game_id": 1, "team_id": 20}]

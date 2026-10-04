from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from jobs import mock_draft

from research_room.draft import tracker
from research_room.draft.availability import expected_pick
from research_room.draft.board import DraftBoard
from research_room.draft.value import compute_values

TEAMS, ROUNDS, SLOT, SEED, PLAYERS = 4, 5, 2, 3, 120


@pytest.fixture(scope="module")
def result():
    return mock_draft.run_mock(TEAMS, SLOT, SEED, ROUNDS, synthetic=True, synthetic_players=PLAYERS)


def test_every_pick_made_once_and_rosters_full(result):
    picks = result["picks"]
    assert [p["pick_no"] for p in picks] == list(range(1, TEAMS * ROUNDS + 1))
    ids = [p["player_id"] for p in picks]
    assert len(ids) == len(set(ids))                                  # nobody drafted twice
    assert set(result["rosters"]) == set(range(1, TEAMS + 1))
    assert all(len(r) == ROUNDS for r in result["rosters"].values())
    assert {p["by"] for p in picks if p["team"] == SLOT} == {"board"}
    assert {p["by"] for p in picks if p["team"] != SLOT} == {"bot"}


def test_my_picks_are_the_boards_first_choice(result):
    """Replay the draft on a fresh board: at each of my turns, #1 must be the player I took."""
    cfg = mock_draft.mock_settings(TEAMS, ROUNDS)
    pool, gpw = mock_draft.synthetic_pool(SEED, PLAYERS)
    board = DraftBoard(expected_pick(compute_values(pool, cfg), cfg), cfg, gpw)
    con = mock_draft.store.connect(":memory:")
    state = tracker.new_state("replay", cfg, my_slot=SLOT)
    checked = 0
    for p in result["picks"]:
        if p["team"] == SLOT:
            assert int(board.recommend(state).table.iloc[0]["player_id"]) == p["player_id"]
            checked += 1
        state = tracker.record_pick(con, state, p["player_id"], p["name"])
    con.close()
    assert checked == ROUNDS == len(result["my_picks"])


def test_timings_and_evaluation_reported(result):
    t = result["timing"]
    assert t["refresh"]["n"] == TEAMS * ROUNDS - 1                    # after every pick but the last
    assert t["my_recommend"]["n"] == ROUNDS
    for key in ("refresh", "recommend_only", "record_pick", "my_recommend"):
        assert 0 < t[key]["mean_s"] <= t[key]["max_s"] and t[key]["p95_s"] <= t[key]["max_s"]
    assert t["wall_s"] > 0
    assert isinstance(result["criteria"]["passed"], bool)

    e = result["evaluation"]
    assert len(e["vs"]) == TEAMS - 1
    for v in e["vs"]:
        assert 0.0 <= v["p_win_week"] <= 1.0 and 0.0 <= v["expected_cats"] <= 9.0
    assert 0.0 <= e["avg_p_win_week"] <= 1.0
    assert 1 <= e["rank"] <= TEAMS
    assert all(0.0 <= p <= 1.0 for p in e["my_avg_p_cat"].values())
    assert "PASS" in mock_draft.format_report(result) or "FAIL" in mock_draft.format_report(result)


def test_bot_respects_position_cap():
    avail = pd.DataFrame({"expected_pick": [1.0, 2.0, 50.0], "adp_sd": [0.1, 0.1, 0.1],
                          "position": ["C", "C", "PG"]}, index=[10, 11, 12])
    rng = np.random.default_rng(0)
    assert mock_draft.bot_choice(avail, ["C"] * 4, rng, cap=4) == 12
    assert mock_draft.bot_choice(avail, ["C"] * 3, rng, cap=4) == 10
    assert mock_draft.bot_choice(avail.iloc[:2], ["C"] * 4, rng, cap=4) == 10   # cap ignored if all full

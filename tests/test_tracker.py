from __future__ import annotations

import pandas as pd
import pytest

from research_room.config import settings
from research_room.draft import tracker


@pytest.fixture
def state(con):
    s = settings()
    cfg = s.model_copy(update={"league": s.league.model_copy(update={"teams": 4}),
                               "draft": s.draft.model_copy(update={"rounds": 3})})
    return tracker.new_state("mock-1", cfg, my_slot=2)


def test_picks_follow_the_snake(con, state):
    assert (state.current_pick, state.on_the_clock) == (1, 1)
    for pid in range(1, 6):
        state = tracker.record_pick(con, state, pid, f"P{pid}")
    assert state.picks["team_id"].tolist() == [1, 2, 3, 4, 4]          # pick 5 = round 2, slot 4
    assert (state.current_pick, state.on_the_clock) == (6, 3)
    assert state.roster(4)["player_id"].tolist() == [4, 5]


def test_bad_picks_are_rejected(con, state):
    state = tracker.record_pick(con, state, 1, "P1")
    with pytest.raises(tracker.PickError, match="already drafted"):
        tracker.record_pick(con, state, 1, "P1")
    with pytest.raises(tracker.PickError, match="belongs to slot 2"):
        tracker.record_pick(con, state, 2, "P2", team_id=3)


def test_undo_reverts_the_last_pick_and_keeps_the_log(con, state):
    for pid in (1, 2):
        state = tracker.record_pick(con, state, pid, f"P{pid}")
    state = tracker.undo_last(con, state)
    assert state.picks["player_id"].tolist() == [1] and state.current_pick == 2
    assert con.execute("SELECT count(*) FROM draft_picks WHERE undone").fetchone()[0] == 1
    state = tracker.record_pick(con, state, 9, "P9")                    # pick 2 can be re-made
    assert state.picks["player_id"].tolist() == [1, 9]


def test_keepers_take_their_round_pick_and_are_skipped(con, state):
    state = tracker.apply_keepers(con, state, [{"team_id": 1, "player_id": 50, "round": 1}], {50: "K"})
    assert state.picks.iloc[0][["pick_no", "is_keeper"]].tolist() == [1, True]
    assert state.current_pick == 2 and 50 in state.drafted
    with pytest.raises(tracker.PickError, match="nothing to undo"):
        tracker.undo_last(con, state)


def test_reload_and_export(con, state, tmp_path):
    for pid in (1, 2, 3):
        state = tracker.record_pick(con, state, pid, f"P{pid}")
    again = tracker.load_state(con, "mock-1", my_slot=2)
    assert again.picks["player_id"].tolist() == [1, 2, 3]
    out = tracker.export_results(state, tmp_path / "draft_results.csv")
    assert pd.read_csv(out).columns.tolist() == ["pick_no", "round", "team_id", "player_name"]


def test_draft_order_names_slots_and_finds_my_slot():
    names = {7: "Seven", 11: "Mine", 3: "Three"}
    order = [7, 3, 11, 1]
    assert tracker.slot_names_from_order(order, names) == {1: "Seven", 2: "Three", 3: "Mine"}
    assert tracker.slot_from_order(order, 11) == 3
    assert tracker.slot_from_order([], 11) is None


def test_settings_reject_a_bad_draft_order():
    s = settings()
    with pytest.raises(ValueError, match="exactly once"):
        type(s).model_validate({**s.model_dump(), "draft": {**s.draft.model_dump(), "order": [1, 1, 2]}})
    full = list(range(1, 15))
    with pytest.raises(ValueError, match="disagrees"):
        draft = {**s.draft.model_dump(), "order": full, "my_slot": 2}
        type(s).model_validate({**s.model_dump(), "draft": draft})

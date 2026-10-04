from __future__ import annotations

import time

import numpy as np
import pandas as pd
import pytest

from research_room.config import settings
from research_room.draft import tracker
from research_room.draft.availability import expected_pick
from research_room.draft.board import DraftBoard, assign_slots, split_starters
from research_room.draft.value import compute_values

STATS = ("fgm", "fga", "ftm", "fta", "fg3m", "pts", "reb", "ast", "stl", "blk", "tov")
POS = ["PG", "SG", "SF", "PF", "C"]


def make_pool(n=80, seed=0):
    rng = np.random.default_rng(seed)
    rows = []
    for i in range(n):
        q = 1.6 - i / n                                       # earlier ids are better players
        m = {"fgm": 6 * q, "fga": 13 * q, "ftm": 3 * q, "fta": 4 * q, "fg3m": 1.5 * q, "pts": 16 * q,
             "reb": 5 * q, "ast": 3 * q, "stl": q, "blk": 0.6 * q, "tov": 1.5 * q}
        m = {k: v * (0.85 + 0.3 * rng.random()) for k, v in m.items()}
        row = {"player_id": i + 1, "name": f"P{i + 1}", "position": POS[i % 5], "games": 70.0,
               "team_abbr": "X", "yahoo_adp": float(i + 1), "adv_adp": np.nan, "ext_rank": i + 1,
               "sources": "bbm+last_season", "injury_risk": "M"}
        row.update({f"{s}_mean": m[s] for s in STATS})
        row.update({f"{s}_sd": np.sqrt(m[s] * 1.3) for s in STATS})
        rows.append(row)
    return pd.DataFrame(rows)


@pytest.fixture
def cfg():
    s = settings()
    return s.model_copy(update={"league": s.league.model_copy(update={"teams": 4}),
                                "draft": s.draft.model_copy(update={"rounds": 5, "pool_size": 60})})


@pytest.fixture
def board(cfg):
    return DraftBoard(expected_pick(compute_values(make_pool(), cfg), cfg), cfg, team_games_per_week=3.1)


def test_on_the_clock_recommends_available_players_by_gain(con, cfg, board):
    state = tracker.new_state("t", cfg, my_slot=1)
    res = board.recommend(state)
    assert res.decision_pick == 1 and res.following_pick == 8        # 4-team snake: 1, 8, 9, ...
    t = res.table
    assert len(t) == cfg.draft.board.recommendations
    assert t["gain"].is_monotonic_decreasing
    assert t.iloc[0]["player_id"] in (1, 2, 3)                        # one of the best players
    assert t["reasons"].str.contains("expected categories").all()
    assert t["p_win_week_mc"].notna().sum() == cfg.draft.board.monte_carlo_top


def test_drafted_players_disappear_and_off_clock_uses_my_next_pick(con, cfg, board):
    state = tracker.new_state("t", cfg, my_slot=3)
    for pid in (1, 2):
        state = tracker.record_pick(con, state, pid, f"P{pid}")
    res = board.recommend(state)
    assert not set(res.table["player_id"]) & {1, 2}
    assert res.decision_pick == 3 and (res.table["p_available_at_decision"] == 1).all()
    state = tracker.record_pick(con, state, res.table.iloc[0]["player_id"], "mine")
    res = board.recommend(state)                                      # pick 4: slot 4 on the clock
    assert res.decision_pick == 6 and res.table["p_available_at_decision"].between(0, 1).all()


def test_open_slots_and_need_driven_reasons(cfg):
    assert assign_slots([["C", "Util"], ["C", "Util"]], ["PG", "C", "C", "Util"]) == ["PG", "Util"]
    assert assign_slots([["PG", "G", "Util"]], ["PG", "G", "Util"]) == ["G", "Util"]


def test_punt_drift_flags_a_neglected_category(con, cfg, board):
    state = tracker.new_state("t", cfg, my_slot=1)
    # Hand my team three players with zero blocks; everyone else keeps theirs.
    weak = list(board.pool.index[:3])
    board.contrib.loc[weak, ("mean", "blk")] = 0.0
    picks = [1, 8, 9]
    others = iter(pid for pid in board.pool.index if pid not in weak)
    for p in range(1, 10):
        pid = weak[picks.index(p)] if p in picks else next(others)
        state = tracker.record_pick(con, state, int(pid), f"P{pid}")
    res = board.recommend(state)
    assert "blk" in res.drift


def test_recommend_is_fast_on_a_full_pool(con):
    cfg = settings()
    big = make_pool(520, seed=3)
    b = DraftBoard(expected_pick(compute_values(big, cfg), cfg), cfg, 3.1)
    state = tracker.new_state("t", cfg, my_slot=7)
    t0 = time.perf_counter()
    b.recommend(state)
    assert time.perf_counter() - t0 < 1.0                             # build prompt: < 1 s per pick


def test_split_starters_marks_bench_players():
    starts, open_ = split_starters(
        [["C", "Util"], ["C", "Util"], ["C", "Util"], ["C", "Util"], ["C", "Util"]],
        ["PG", "C", "C", "Util", "Util"])
    assert starts == [True, True, True, True, False] and open_ == ["PG"]


def test_a_player_without_a_starting_slot_counts_as_bench(con, cfg, board):
    # Fill my C/C/Util/Util-capable slots with centers, then compare two equal centers' gain:
    # the value of a center must drop once no slot can start him.
    centers = [pid for pid in board.pool.index if board.pool.at[pid, "eligible"] == ["C", "Util"]]
    assert board.bench_utilization == pytest.approx(1 - 3.1 / 7)
    state = tracker.new_state("t", cfg, my_slot=1)
    res_empty = board.recommend(state)
    for i, pick in enumerate([1, 8, 9, 16]):                        # my four picks in a 4-team snake
        while state.current_pick < pick:
            other = next(p for p in board.pool.index if p not in state.drafted and p not in centers)
            state = tracker.record_pick(con, state, int(other), "x")
        state = tracker.record_pick(con, state, int(centers[i]), "c")
    res = board.recommend(state)
    assert not res.table.empty
    bench = board.pool.loc[centers[4:]]
    assert "C" not in res.open_slots and "Util" not in res.open_slots
    t = res.table.set_index("player_id")
    for pid in set(t.index) & set(bench.index):
        assert not t.at[pid, "starts"]
        assert "bench" in t.at[pid, "reasons"]
    assert res_empty.table["starts"].all()


def test_projected_team_is_full_so_drift_is_not_spurious(con, cfg, board):
    state = tracker.new_state("t", cfg, my_slot=1)
    for _ in range(1, 9):                                          # through my second pick (8)
        avail = [pid for pid in board.pool.index if pid not in state.drafted]
        state = tracker.record_pick(con, state, int(avail[0]), "x")
    res = board.recommend(state)
    # Same strength as a league-average team with good early picks: no category is a lost cause.
    assert res.my_expected_cats > 4.5 and res.drift == []

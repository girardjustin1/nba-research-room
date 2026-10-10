"""The fast lineup choice used by the matchup odds finds the same best value as the MILP lineup
(assign_day) on random rosters: odd eligibilities, IL players, no-game days, negative values."""

from __future__ import annotations

import numpy as np
import pandas as pd

from research_room import lineup
from research_room.config import settings

POSITIONS = [["PG"], ["SG"], ["PG", "SG"], ["SF"], ["PF"], ["SF", "PF"], ["C"], ["PF", "C"], ["SG", "SF"]]


def _case(rng, n):
    ids = list(range(1, n + 1))
    roster = pd.DataFrame({
        "player_id": ids,
        "name": [f"p{i}" for i in ids],
        "eligible": [POSITIONS[rng.integers(len(POSITIONS))] for _ in ids],
        "status": [("OUT" if rng.random() < 0.1 else None) for _ in ids],
        "current_slot": ["BN"] * n,
    })
    values = pd.Series(rng.normal(5, 4, n), index=ids)          # some negative
    has_game = pd.Series(rng.random(n) < 0.6, index=ids)
    return roster, values, has_game


def _value(starters, values, has_game):
    return sum(float(values[p]) for p in starters.values() if p is not None and bool(has_game[p]))


def test_the_same_best_value_as_the_milp_on_random_rosters():
    cfg = settings()
    rng = np.random.default_rng(20261010)
    for _ in range(300):
        roster, values, has_game = _case(rng, int(rng.integers(3, 16)))
        milp = lineup.assign_day(roster, values, has_game, cfg=cfg)
        fast = lineup.best_starters(roster, values, has_game, cfg=cfg)
        assert abs(_value(fast, values, has_game) - milp.value) < 1e-9
        assert not set(milp.il) & set(fast.values())                # the IL slot's player never starts
        started = [p for p in fast.values() if p is not None]
        assert len(started) == len(set(started))                     # nobody in two slots


def test_a_slot_nobody_can_fill_does_not_cost_a_better_player_his_start():
    cfg = settings()
    roster = pd.DataFrame({"player_id": [1, 2], "name": ["a", "b"], "eligible": [["PG", "SG"], ["PG"]],
                           "status": [None, None], "current_slot": ["BN", "BN"]})
    values, has_game = pd.Series({1: 10.0, 2: 1.0}), pd.Series({1: True, 2: True})
    fast = lineup.best_starters(roster, values, has_game, cfg=cfg)
    assert _value(fast, values, has_game) == 11.0

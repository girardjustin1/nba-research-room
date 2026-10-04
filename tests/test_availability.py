from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from research_room.config import settings
from research_room.draft import availability as av


@pytest.mark.parametrize(("pick", "rnd", "slot"), [
    (1, 1, 1), (14, 1, 14), (15, 2, 14), (28, 2, 1), (29, 3, 1), (182, 13, 14)])
def test_snake_arithmetic_round_trips(pick, rnd, slot):
    assert av.round_of(pick, 14) == rnd
    assert av.slot_of(pick, 14) == slot
    assert av.pick_number(rnd, slot, 14) == pick


def test_picks_for_slot_and_next_pick():
    assert av.picks_for_slot(3, 14, 4) == [3, 26, 31, 54]
    assert av.next_pick(3, after=3, teams=14, rounds=4) == 26
    assert av.next_pick(3, after=54, teams=14, rounds=4) is None
    with pytest.raises(ValueError):
        av.pick_number(1, 15, 14)


def test_every_pick_belongs_to_exactly_one_slot():
    allpicks = sorted(p for s in range(1, 15) for p in av.picks_for_slot(s, 14, 13))
    assert allpicks == list(range(1, 14 * 13 + 1))


def test_expected_pick_falls_back_and_widens_sd():
    pool = pd.DataFrame({"yahoo_adp": [5.0, np.nan, np.nan], "adv_adp": [6.0, 40.0, np.nan],
                         "ext_rank": [3, 35, 150]})
    out = av.expected_pick(pool, settings())
    assert out["adp_source"].tolist() == ["yahoo", "bbm_adp", "bbm_rank"]
    assert out["expected_pick"].tolist() == [5.0, 40.0, 150.0]
    a = settings().draft.adp
    assert out.loc[0, "adp_sd"] == a.sd_base_picks                          # round 1
    assert out.loc[1, "adp_sd"] > out.loc[0, "adp_sd"]                      # later round
    assert out.loc[2, "adp_sd"] > out.loc[1, "adp_sd"] * a.fallback_sd_multiplier / 2


def test_prob_available_behaves():
    exp, sd = np.array([10.0, 30.0, 60.0]), np.array([4.0, 6.0, 8.0])
    p = av.prob_available(exp, sd, at_pick=30, current_pick=5)
    assert p[0] < 0.01 and 0.4 < p[1] < 0.6 and p[2] > 0.99
    assert (av.prob_available(exp, sd, at_pick=5, current_pick=5) == 1).all()
    # Conditioning: a player still there well past his ADP is more likely to last.
    late = av.prob_available(np.array([10.0]), np.array([4.0]), at_pick=20, current_pick=15)
    early = av.prob_available(np.array([10.0]), np.array([4.0]), at_pick=20, current_pick=1)
    assert late[0] > early[0]

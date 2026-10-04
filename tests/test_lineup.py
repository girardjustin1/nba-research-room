from __future__ import annotations

import pandas as pd
import pytest

from research_room import lineup
from research_room.config import settings

CFG = settings()


def roster(rows):
    return pd.DataFrame([{"player_id": p, "name": n, "eligible": e, "status": st, "current_slot": cur}
                         for p, n, e, st, cur in rows])


def full_roster():
    # 13 healthy players + one injured (to IL). Eligibility uses Yahoo slot codes.
    return roster([
        (1, "PG1", ["PG", "G"], None, "PG"), (2, "SG1", ["SG", "G"], None, "SG"),
        (3, "G1", ["PG", "SG", "G"], None, "G"), (4, "SF1", ["SF", "F"], None, "SF"),
        (5, "PF1", ["PF", "F"], None, "PF"), (6, "F1", ["SF", "PF", "F"], None, "F"),
        (7, "C1", ["C"], None, "C"), (8, "C2", ["C"], None, "C"),
        (9, "U1", ["PG", "SG", "G"], None, "Util"), (10, "U2", ["PF", "C", "F"], None, "Util"),
        (11, "B1", ["SF", "F"], None, "BN"), (12, "B2", ["C"], None, "BN"),
        (13, "B3", ["PG", "G"], None, "BN"),
        (14, "Hurt", ["SG", "G"], "O", "BN"),
    ])


def test_slots_are_numbered_duplicates():
    assert lineup._slots(CFG) == ["PG", "SG", "G", "SF", "PF", "F", "C#1", "C#2", "Util#1", "Util#2"]


def test_starts_players_with_games_and_benches_idle_ones():
    r = full_roster()
    values = pd.Series({p: float(p) for p in r["player_id"]})
    has_game = pd.Series({p: p not in (7, 9) for p in r["player_id"]})      # C1 and U1 have no game
    out = lineup.assign_day(r, values, has_game, cfg=CFG)
    assert out.status == "optimal"
    starting = {p for p in out.starters.values() if p}
    assert 7 not in starting and 9 not in starting
    assert {12, 11, 13} <= starting                                      # bench players with games start
    assert out.il == [14] and 14 not in starting
    actions = {(c["player_id"], c["action"]) for c in out.changes}
    assert (7, "BENCH") in actions and (12, "START") in actions and (14, "IL") in actions
    reason = next(c["reason"] for c in out.changes if c["player_id"] == 7)
    assert reason == "no game today"


def test_eligibility_is_respected():
    r = full_roster()
    values = pd.Series({p: 1.0 for p in r["player_id"]})
    out = lineup.assign_day(r, values, pd.Series({p: True for p in r["player_id"]}), cfg=CFG)
    elig = r.set_index("player_id")["eligible"]
    for slot, p in out.starters.items():
        base = slot.split("#")[0]
        assert p is None or base == "Util" or base in elig[p]


def test_locked_player_keeps_his_slot_and_bad_lock_is_readable():
    r = full_roster()
    values = pd.Series({p: float(p) for p in r["player_id"]})
    has = pd.Series({p: True for p in r["player_id"]})
    out = lineup.assign_day(r, values, has, locked={1: "PG"}, cfg=CFG)
    assert out.starters["PG"] == 1
    bad = lineup.assign_day(r, values, has, locked={7: "PG"}, cfg=CFG)
    assert bad.status == "infeasible" and "not eligible" in bad.reason


def test_category_weights_flip_turnovers_and_value_uses_them():
    pool = pd.DataFrame({"pts": [10, 20, 30], "reb": [3, 6, 9], "ast": [2, 4, 6], "stl": [1, 1, 2],
                         "blk": [0, 1, 2], "fg3m": [1, 2, 3], "tov": [1, 2, 3], "fgm": [4, 8, 12],
                         "fga": [9, 16, 24], "ftm": [2, 3, 5], "fta": [3, 4, 6]}, dtype=float)
    w = lineup.category_weights(pool, CFG)
    assert w["tov"] < 0 < w["pts"]
    lp = lineup.league_pct(pool, CFG)
    v = lineup.player_value(pool, w, lp, CFG)
    assert v.iloc[2] > v.iloc[0]


@pytest.mark.parametrize("n_bench_games", [0, 3])
def test_empty_slots_when_too_few_players_play(n_bench_games):
    r = full_roster()
    values = pd.Series({p: 1.0 for p in r["player_id"]})
    has = pd.Series({p: p in (1, 2) or (p in (11, 12, 13) and n_bench_games) for p in r["player_id"]})
    out = lineup.assign_day(r, values, has, cfg=CFG)
    assert out.status == "optimal"
    assert out.value == pytest.approx(2.0 + n_bench_games)

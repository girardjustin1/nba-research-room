from __future__ import annotations

from datetime import datetime

import numpy as np
import pandas as pd
import pytest

from research_room import matchup, optimizer
from research_room.config import settings
from tests.test_matchup import DAYS, proj, roster


@pytest.fixture
def cfg():
    return settings()


def week(cfg, me_scale=1.0, fa_scale=1.6, fa_games=lambda pid, d: True, me_n=12):
    """My 12 (players 1..12), the opponent's 12 (101..112), free agents 201..205.
    Player 12 is my weakest and never plays."""
    me_r, opp_r = roster(me_n, 1), roster(12, 101)
    me_r.loc[:, "current_slot"] = "BN"
    fa = roster(5, 201).assign(eligible=[[p] for p in ("C", "PG", "SF", "PF", "SG")])
    p = pd.concat([proj(me_r["player_id"], me_scale, games=lambda pid, d: pid != 12),
                   proj(opp_r["player_id"]),
                   proj(fa["player_id"], fa_scale, games=fa_games)])
    now = datetime.combine(DAYS[0], datetime.min.time()).replace(hour=12, tzinfo=matchup.ET)
    z = matchup.zero_to_date(cfg)
    inp = {"days": DAYS, "now": now, "proj": p, "me_roster": me_r, "opp_roster": opp_r,
           "me": matchup.team_days(me_r, p, DAYS, cfg), "opp": matchup.team_days(opp_r, p, DAYS, cfg),
           "me_done": z, "opp_done": z, "var_mult": {}, "corr": None}
    return inp, fa


def test_weights_favor_close_categories_and_ignore_punts(cfg):
    inp, _ = week(cfg)
    me, opp = matchup._team(inp["me"], inp["me_done"], 0), matchup._team(inp["opp"], inp["opp_done"], 0)
    w = optimizer.category_weights(me, opp, cfg)
    assert w["count"]["pts"] > 0 and w["count"]["tov"] < 0         # turnovers hurt
    assert w["made"]["fg_pct"] > 0 and w["att"]["fg_pct"] < 0       # misses hurt the ratio
    punted = optimizer.category_weights(me, opp, cfg, punts={"ft_pct", "tov"})
    assert punted["count"]["tov"] == 0 and punted["made"]["ft_pct"] == 0


def test_adds_a_better_free_agent_for_the_player_who_never_plays(cfg):
    inp, fa = week(cfg)
    plan = optimizer.optimize(inp, fa, acquisitions_left=4, cfg=cfg)
    assert plan.status == "optimal" and plan.moves
    assert plan.p_win_week > plan.baseline_p
    first = optimizer.first_add_index(DAYS, DAYS[0], cfg)
    assert all(m.effective >= DAYS[first] for m in plan.moves)       # adds count from tomorrow
    assert any(m.drop == 12 for m in plan.moves)                      # the idle player goes first
    assert len(plan.moves) <= 4
    assert optimizer.check(inp["me_roster"], plan.moves, 4, cfg, DAYS, DAYS[first]) is None


def test_no_acquisitions_or_no_games_means_no_moves(cfg):
    inp, fa = week(cfg)
    assert optimizer.optimize(inp, fa, acquisitions_left=0, cfg=cfg).moves == []
    idle, fa2 = week(cfg, fa_games=lambda pid, d: False)
    plan = optimizer.optimize(idle, fa2, acquisitions_left=4, cfg=cfg)
    assert plan.moves == [] and plan.message


def test_check_explains_infeasible_sets(cfg):
    inp, _ = week(cfg)
    base, d = inp["me_roster"], DAYS[1]
    mv = lambda a, dr: optimizer.Move(optimizer.move_id(a, dr, d), a, dr, d)  # noqa: E731
    assert "acquisitions" in optimizer.check(base, [mv(201, 1), mv(202, 2)], 1, cfg, DAYS, DAYS[1])
    assert "same player" in optimizer.check(base, [mv(201, 1), mv(201, 2)], 4, cfg, DAYS, DAYS[1])
    assert "limit 12" in optimizer.check(base, [mv(201, None)], 4, cfg, DAYS, DAYS[1])
    assert "at the earliest" in optimizer.check(base, [optimizer.Move("x", 201, 1, DAYS[0])], 4, cfg,
                                                DAYS, DAYS[1])


def test_apply_moves_changes_the_roster_from_the_effective_day(cfg):
    inp, fa = week(cfg)
    m = optimizer.Move("m", 201, 12, DAYS[2])
    rosters = optimizer.apply_moves(inp["me_roster"], fa, [m], DAYS)
    ids = [set(r["player_id"]) for r in rosters]
    assert 12 in ids[1] and 201 not in ids[1]
    assert 12 not in ids[2] and 201 in ids[2] and 201 in ids[3]
    assert all(len(r) == 12 for r in rosters)
    same = matchup.matchup_now(inp["me"], inp["opp"], inp["me_done"], inp["opp_done"], cfg=cfg)
    assert np.isclose(optimizer.evaluate(inp, inp["me_roster"], fa, [], cfg).p_win_week, same.p_win_week)


def test_a_plan_the_roster_rules_reject_is_never_returned(cfg, monkeypatch):
    """Audit F04: an add without the drop that frees its spot (a 13th player) must not be scored
    or returned, even when the solver reports it optimal."""
    inp, fa = week(cfg)
    first = optimizer.first_add_index(DAYS, DAYS[0], cfg)
    bad = [optimizer.Move("add-201", 201, None, DAYS[first])]
    monkeypatch.setattr(optimizer, "_solve", lambda *a, **k: (bad, "optimal"))
    plan = optimizer.optimize(inp, fa, 4, cfg)
    assert plan.moves == [] and plan.status == "invalid"
    assert optimizer.check(inp["me_roster"], bad, 4, cfg, DAYS, DAYS[first]) is not None


def test_every_returned_roster_fits_the_limit(cfg):
    inp, fa = week(cfg)
    plan = optimizer.optimize(inp, fa, acquisitions_left=4, cfg=cfg)
    assert all(len(r) <= optimizer.roster_cap(cfg) for r in plan.rosters)
    adds = [m.add for m in plan.moves if m.add is not None]
    assert len(adds) == len(set(adds))                       # no one is added twice in a week

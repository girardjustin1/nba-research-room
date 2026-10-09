"""The opponent's in-week pickups (streaming.py), on invented players and weeks."""
from __future__ import annotations

from datetime import datetime, timedelta

import pandas as pd
import pytest

from research_room import matchup, optimizer, season_api, streaming
from research_room.config import settings
from tests.test_matchup import DAYS, proj, roster
from tests.test_optimizer import week
from tests.test_week_probability import NOW, _free_agents, _seed


@pytest.fixture
def cfg():
    c = settings().model_copy(deep=True)
    c.opponent.streaming, c.opponent.adds_per_week, c.opponent.adds_per_day = True, 2, 1
    return c


def opp_week(cfg, opp_idle=lambda pid, d: pid == 112, fa_scale=1.0, fa_games=lambda pid, d: True):
    """My 12 (1..12), the opponent's 12 (101..112, `opp_idle` says who has no game when), free agents
    201..205 at `fa_scale`. Planned the day before DAYS[0], so adds count from DAYS[0]."""
    me_r, opp_r = roster(12, 1), roster(12, 101)
    fa = roster(5, 201).assign(eligible=[[p] for p in ("C", "PG", "SF", "PF", "SG")])
    p = pd.concat([proj(me_r["player_id"]),
                   proj(opp_r["player_id"], games=lambda pid, d: not opp_idle(pid, d)),
                   proj(fa["player_id"], fa_scale, games=fa_games)])
    now = datetime.combine(DAYS[0] - timedelta(days=1), datetime.min.time()).replace(
        hour=12, tzinfo=matchup.ET)
    z = matchup.zero_to_date(cfg)
    inp = {"days": DAYS, "now": now, "proj": p, "me_roster": me_r,
           "opp_roster": opp_r, "me": matchup.team_days(me_r, p, DAYS, cfg),
           "opp": matchup.team_days(opp_r, p, DAYS, cfg), "me_done": z, "opp_done": z, "var_mult": {},
           "corr": None}
    return inp, fa


def test_off_by_default():
    assert settings().opponent.streaming is False


def test_his_idle_player_is_swapped_for_a_free_agent_with_a_game(cfg):
    inp, fa = opp_week(cfg)
    s = streaming.opponent_streams(inp, fa, cfg)
    assert s.adds_allowed == 2 and len(s.moves) == 1                     # then nobody of his is idle
    first = s.moves[0]
    assert first.drop == 112 and first.add in set(fa["player_id"]) and first.effective == DAYS[0]
    assert all(len(r) == 12 for r in s.rosters)
    assert 112 not in set(s.rosters[0]["player_id"]) and first.add in set(s.rosters[0]["player_id"])
    better, fa2 = opp_week(cfg, fa_scale=1.5)
    up = streaming.opponent_streams(better, fa2, cfg).days
    assert up.mean["pts"].sum() > better["opp"].mean["pts"].sum()       # a stronger pickup starts
    mine = set(inp["me_roster"]["player_id"])
    assert not any(m.drop in mine or m.add in mine for m in s.moves)    # my roster is never touched


def test_he_keeps_injured_players_and_never_swaps_for_less(cfg):
    inp, fa = opp_week(cfg)
    hurt = inp["opp_roster"].copy()
    hurt.loc[hurt["player_id"] == 112, "status"] = "O"
    assert 112 not in {m.drop for m in streaming.opponent_streams({**inp, "opp_roster": hurt}, fa, cfg).moves}
    # Free agents without a game: nothing to add.
    none, fa0 = opp_week(cfg, fa_games=lambda pid, d: False)
    assert streaming.opponent_streams(none, fa0, cfg).moves == []
    # His only idle player each day has more games left than any free agent: no swap.
    busy, fa1 = opp_week(cfg, opp_idle=lambda pid, d: pid == 112 and d == DAYS[0],
                         fa_games=lambda pid, d: d == DAYS[0])
    assert streaming.opponent_streams(busy, fa1, cfg).moves == []


def test_adds_already_made_and_the_league_limit_cap_him(cfg):
    inp, fa = opp_week(cfg, opp_idle=lambda pid, d: pid >= 109)
    s = streaming.opponent_streams(inp, fa, cfg)
    assert len(s.moves) == 2                                             # the weekly limit
    assert len({m.effective for m in s.moves}) == 2                     # one swap a day
    assert len({m.add for m in s.moves}) == 2                           # each free agent at most once
    assert len(streaming.opponent_streams(inp, fa, cfg, adds_used=1).moves) == 1
    assert streaming.opponent_streams(inp, fa, cfg, adds_used=2).moves == []
    cfg.opponent.adds_per_week, cfg.opponent.adds_per_day = 9, 3
    s = streaming.opponent_streams(inp, fa, cfg)
    assert s.adds_allowed == cfg.transactions.max_acquisitions_per_week == len(s.moves)
    assert max(sum(m.effective == d for m in s.moves) for d in DAYS) <= 3


def test_my_plan_faces_his_streams_and_cannot_add_his_pickups(cfg):
    inp, fa = week(cfg)                       # my player 12 never plays; free agents 201..205
    inp = {**inp, "proj": inp["proj"][inp["proj"]["player_id"] != 112]}   # his player 112 never plays
    inp["opp"] = matchup.team_days(inp["opp_roster"], inp["proj"], DAYS, cfg)
    on = streaming.apply(inp, fa, cfg)
    his = {m.add for m in on["opp_moves"]}
    assert his and on["opp_static"] is inp["opp"]
    static = optimizer.optimize(inp, fa, 4, cfg)
    plan = optimizer.optimize(on, fa, 4, cfg)
    assert not his & {m.add for m in plan.moves}                        # he picked first
    assert plan.baseline_p < static.baseline_p                          # his pickups cost me odds
    again = optimizer.evaluate(on, on["me_roster"], fa, plan.moves, cfg)
    assert again.p_win_week == pytest.approx(plan.p_win_week)           # scored against his streams


def test_week_inputs_stream_only_when_switched_on(con, cfg):
    _seed(con)
    _free_agents(con)
    now = datetime.fromisoformat(NOW)
    off = matchup.week_inputs(con, settings(), now)
    assert "opp_moves" not in off
    on = matchup.week_inputs(con, cfg, now)
    assert on["opp_moves"] and {m.add for m in on["opp_moves"]} <= {201, 202, 203, 204}
    assert any(x["key"] == "opponent_acquisitions" for x in on["missing"])   # his adds so far unknown
    m_off = matchup.matchup_now(off["me"], off["opp"], off["me_done"], off["opp_done"], cfg=cfg)
    m_on = matchup.matchup_now(on["me"], on["opp"], on["me_done"], on["opp_done"], cfg=cfg)
    assert m_on.p_win_week < m_off.p_win_week
    note = next(p["note"] for p in season_api.probability_response(con, cfg, now)["provenance"]
                if p["module"] == "simulate")
    assert "opponent assumed to stream" in note
    con.execute("UPDATE yahoo_matchups SET acquisitions_used = 2 WHERE team_id = 3")
    spent = matchup.week_inputs(con, cfg, now)
    assert spent["opp_moves"] == [] and not any(x["key"] == "opponent_acquisitions" for x in spent["missing"])


def test_week_inputs_without_free_agents_hold_his_roster_and_say_so(con, cfg):
    _seed(con)
    inp = matchup.week_inputs(con, cfg, datetime.fromisoformat(NOW))
    assert "opp_moves" not in inp
    assert any(x["key"] == "opponent_streaming" for x in inp["missing"])


def test_backtest_summary_reports_the_streaming_opponent():
    from research_room import backtest
    n = 4
    res = pd.DataFrame({"p_dn": [0.6, 0.4, 0.5, 0.7], "p_plan": [0.8, 0.6, 0.7, 0.9],
                        "won_dn": [True, False, False, True], "tie_dn": False,
                        "won_plan": [True, True, False, True], "tie_plan": [False, False, True, False],
                        "cats_dn": [5, 3, 4, 6], "cats_plan": [6, 5, 4, 6], "n_moves": [2, 3, 1, 2],
                        "solve_ms": 1000.0, "opp_streams": True, "opp_adds": [2, 1, 2, 2],
                        "p_dn_static": [0.7, 0.5, 0.6, 0.8], "won_plan_static": [True, False, False, True],
                        "tie_plan_static": False, "n_moves_static": [2, 2, 1, 2]})
    s = backtest.summarize(res)
    assert s["opp_adds_per_week"] == 7 / n and s["moves_per_week_static"] == 7 / n
    assert s["win_rate_plan"] == 3.5 / n and s["win_rate_plan_static"] == 2 / n
    assert s["plan_vs_static_plan"] == pytest.approx(1.5 / n)
    assert s["brier_do_nothing_static_odds"] > s["brier_do_nothing"]   # the static odds ran high here
    assert "opp_adds_per_week" not in backtest.summarize(res.assign(opp_streams=False))

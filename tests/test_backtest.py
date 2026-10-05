from __future__ import annotations

from datetime import date, timedelta

import pandas as pd
import pytest

from research_room import backtest, features, matchup
from research_room.config import settings
from research_room.projections.baseline import BaselineModel
from tests.test_leakage import synthetic
from tests.test_matchup import DAYS, proj, roster


@pytest.fixture
def cfg():
    return settings()


def test_bdl_positions_map_to_yahoo_eligibility():
    assert backtest.eligibility("G") == ["PG", "SG"]
    assert backtest.eligibility("F-C") == ["SF", "PF", "C"]
    assert backtest.eligibility("G-F") == ["PG", "SG", "SF", "PF"]
    assert backtest.eligibility(None) == ["SF", "PF"]


def test_snake_draft_and_round_robin():
    league = backtest.draft_league(pd.Series(range(100, 0, -1), index=range(1, 101)), teams=4, size=3)
    assert league[0] == [1, 8, 9] and league[3] == [4, 5, 12]       # 1st pick, then the snake turn
    seen = {frozenset(p) for w in range(13) for p in backtest.round_robin(14, w)}
    assert len(seen) == 91                                          # everyone meets once in 13 weeks


def test_actual_totals_count_only_active_starters(cfg):
    r = roster(12)
    td = matchup.team_days(r, proj(r["player_id"]), DAYS[:1], cfg)
    act = pd.DataFrame([{"player_id": p, "date": DAYS[0], "y_did_play": True,
                         **{f"y_{s}": 1.0 for s in features.RATE_STATS}} for p in r["player_id"]])
    tot = backtest.actual_totals(td, act, cfg)
    assert tot["pts"] == 10.0 and tot["fg_pct"] == 1.0                 # 12 played, 10 counted
    lose = {k: (v - 1 if k != "tov" else v + 1) for k, v in tot.items()}
    assert backtest.categories_won(tot, lose, cfg) == 9


def test_week_projections_cover_every_scheduled_game_and_ignore_the_future(cfg):
    logs, ctx = synthetic(n_players=8, n_games=40)
    logs = logs.assign(game_date=pd.to_datetime(logs["game_date"]))
    built = features.build(logs, ctx, cfg)
    model = BaselineModel(cfg).fit(built[built["min_played_ewma"].notna()])
    sched = pd.DataFrame({"team_id": 1, "game_id": [9001, 9002],
                          "date": [date(2025, 12, 2), date(2025, 12, 4)]})
    start = date(2025, 12, 1)
    week = [start + timedelta(days=i) for i in range(7)]
    out = backtest.week_projections(model, logs, ctx, sched, start, week, 2025, cfg)
    team1 = {p for p in logs.loc[logs["team_id"] == 1, "player_id"]}
    assert set(out["player_id"]) == team1                            # everyone, played or not
    assert set(out["date"]) == {date(2025, 12, 2), date(2025, 12, 4)}
    # Removing every game from Monday on (the future) changes nothing.
    cut = pd.Timestamp("2025-12-01T05:00:00Z")
    past = backtest.week_projections(model, logs[logs["tip_utc"] < cut], ctx, sched, start, week, 2025, cfg)
    key = ["player_id", "date", "stat"]
    pd.testing.assert_frame_equal(out.sort_values(key).reset_index(drop=True),
                                  past.sort_values(key).reset_index(drop=True))


def test_a_bench_player_fills_in_when_a_starter_sits(cfg):
    r = roster(11)
    p = proj(r["player_id"], days=DAYS[:1])
    act = pd.DataFrame([{"player_id": pid, "date": DAYS[0], "y_did_play": pid != 1,
                         **{f"y_{s}": (0.0 if pid == 1 else 1.0) for s in features.RATE_STATS}}
                        for pid in r["player_id"]])
    fixed = backtest.actual_totals(matchup.team_days(r, p, DAYS[:1], cfg), act, cfg)
    played = p.merge(act.loc[act["y_did_play"], ["player_id", "date"]], on=["player_id", "date"])
    react = backtest.actual_totals(matchup.team_days(r, played, DAYS[:1], cfg), act, cfg)
    assert react["pts"] == 10.0                     # the 11th man filled the empty slot
    assert fixed["pts"] < react["pts"]

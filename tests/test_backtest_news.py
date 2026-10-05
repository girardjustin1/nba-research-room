from __future__ import annotations

from datetime import UTC, date, datetime

import numpy as np
import pandas as pd
import pytest

from research_room import backtest_news, matchup, store
from research_room.config import settings
from research_room.projections.baseline import STATS, BaselineModel

DAY = date(2025, 11, 4)
TIP = pd.Timestamp("2025-11-05 00:30", tz="UTC")          # 7:30 PM Eastern
META = {"source": "test", "fetched_at": pd.Timestamp(datetime(2025, 11, 4, tzinfo=UTC))}


def _report(con, ts, rows, teams):
    store.upsert(con, "nba_report_teams", pd.DataFrame(
        [{"report_ts": ts, "game_id": 9, "team_id": t, "submitted": s, **META} for t, s in teams]))
    if rows:
        store.upsert(con, "nba_report_rows", pd.DataFrame(
            [{"report_ts": ts, "game_id": 9, "team_id": t, "player_id": p, "status": st, "reason": "",
              **META} for p, t, st in rows]))


def test_report_news_uses_the_last_report_before_tip(con):
    cfg = settings()
    games = pd.DataFrame({"game_id": [9], "tip_utc": [TIP]})
    five_pm, late = pd.Timestamp("2025-11-04 22:00", tz="UTC"), pd.Timestamp("2025-11-05 00:15", tz="UTC")
    _report(con, five_pm, [(1, 10, "Questionable")], [(10, True), (20, False)])
    _report(con, late, [(1, 10, "Out")], [(10, True), (20, True)])        # within 30 min of tip: too late
    listed, filed = backtest_news.report_news(con, games, cfg)
    assert listed.set_index("player_id").at[1, "status"] == "Questionable"
    assert listed.set_index("player_id").at[1, "p"] == cfg.overrides.status_play_prob["Questionable"]
    assert filed == {(9, 10)}                                       # team 20 hadn't filed in time


def _states():
    rows = []
    for pid, team, mins, rate in ((1, 10, 30.0, 1.0), (2, 10, 28.0, 0.5), (3, 20, 30.0, 1.0)):
        r = {"player_id": pid, "team_id": team, "min_played_ewma": mins, "play_rate_ewma": rate,
             "games_prior": 40}
        for s in STATS:
            r[f"{s}_pm_ewma"] = 0.4 if s == "pts" else 0.1
        rows.append(r)
    return pd.DataFrame(rows)


def test_news_reaches_only_its_day_and_filed_teams():
    cfg = settings()
    off = cfg.model_copy(update={"baseline": cfg.baseline.model_copy(
        update={"teammates": cfg.baseline.teammates.model_copy(update={"enabled": False})})})
    model = BaselineModel(off)
    model.phi = {s: 1.0 for s in (*STATS, "minutes")}
    sched = pd.DataFrame({"team_id": [10, 20, 10], "game_id": [9, 9, 11],
                          "date": [DAY, DAY, date(2025, 11, 6)], "home": [True, False, True]})
    listed = pd.DataFrame({"game_id": [9], "player_id": [1], "status": ["Out"], "p": [0.0]})
    news = (listed, {(9, 10)})
    proj = backtest_news.project(model, _states(), sched, [DAY, date(2025, 11, 6)], news, DAY, cfg)
    pp = proj[proj["stat"] == "pts"].set_index(["player_id", "date"])["mean"]
    assert pp[(1, DAY)] == 0.0                                       # ruled out on the report
    assert pp[(1, date(2025, 11, 6))] > 0                            # the report speaks to its day only
    # player 2: not listed on a filed team -> plays by his 0.5 play rate's bin
    u = cfg.overrides.unlisted
    p2 = u.probs[int(np.searchsorted(u.play_rate_bins, 0.5))]
    assert pp[(2, DAY)] == pytest.approx(p2 * 28.0 * 0.4)
    assert pp[(3, DAY)] == pytest.approx(1.0 * 30.0 * 0.4)           # team 20 not filed: his own rate


def test_done_totals_add_the_starters_real_lines():
    cfg = settings()
    td = matchup.TeamDays.__new__(matchup.TeamDays)
    td.days, td.starters = [DAY, date(2025, 11, 5)], [[1, 2], [1]]
    actual = pd.DataFrame([
        {"player_id": 1, "date": DAY, **{f"y_{s}": 1.0 for s in STATS}, "y_pts": 20.0, "y_fga": 10.0},
        {"player_id": 2, "date": DAY, **{f"y_{s}": 1.0 for s in STATS}, "y_pts": 5.0, "y_fga": 4.0},
        {"player_id": 1, "date": date(2025, 11, 5), **{f"y_{s}": 1.0 for s in STATS}, "y_pts": 30.0},
    ])
    first = backtest_news.done_totals(td, 1, actual, cfg)
    assert first.total["pts"] == 25.0
    fg = next(c for c in cfg.categories if c.kind == "pct" and c.attempts == "fga")
    assert first.att[fg.key] == 14.0
    assert backtest_news.done_totals(td, 2, actual, cfg).total["pts"] == 55.0
    assert backtest_news.done_totals(td, 0, actual, cfg).total["pts"] == 0.0


def test_summary_pairs_versions_by_team_week():
    rows = []
    for wk in range(4):
        for v, p in (("monday", 0.5), ("daily_news", 0.8)):
            rows.append({"week_start": wk, "team": 1, "version": v, "won": True, "tie": False,
                         "cats": 5, "p0": p, "p1": p})
    s = backtest_news.summarize(pd.DataFrame(rows))
    assert s["team_weeks"] == 4
    assert s["versions"]["daily_news"]["vs_monday"] == pytest.approx(0.04 - 0.25)
    assert s["versions"]["daily_news"]["same_result_as_monday"] == 1.0


def test_moves_summary_pairs_against_the_monday_plan():
    rows = []
    for wk in range(4):
        for v, won in (("do_nothing", False), ("monday_plan", wk < 2), ("replan_news", True)):
            rows.append({"week_start": wk, "team": 1, "version": v, "won": won, "tie": False,
                         "cats": 5, "moves": 0 if v == "do_nothing" else 4})
    s = backtest_news.summarize_moves(pd.DataFrame(rows))
    assert s["versions"]["monday_plan"]["win_rate"] == 0.5
    assert s["versions"]["replan_news"]["vs_monday_plan"] == pytest.approx(0.5)
    assert s["versions"]["do_nothing"]["moves"] == 0

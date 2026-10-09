"""The X forward test's replay (backtest_news.x_*), on invented data only."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pandas as pd
import pytest

from research_room import backtest, backtest_news, store
from research_room.config import settings
from research_room.projections.baseline import STATS, BaselineModel

DAY = date(2026, 11, 4)                                   # Eastern standard time: UTC-5
TIP = pd.Timestamp("2026-11-05 00:30", tz="UTC")          # 7:30 PM Eastern
DECIDE = pd.Timestamp("2026-11-04 22:30", tz="UTC")       # 5:30 PM Eastern, before tip - 30 min
META = {"source": "x", "fetched_at": pd.Timestamp(datetime(2026, 11, 4, tzinfo=UTC))}


def _games(day=DAY, tip=TIP, gid=9):
    return pd.DataFrame({"game_id": [gid], "season": [2026], "game_date": [day], "tip_utc": [tip],
                         "home_team_id": [10], "visitor_team_id": [20], "postseason": [False]})


def _event(eid, pid, team, status, seen, basis="next_game", game_id=9, ts=None, rank=1):
    ts = ts or pd.Timestamp("2026-11-04 19:00", tz="UTC")
    return {"event_id": eid, "player_id": pid, "team_id": team, "status": status, "account": f"acct{eid}",
            "authority_rank": rank, "ts": ts, "game_id": game_id, "game_date": DAY, "game_basis": basis,
            "first_seen_at": seen, **META}


def _states():
    rows = []
    for pid, team in ((1, 10), (2, 10), (3, 20)):
        r = {"player_id": pid, "team_id": team, "min_played_ewma": 30.0, "play_rate_ewma": 1.0,
             "games_prior": 40}
        for s in STATS:
            r[f"{s}_pm_ewma"] = 0.4 if s == "pts" else 0.1
        rows.append(r)
    return pd.DataFrame(rows)


def _model(cfg):
    off = cfg.model_copy(update={"baseline": cfg.baseline.model_copy(
        update={"teammates": cfg.baseline.teammates.model_copy(update={"enabled": False})})})
    model = BaselineModel(off)
    model.phi = {s: 1.0 for s in (*STATS, "minutes")}
    return model


def _rows(games):
    return backtest_news._rows(_states(), backtest.team_schedule(games), [DAY])


def test_decision_time_is_eastern_wall_clock_or_half_an_hour_before_tip():
    cfg = settings()
    assert backtest_news.decision_times(_games(), cfg)[9] == DECIDE
    early = pd.Timestamp("2026-11-04 20:00", tz="UTC")             # a 3 PM tip: decide at 2:30 PM
    assert backtest_news.decision_times(_games(tip=early), cfg)[9] == early - timedelta(minutes=30)
    # The day the clocks go back (Nov 1, 2026): still 5:30 PM on the wall, now UTC-5.
    dst = backtest_news.decision_times(_games(day=date(2026, 11, 1), tip=TIP - timedelta(days=3)), cfg)
    assert dst[9] == pd.Timestamp("2026-11-01 22:30", tz="UTC")


def test_x_arm_uses_only_statuses_first_seen_by_the_decision_time(con):
    cfg = settings()
    store.upsert(con, "status_events", pd.DataFrame([
        _event("a", 1, 10, "Out", DECIDE - timedelta(minutes=5)),           # known in time
        _event("b", 3, 20, "Out", DECIDE + timedelta(minutes=5)),           # posted before, read after
    ]))
    games = _games()
    arms, spoke = backtest_news.x_arms(con, _rows(games), games, DAY, cfg)
    with_x = arms["with_x"].set_index("player_id")
    assert list(with_x.index) == [1]
    assert with_x.at[1, "play_prob"] == 0.0 and with_x.at[1, "source"] == "X @accta"
    assert arms["without_x"].empty                                       # no NBA report, no BallDontLie
    assert spoke[["game_id", "player_id"]].values.tolist() == [[9, 1]]
    assert not spoke["carried"].iloc[0]


def test_held_for_review_statuses_are_never_used(con):
    cfg = settings()
    early = DECIDE - timedelta(hours=2)
    store.upsert(con, "status_events", pd.DataFrame([
        _event("c", 2, 10, "Out", early, basis="unmatched", game_id=None),       # no game that day
        _event("d", 3, 20, "Out", early, basis="team_conflict", game_id=None),   # wrong team
    ]))
    games = _games()
    arms, spoke = backtest_news.x_arms(con, _rows(games), games, DAY, cfg)
    assert arms["with_x"].empty and spoke.empty
    assert backtest_news.x_statuses_tied(con, [9]) == 0


def test_without_x_keeps_the_nba_report_and_both_arms_pair_by_player_game(con):
    cfg = settings()
    rep = pd.Timestamp("2026-11-04 22:00", tz="UTC")                    # the 5 PM report
    meta = {"source": "nba", "fetched_at": rep}
    store.upsert(con, "games", _games().assign(status_state="final", source="t", fetched_at=rep))
    store.upsert(con, "nba_report_teams", pd.DataFrame(
        [{"report_ts": rep, "game_id": 9, "team_id": 20, "submitted": False, **meta}]))
    store.upsert(con, "nba_report_rows", pd.DataFrame(
        [{"report_ts": rep, "game_id": 9, "team_id": 20, "player_id": 3, "status": "Questionable",
          "reason": "", **meta}]))
    store.upsert(con, "status_events", pd.DataFrame([
        _event("a", 1, 10, "Out", DECIDE - timedelta(minutes=5)),
        _event("b", 3, 20, "Probable", DECIDE + timedelta(minutes=5)),      # too late to count
    ]))
    games = _games()
    actual = pd.DataFrame({"game_id": [9, 9, 9], "player_id": [1, 2, 3],
                           "y_did_play": [False, True, True], "y_pts": [None, 10.0, 12.0]})
    sched = backtest.team_schedule(games)
    pg = backtest_news.x_day(con, _model(cfg), _states(), sched, games, DAY, actual, cfg)
    pg = pg.set_index("player_id")
    q = cfg.overrides.status_play_prob["Questionable"]
    assert list(pg.index) == [1, 2, 3] and set(pg["game_id"]) == {9}
    assert (pg.at[1, "p_with_x"], pg.at[1, "p_without_x"]) == (0.0, 1.0)   # X: out; nothing else knew
    assert pg.at[1, "pts_with_x"] == 0.0 and pg.at[1, "pts_without_x"] == pytest.approx(30.0 * 0.4)
    assert pg.at[3, "p_with_x"] == pg.at[3, "p_without_x"] == q           # the report, in both arms
    assert pg.at[3, "source_without_x"] == "NBA injury report"
    assert pg["x_status"].tolist() == [True, False, False]
    assert pg.at[1, "y_pts"] == 0.0 and not pg.at[1, "did_play"]          # a game he sat counts 0


def _pg(rows):
    return pd.DataFrame(rows, columns=["day", "x_status", "x_carried", "did_play", "y_pts", "p_with_x",
                                       "p_without_x", "pts_with_x", "pts_without_x", "source_with_x"])


def test_primary_is_only_on_player_games_x_spoke_about():
    cfg = settings()
    rows = []
    for k in range(6):
        d = DAY + timedelta(days=k)
        rows.append((d, True, False, False, 0.0, 0.1, 0.6, 1.0, 6.0, "X @team"))   # X right: he sat
        rows.append((d, False, False, True, 20.0, 0.2, 0.9, 20.0, 20.0, None))      # no X: not in primary
    s = backtest_news.summarize_x(_pg(rows), cfg)
    assert s["x_player_games"] == 6 and s["player_games"] == 12 and s["decided_by_x"] == 6
    assert s["primary"]["brier_with_x"] == pytest.approx(0.01)                # X's games only
    assert s["primary"]["brier_without_x"] == pytest.approx(0.36)
    assert s["primary"]["range"] == pytest.approx([-0.35, -0.35])             # same every day
    assert s["guard"]["diff"] == pytest.approx((1.0 - 6.0) / 2)               # every player-game
    assert s["verdict"] == "pass" and s["verdict_line"].startswith("PASS")


def test_day_range_resamples_whole_days():
    cfg = settings()
    d = pd.Series([0.0, 0.0, 0.0, 1.0])                  # day 2 holds the only difference
    days = pd.Series([1, 1, 1, 2])
    lo, hi = backtest_news.day_range(d, days, cfg)
    assert lo == 0.0 and hi == 1.0                      # all of day 1 drawn, or all of day 2
    assert backtest_news.day_range(d, days, cfg) == [lo, hi]   # seeded: the same each run


@pytest.mark.parametrize("brier, points, outcome", [
    ([-0.02, -0.01], [-0.1, 0.1], "pass"),
    ([-0.02, 0.01], [-0.1, 0.1], "demote"),           # lower, but the range crosses zero
    ([-0.02, -0.01], [-0.3, -0.1], "pass"),
    ([0.01, 0.03], [-0.1, 0.1], "switch_off"),        # worse with X
    ([-0.02, -0.01], [0.01, 0.05], "switch_off"),     # points miss worse with X
    ([0.0, 0.02], [-0.1, 0.1], "demote"),             # touching zero is not above it
])
def test_verdict_maps_ranges_to_the_rules_outcomes(brier, points, outcome):
    assert backtest_news.x_verdict(brier, points) == outcome
    assert outcome in backtest_news.X_VERDICTS


def _season_games(con, n_days, start=date(2026, 10, 20)):
    rows = [{"game_id": 100 + k, "season": 2026, "game_date": start + timedelta(days=k),
             "tip_utc": pd.Timestamp(start + timedelta(days=k + 1), tz="UTC"), "status_state": "final",
             "postseason": False, "postponed": False, "home_team_id": 10, "visitor_team_id": 20,
             "source": "t", "fetched_at": pd.Timestamp("2026-11-30", tz="UTC")} for k in range(n_days)]
    rows.append({**rows[-1], "game_id": 999, "game_date": start + timedelta(days=n_days),
                 "status_state": "scheduled"})                      # not finished: not replayed
    store.upsert(con, "games", pd.DataFrame(rows))


def _tied(con, n, game_id=100):
    seen = pd.Timestamp("2026-10-20 18:00", tz="UTC")
    store.upsert(con, "status_events", pd.DataFrame(
        [_event(f"e{k}", k, 10, "Out", seen, game_id=game_id) for k in range(n)]))


@pytest.mark.parametrize("n_days, n_statuses", [(10, 200), (21, 149), (0, 0)])
def test_not_enough_data_gives_no_verdict_and_replays_nothing(con, n_days, n_statuses):
    cfg = settings()
    if n_days:
        _season_games(con, n_days)
        _tied(con, n_statuses)
    pg, s = backtest_news.x_forward_test(
        con, cfg, through=date(2026, 12, 1), season=2026, echo=lambda m: None
    )
    assert pg.empty and s["verdict"] is None and not s["enough_data"]
    assert s["verdict_line"].startswith("not enough data yet") and s["verdict_line"].endswith("no verdict")
    assert s["game_days"] == n_days and s["x_statuses_tied"] == n_statuses
    assert s["needs"] == {"span_days": 21, "x_statuses_tied": 150}


def test_statuses_count_only_when_tied_to_a_replayed_game(con):
    _season_games(con, 3)
    seen = pd.Timestamp("2026-10-20 18:00", tz="UTC")
    store.upsert(con, "status_events", pd.DataFrame([
        _event("a", 1, 10, "Out", seen, game_id=100),
        _event("b", 2, 10, "Out", seen, game_id=999),                       # a game not finished yet
        _event("c", 3, 10, "Out", seen, game_id=None, basis=None),          # no game
    ]))
    days = backtest_news.finished_days(con.execute("SELECT * FROM games").df(), 2026, date(2026, 12, 1))
    assert days == [date(2026, 10, 20), date(2026, 10, 21), date(2026, 10, 22)]
    assert backtest_news.x_statuses_tied(con, [100, 101, 102]) == 1

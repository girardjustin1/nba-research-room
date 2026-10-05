from __future__ import annotations

from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd
import pytest

from research_room import matchup
from research_room.config import settings
from research_room.projections.baseline import STATS

DAYS = [date(2026, 11, 2) + timedelta(days=i) for i in range(4)]
POS = ["PG", "SG", "SF", "PF", "C", "C", "PG", "SF", "PF", "SG", "C", "SF"]


def roster(n=12, start_id=1):
    return pd.DataFrame({"player_id": range(start_id, start_id + n), "name": [f"P{i}" for i in range(n)],
                         "eligible": [[POS[i % len(POS)]] for i in range(n)], "status": None,
                         "current_slot": "BN"})


def proj(ids, scale=1.0, days=DAYS, games=lambda pid, d: True):
    rows = []
    base = {"pts": 15, "reb": 6, "ast": 4, "stl": 1, "blk": 0.6, "fg3m": 1.6, "tov": 1.8,
            "fgm": 5.5, "fga": 12, "ftm": 2.5, "fta": 3.2, "minutes": 30}
    for pid in ids:
        for d in days:
            if not games(pid, d):
                continue
            for s in (*STATS, "minutes"):
                mu = base[s] * scale
                rows.append({"player_id": pid, "date": d, "stat": s, "mean": mu, "sd": np.sqrt(1.3 * mu)})
    return pd.DataFrame(rows)


@pytest.fixture
def cfg():
    return settings()


def test_only_starters_with_a_game_count(cfg):
    r = roster(12)
    td = matchup.team_days(r, proj(r["player_id"]), DAYS[:1], cfg)
    assert td.scheduled == [12] and td.counted == [10]          # 10 active slots
    assert td.mean["pts"][0] == pytest.approx(10 * 15)
    idle = proj(r["player_id"], games=lambda pid, d: pid <= 6)
    td2 = matchup.team_days(r, idle, DAYS[:1], cfg)
    assert td2.counted == [6]                                  # an idle player never counts


def test_matchup_now_even_teams_and_a_stronger_team(cfg):
    a, b = roster(10, 1), roster(10, 101)
    pa = pd.concat([proj(a["player_id"]), proj(b["player_id"])])
    me, opp = matchup.team_days(a, pa, DAYS, cfg), matchup.team_days(b, pa, DAYS, cfg)
    z = matchup.zero_to_date(cfg)
    even = matchup.matchup_now(me, opp, z, z, cfg=cfg)
    assert even.p_win_week == pytest.approx(even.p_win_week)    # finite
    assert 0.35 < even.p_win_week < 0.65                        # identical rosters: near a coin flip
    strong = pd.concat([proj(a["player_id"], 1.15), proj(b["player_id"])])
    me2 = matchup.team_days(a, strong, DAYS, cfg)
    better = matchup.matchup_now(me2, opp, z, z, cfg=cfg)
    assert better.p_cat["pts"] > 0.8 and better.p_cat["tov"] < 0.5    # more volume, more turnovers
    wide = matchup.matchup_now(me2, opp, z, z, var_mult={k: 2.0 for k in better.p_cat}, cfg=cfg)
    assert 0.5 < wide.p_cat["pts"] < better.p_cat["pts"]


def test_live_totals_decide_a_finished_week(cfg):
    a, b = roster(10, 1), roster(10, 101)
    me = matchup.team_days(a, pd.DataFrame(columns=["player_id", "date", "stat", "mean", "sd"]), [], cfg)
    opp = matchup.team_days(b, pd.DataFrame(columns=["player_id", "date", "stat", "mean", "sd"]), [], cfg)
    lead, trail = matchup.zero_to_date(cfg), matchup.zero_to_date(cfg)
    for k in lead.total:
        lead.total[k], trail.total[k] = 100.0, 90.0
    lead.total["tov"], trail.total["tov"] = 50.0, 60.0          # fewer turnovers wins
    for k in lead.made:
        lead.made[k], lead.att[k], trail.made[k], trail.att[k] = 50.0, 100.0, 40.0, 100.0
    done = matchup.matchup_now(me, opp, lead, trail, cfg=cfg)
    assert done.p_win_week == 1.0 and done.expected_cats == 9.0
    assert matchup.cats_lead(lead, trail, cfg) == {"me": 9, "opp": 0}


def test_do_nothing_path_stays_near_today_and_its_band_widens(cfg):
    a, b = roster(10, 1), roster(10, 101)
    pa = pd.concat([proj(a["player_id"], 1.03), proj(b["player_id"])])
    me, opp = matchup.team_days(a, pa, DAYS, cfg), matchup.team_days(b, pa, DAYS, cfg)
    z = matchup.zero_to_date(cfg)
    now = matchup.matchup_now(me, opp, z, z, cfg=cfg)
    path = matchup.do_nothing_path(me, opp, z, z, cfg=cfg, draws=4000, seed=3)
    assert [p.day for p in path] == DAYS
    assert path[0].p_win_week == pytest.approx(now.p_win_week, abs=0.03)   # no drift by itself
    widths = [p.hi - p.lo for p in path]
    assert widths == sorted(widths) and widths[-1] > 0.9                  # by Sunday it's decided
    assert all(p.lo <= p.p_win_week <= p.hi for p in path)


def test_remaining_days_skip_days_yahoo_already_counts(con, cfg):
    start, end = date(2026, 11, 2), date(2026, 11, 8)
    con.execute("INSERT INTO games (game_id, season, game_date, tip_utc, home_team_id, visitor_team_id, "
                "postseason, source, fetched_at) VALUES (1, 2026, '2026-11-04', '2026-11-05 00:00:00+00', "
                "1, 2, false, 'bdl', now())")
    now = datetime(2026, 11, 4, 12, 0, tzinfo=matchup.ET)
    morning = datetime(2026, 11, 4, 9, 0, tzinfo=matchup.ET)            # before the 7 pm ET tip
    night = datetime(2026, 11, 4, 23, 30, tzinfo=matchup.ET)
    assert matchup.remaining_days(con, start, end, morning, now)[0] == date(2026, 11, 4)
    assert matchup.remaining_days(con, start, end, night, now)[0] == date(2026, 11, 5)
    assert matchup.remaining_days(con, start, end, None, now)[0] == date(2026, 11, 4)


def test_correlated_week_matches_independent_when_uncorrelated_and_is_less_sure_when_linked(cfg):
    from research_room import simulate
    a, b = roster(10, 1), roster(10, 101)
    pa = pd.concat([proj(a["player_id"], 1.03), proj(b["player_id"])])
    me, opp = matchup.team_days(a, pa, DAYS, cfg), matchup.team_days(b, pa, DAYS, cfg)
    z0 = matchup.zero_to_date(cfg)
    indep = matchup.matchup_now(me, opp, z0, z0, cfg=cfg)
    eye = matchup.matchup_now(me, opp, z0, z0, cfg=cfg, corr=np.eye(9))
    assert eye.p_win_week == pytest.approx(indep.p_win_week, abs=0.03)
    linked = np.full((9, 9), 0.6) + 0.4 * np.eye(9)
    tied = matchup.matchup_now(me, opp, z0, z0, cfg=cfg, corr=linked)
    assert abs(tied.p_win_week - 0.5) < abs(indep.p_win_week - 0.5)        # linked categories: less sure
    path = matchup.do_nothing_path(me, opp, z0, z0, cfg=cfg, draws=500, corr=linked)
    assert len(path) == len(DAYS) and all(0 <= p.lo <= p.hi <= 1 for p in path)
    z = simulate.correlated_draws(linked, 20_000, seed=1)
    assert np.corrcoef(z.T)[0, 1] == pytest.approx(0.6, abs=0.03)


def test_correlation_round_trip(con, cfg):
    from research_room import calibration
    keys = [c.key for c in cfg.categories]
    corr = pd.DataFrame(np.eye(9) * 0.5 + 0.5, index=keys, columns=keys)
    cal = pd.DataFrame({"category": keys, "multiplier": 1.0, "raw_multiplier": 1.0, "coverage_raw": 0.8,
                        "coverage_80": 0.8, "n_teams": 10, "train_seasons": "2023", "test_season": 2024,
                        "window_start": date(2024, 10, 22), "window_end": date(2025, 4, 13)})
    cal.attrs["corr"] = corr
    calibration.write(con, cal)
    m = calibration.load_correlation(con, cfg)
    assert m.shape == (9, 9) and m[0, 0] == 1.0 and m[0, 1] == 0.5

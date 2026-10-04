from __future__ import annotations

import time

import numpy as np
import pandas as pd
import pytest

from research_room import simulate
from research_room.config import settings

STATS = ("fgm", "fga", "ftm", "fta", "fg3m", "pts", "reb", "ast", "stl", "blk", "tov")


def roster(n=13, scale=1.0, seed=0, **override):
    rng = np.random.default_rng(seed)
    rows = []
    for _ in range(n):
        m = {"fgm": 6, "fga": 13, "ftm": 3, "fta": 4, "fg3m": 1.5, "pts": 16.5, "reb": 5, "ast": 3,
             "stl": 1, "blk": 0.6, "tov": 1.6}
        m = {k: v * scale * (0.8 + 0.4 * rng.random()) for k, v in m.items()}
        m.update(override)
        row = {f"{s}_mean": m[s] for s in STATS}
        row.update({f"{s}_sd": np.sqrt(max(m[s], 1e-6) * 1.3) for s in STATS})
        row["week_games"] = 3.0
        rows.append(row)
    return pd.DataFrame(rows)


@pytest.fixture
def cfg():
    return settings()


def team(df, cfg):
    return simulate.team_week(simulate.contributions(df, cfg))


def test_identical_teams_are_a_coin_flip(cfg):
    t = team(roster(), cfg)
    m = simulate.analytic(t, t, cfg)
    assert all(v == pytest.approx(0.5) for v in m.p_cat.values())
    assert m.expected_cats == pytest.approx(4.5)
    assert m.p_win_week == pytest.approx(0.5)            # symmetric, 9 categories, no ties


def test_better_team_wins_more_and_turnovers_invert(cfg):
    strong, weak = team(roster(scale=1.2), cfg), team(roster(scale=0.9), cfg)
    m = simulate.analytic(strong, weak, cfg)
    assert m.p_cat["pts"] > 0.8 and m.p_win_week > 0.6
    assert m.p_cat["tov"] < 0.5                          # more volume -> more turnovers -> lose TO


def test_percentages_use_makes_over_attempts(cfg):
    good = team(roster(fgm=7.0, fga=13.0), cfg)
    bad = team(roster(fgm=5.5, fga=13.0), cfg)
    assert simulate.analytic(good, bad, cfg).p_cat["fg_pct"] > 0.9


def test_poisson_binomial_matches_brute_force():
    p = np.array([0.2, 0.5, 0.9])
    exact = sum(np.prod([p[i] if (mask >> i) & 1 else 1 - p[i] for i in range(3)])
                for mask in range(8) if bin(mask).count("1") >= 2)
    assert simulate.poisson_binomial_at_least(p[:, None], 2)[0] == pytest.approx(exact)


def test_monte_carlo_agrees_with_analytic(cfg):
    me, opp = team(roster(scale=1.05, seed=1), cfg), team(roster(seed=2), cfg)
    a, mc = simulate.analytic(me, opp, cfg), simulate.monte_carlo(me, opp, cfg, n=20000, seed=3)
    assert mc.p_win_week.item() == pytest.approx(a.p_win_week.item(), abs=0.02)
    assert mc.expected_cats.item() == pytest.approx(a.expected_cats.item(), abs=0.05)


def test_batch_of_candidates_and_speed(cfg):
    base = team(roster(12), cfg)
    candidates = simulate.contributions(roster(500, seed=9), cfg)
    t0 = time.perf_counter()
    batch = simulate.add(base, candidates)
    m = simulate.analytic(batch, team(roster(13, seed=4), cfg), cfg)
    elapsed = time.perf_counter() - t0
    assert m.expected_cats.shape == (500,) and m.p_win_week.shape == (500,)
    one = simulate.analytic(simulate.team_week(pd.concat([simulate.contributions(roster(12), cfg),
                                                          candidates.iloc[[7]]])),
                            team(roster(13, seed=4), cfg), cfg)
    assert m.expected_cats[7] == pytest.approx(one.expected_cats.item())
    assert elapsed < 0.5


def test_twelve_team_evaluation_is_fast(cfg):
    teams = [team(roster(seed=s), cfg) for s in range(12)]
    t0 = time.perf_counter()
    for i in range(12):
        for j in range(12):
            if i != j:
                simulate.monte_carlo(teams[i], teams[j], cfg, n=5000, seed=i * 12 + j)
    assert time.perf_counter() - t0 < 2.0                 # build-prompt requirement

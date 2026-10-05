from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from research_room import calibration, simulate, store
from research_room.config import settings


@pytest.fixture
def cfg():
    s = settings()
    sim = s.simulation.model_copy(
        update={"calibration_teams": 3000, "team_pool": 60, "min_players_per_week": 40})
    return s.model_copy(update={"simulation": sim})


def test_multiplier_recovers_a_known_variance_inflation():
    z = pd.Series(np.random.default_rng(0).normal(0, np.sqrt(1.5), 50_000))
    k = calibration.multiplier(z)
    assert k == pytest.approx(1.5, rel=0.05)
    assert calibration.coverage(z) < 0.75 and calibration.coverage(z, k) == pytest.approx(0.80, abs=0.01)


def _weeks(true_var_scale: float, seed: int) -> pd.DataFrame:
    """Synthetic player-weeks whose real spread is `true_var_scale` x the projected variance."""
    rng = np.random.default_rng(seed)
    rows = []
    for week in range(12):
        for pid in range(80):
            row = {"player_id": pid, "week": f"w{week}"}
            for s in ("pts", "reb", "ast", "stl", "blk", "fg3m", "tov", "fgm", "fga", "ftm", "fta"):
                mu = 5.0 + pid % 7
                v = mu * 1.2
                row[f"{s}_mu"], row[f"{s}_v"] = mu, v
                row[f"{s}_y"] = mu + rng.normal(0, np.sqrt(v * true_var_scale))
            for made, att in (("fgm", "fga"), ("ftm", "fta")):
                row[f"{att}_mu"] = row[f"{att}_y"] = 20.0
                row[f"{made}_mu"] = 9.0
                row[f"{made}_bin"] = 20.0 * 0.45 * 0.55
                row[f"{made}_y"] = rng.binomial(20, 0.45)
            rows.append(row)
    return pd.DataFrame(rows)


def test_team_z_uses_the_simulators_variance_and_recovers_inflation(cfg):
    z = calibration.team_z(_weeks(1.6, seed=1), cfg, seed=3)
    assert set(z.columns) == {c.key for c in cfg.categories}
    assert calibration.multiplier(z["pts"]) == pytest.approx(1.6, rel=0.12)
    assert calibration.multiplier(z["fg_pct"]) == pytest.approx(1.0, rel=0.15)   # binomial is right there


def test_var_mult_only_widens_the_spread(cfg):
    contrib = pd.DataFrame({("mean", c.key): [10.0] for c in cfg.categories if c.kind != "pct"}
                           | {("var", c.key): [4.0] for c in cfg.categories if c.kind != "pct"}
                           | {(kd, c.key): [v] for c in cfg.categories if c.kind == "pct"
                              for kd, v in (("made", 45.0), ("att", 100.0), ("bin_var", 24.75))})
    me = simulate.team_week(contrib)
    opp = simulate.team_week(contrib.mul(0.95))
    base = simulate.analytic(me, opp, cfg)
    same = simulate.analytic(me, opp, cfg, var_mult={c.key: 1.0 for c in cfg.categories})
    wide = simulate.analytic(me, opp, cfg, var_mult={c.key: 2.0 for c in cfg.categories})
    assert same.p_cat["pts"] == pytest.approx(base.p_cat["pts"])
    assert 0.5 < wide.p_cat["pts"] < base.p_cat["pts"]          # still favored, less sure


def test_write_and_load_multipliers(con):
    cal = pd.DataFrame({"category": ["pts", "reb"], "multiplier": [1.25, 1.1], "raw_multiplier": [1.25, 1.1],
                        "coverage_raw": [0.73, 0.75], "coverage_80": [0.78, 0.8], "n_teams": [6000, 6000],
                        "train_seasons": "2023,2024", "test_season": 2025,
                        "window_start": pd.Timestamp("2025-10-21").date(),
                        "window_end": pd.Timestamp("2026-04-12").date()})
    calibration.write(con, cal)
    assert calibration.load_multipliers(con) == {"pts": 1.25, "reb": 1.1}
    scores = con.execute(
        "SELECT stat, coverage_80, mae FROM model_scores WHERE model = 'baseline_team_week'").df()
    assert len(scores) == 2 and scores["mae"].isna().all()
    assert calibration.load_multipliers(store.connect(":memory:")) == {}


def test_monday_states_match_the_live_dummy_row_method():
    """Two independent ways to get a player's state as of Monday must agree."""
    from datetime import date, datetime

    from research_room import features, matchup
    from tests.test_leakage import synthetic
    cfg = settings()
    logs, ctx = synthetic(n_players=8, n_games=40)
    logs = logs.assign(game_date=pd.to_datetime(logs["game_date"]))
    built = features.build(logs, ctx, cfg)
    monday = date(2025, 11, 17)
    cut = pd.Timestamp(datetime.combine(monday, datetime.min.time(), matchup.ET)).tz_convert("UTC")
    fast = calibration.monday_states(built, [cut]).set_index("player_id")
    pre = logs[logs["tip_utc"] < cut]
    last = pre.sort_values("tip_utc").groupby("player_id").tail(1)
    dummy = last.assign(game_id=-last["player_id"], tip_utc=cut, minutes=0.0, did_play=False,
                        usage_pct=np.nan, game_date=pd.Timestamp(monday))
    for s in features.RATE_STATS:
        dummy[s] = 0.0
    slow = features.build(pd.concat([pre, dummy], ignore_index=True), ctx, cfg)
    slow = slow[slow["game_id"] < 0].set_index("player_id")
    cols = ["min_played_ewma", "play_rate_ewma", "pts_pm_ewma", "reb_pm_ewma", "fg3m_pm_ewma"]
    pd.testing.assert_frame_equal(fast.loc[slow.index, cols].astype(float), slow[cols].astype(float),
                                  check_exact=False, rtol=1e-9)


def test_live_player_weeks_count_missed_games_as_zero():
    from research_room import features
    from research_room.projections.baseline import BaselineModel
    from tests.test_leakage import synthetic
    cfg = settings()
    logs, ctx = synthetic(n_players=8, n_games=40)
    logs = logs.assign(game_date=pd.to_datetime(logs["game_date"]))
    built = features.build(logs, ctx, cfg)
    model = BaselineModel(cfg).fit(built[built["min_played_ewma"].notna()])
    games = logs.drop_duplicates(["game_id", "team_id"])
    sched = pd.DataFrame({"team_id": games["team_id"], "game_id": games["game_id"],
                          "date": pd.to_datetime(games["game_date"]).dt.date, "season": 2025})
    # Player 101 vanishes after Nov 20: his scheduled games after that must count 0 actual.
    gone = logs[~((logs["player_id"] == 101) & (logs["game_date"] > "2025-11-20"))]
    w = calibration.live_player_weeks(model, features.build(gone, ctx, cfg), sched, 2025)
    late = w[(w["player_id"] == 101) & (w["week"] > "2025-11-24")]
    assert not late.empty and (late["pts_y"] == 0).all() and (late["pts_mu"] > 0).all()

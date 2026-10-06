"""No feature may use information from after its game's tip (acceptance criterion).

Strategy: build features on full data, then rebuild with every game at or after a cutoff
removed. Rows before the cutoff must be identical: if any feature changed, it was reading the
future. Also checks the `y_` targets never leak into the feature columns."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from research_room import features
from research_room.config import settings

STATS = features.RATE_STATS


def synthetic(n_players=12, n_games=40, seed=0):
    rng = np.random.default_rng(seed)
    start = pd.Timestamp("2025-10-21T23:30:00Z")
    rows, ctx = [], []
    for g in range(n_games):
        tip = start + pd.Timedelta(days=int(g * 1.6))
        gid = 1000 + g
        for team, home in ((1, True), (2, False)):
            ctx.append({"game_id": gid, "team_id": team, "tip_utc": tip,
                        "pace": 98 + rng.normal(0, 2), "def_rating": 112 + rng.normal(0, 4)})
            for p in range(n_players // 2):
                pid = team * 100 + p
                played = rng.random() > 0.1
                minutes = float(max(0, rng.normal(28 - 2 * p, 4))) if played else 0.0
                row = {"player_id": pid, "team_id": team, "game_id": gid, "season": 2025,
                       "game_date": tip.tz_convert("America/New_York").date(), "tip_utc": tip,
                       "home_team_id": 1 if home else 2, "visitor_team_id": 2 if home else 1,
                       "minutes": minutes, "did_play": minutes > 0,
                       "usage_pct": float(rng.uniform(0.12, 0.32)) if minutes else np.nan}
                for s in STATS:
                    row[s] = float(rng.poisson(max(minutes, 0) * 0.15)) if minutes else 0.0
                rows.append(row)
    return pd.DataFrame(rows), pd.DataFrame(ctx)


@pytest.mark.parametrize("cut_game", [8, 20, 33])
def test_features_never_change_when_the_future_is_removed(cut_game):
    logs, ctx = synthetic()
    cfg = settings()
    full = features.build(logs, ctx, cfg)
    cutoff = logs.loc[logs["game_id"] == 1000 + cut_game, "tip_utc"].iloc[0]
    past = features.build(logs[logs["tip_utc"] < cutoff], ctx[ctx["tip_utc"] < cutoff], cfg)
    cols = features.feature_columns(full)
    key = ["player_id", "game_id"]
    a = full[full["tip_utc"] < cutoff].set_index(key).sort_index()[cols]
    b = past.set_index(key).sort_index()[cols]
    pd.testing.assert_frame_equal(a, b, check_exact=False, rtol=1e-12, atol=1e-12)


def test_a_change_to_a_future_game_does_not_move_todays_features():
    logs, ctx = synthetic(seed=1)
    cfg = settings()
    base = features.build(logs, ctx, cfg)
    tampered = logs.copy()
    last = tampered["game_id"].max()
    tampered.loc[tampered["game_id"] == last, ["minutes", "pts"]] = [48.0, 99.0]
    tampered.loc[tampered["game_id"] == last, "did_play"] = True
    moved = features.build(tampered, ctx, cfg)
    cols = features.feature_columns(base)
    key = ["player_id", "game_id"]
    keep = base["game_id"] == last                         # features OF the last game must not move
    pd.testing.assert_frame_equal(base[keep].set_index(key)[cols], moved[keep].set_index(key)[cols])


def test_targets_are_not_features():
    logs, ctx = synthetic()
    f = features.build(logs, ctx)
    cols = features.feature_columns(f)
    assert not [c for c in cols if c.startswith("y_")]
    assert {"y_minutes", "y_pts"} <= set(f.columns)


def test_too_little_history_is_missing_not_guessed():
    logs, ctx = synthetic(n_games=10)
    f = features.build(logs, ctx)
    early = f[f["games_prior"] < settings().features.ewma_min_periods]
    assert not early.empty and early["pts_pm_ewma"].isna().all() and early["min_played_ewma"].isna().all()


def test_first_game_has_no_rest_value_and_b2b_is_flagged():
    logs, ctx = synthetic(n_games=6)
    f = features.build(logs, ctx).sort_values(["player_id", "tip_utc"])
    firsts = f.groupby("player_id").head(1)
    assert firsts["days_rest"].isna().all()
    assert (f.loc[f["days_rest"] == 1, "back_to_back"]).all()


def test_who_sits_in_this_game_never_reaches_its_features():
    """Audit F11: changing only whether a teammate played in a game must not change any feature
    of that game (it may change later games, which is what 'used to' means)."""
    logs, ctx = synthetic(seed=2)
    cfg = settings()
    full = features.build(logs, ctx, cfg)
    gid = 1020
    mate = logs[(logs["game_id"] == gid) & (logs["team_id"] == 1) & logs["did_play"]].iloc[0]
    tampered = logs.copy()
    hit = (tampered["game_id"] == gid) & (tampered["player_id"] == mate["player_id"])
    tampered.loc[hit, ["minutes", "did_play"]] = [0.0, False]
    for s in STATS:
        tampered.loc[hit, s] = 0.0
    other = features.build(tampered, ctx, cfg)
    cols = features.feature_columns(full)
    key = ["player_id", "game_id"]
    a = full[full["game_id"] == gid].set_index(key).sort_index()[cols]
    b = other[other["game_id"] == gid].set_index(key).sort_index()[cols]
    pd.testing.assert_frame_equal(a, b, check_exact=False, rtol=1e-12, atol=1e-12)


def test_a_players_team_as_of_a_moment_comes_from_the_past():
    """Audit F03: editing only a future game's team must not change the team as of earlier."""
    logs, ctx = synthetic(seed=3)
    cfg = settings()
    built = features.build(logs, ctx, cfg)
    cut = logs.loc[logs["game_id"] == 1020, "tip_utc"].iloc[0]
    later = built.copy()
    later.loc[(later["player_id"] == 101) & (later["tip_utc"] >= cut), "team_id"] = 999   # traded later
    a = features.monday_states(built, [cut]).set_index("player_id")
    b = features.monday_states(later, [cut]).set_index("player_id")
    assert a.at[101, "team_id"] == b.at[101, "team_id"] == 1

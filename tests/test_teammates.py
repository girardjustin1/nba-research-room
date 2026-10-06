from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from research_room import teammates
from research_room.config import settings
from research_room.projections.baseline import STATS, BaselineModel


def _team(minutes=(34.0, 30.0, 24.0, 8.0), game_id=1, team_id=10):
    rows = []
    for i, m in enumerate(minutes):
        r = {"player_id": i + 1, "game_id": game_id, "team_id": team_id, "min_played_ewma": m}
        for s in STATS:
            r[f"{s}_pm_ewma"] = 0.5 if s == "pts" else 0.1
        rows.append(r)
    return pd.DataFrame(rows)


def test_missing_minutes_count_rotation_teammates_only():
    df = _team()
    out = teammates.team_out(df, np.array([1.0, 0.0, 0.0, 1.0]), rotation_minutes=12)
    assert out["out_min"].tolist() == [0.0, 34.0, 34.0, 34.0]   # the 8-minute player sitting is no news
    # points share: player 1's 17 of the rotation's (34+30+24) x 0.5 = 44
    assert out.loc[1, "sh_pts"] == pytest.approx(17 / 44)
    half = teammates.team_out(df, np.array([0.5, 0.0, 0.0, 0.0]), rotation_minutes=12)
    assert half.loc[2, "out_min"] == pytest.approx(17.0)          # expected: minutes x P(sits)


def test_what_he_is_used_to_comes_from_earlier_games_only():
    cfg = settings()
    games = []
    for g in range(4):  # player 1 sits games 1 and 2
        t = _team(game_id=g)
        t["tip_utc"] = pd.Timestamp("2025-11-01", tz="UTC") + pd.Timedelta(days=g)
        t["did_play"] = ~((t["player_id"] == 1) & t["game_id"].isin([1, 2]))
        games.append(t)
    df = pd.concat(games).sort_values(["player_id", "tip_utc"]).reset_index(drop=True)
    prior = teammates.prior_states(df, df["did_play"], cfg)
    p2 = prior[df["player_id"] == 2]["tmo_prior_min"].tolist()
    assert np.isnan(p2[0]) and p2[1] == 0.0                       # nothing before game 0; 0 after it
    assert p2[2] > 0 and p2[3] > p2[2]                            # learns the absence only afterwards


def test_fit_recovers_a_planted_minutes_shift_and_predict_moves_minutes():
    cfg = settings()
    on = cfg.model_copy(update={"baseline": cfg.baseline.model_copy(
        update={"teammates": cfg.baseline.teammates.model_copy(update={"enabled": True})})})
    rng = np.random.default_rng(0)
    rows = []
    for g in range(400):
        t = _team(game_id=g)
        sits = rng.random() < 0.4
        t["y_did_play"] = ~((t["player_id"] == 1) & sits)
        bump = 34.0 * 0.25 if sits else 0.0                       # 25% of his minutes to each teammate
        t["y_minutes"] = np.where(t["player_id"] == 1, 0.0 if sits else 34.0, t["min_played_ewma"] + bump)
        for s in STATS:
            t[f"y_{s}"] = t["y_minutes"] * t[f"{s}_pm_ewma"]
        t["tmo_prior_min"] = 0.0
        for s in STATS:
            t[f"tmo_prior_sh_{s}"] = 0.0
        rows.append(t)
    train = pd.concat(rows, ignore_index=True)
    adj = teammates.TeammatesAdjust(on).fit(train)
    assert adj.minutes_delta(np.array([34.0]), np.array([24.0]))[0] == pytest.approx(8.5, abs=0.5)

    model = BaselineModel(on)
    model.phi = {s: 1.0 for s in (*STATS, "minutes")}
    model.teammates = adj
    live = _team().assign(date="2025-11-05", play_rate_ewma=0.95, play_prob=0.95, games_prior=50,
                          season_games=10_000, tmo_prior_min=0.0,
                          **{f"tmo_prior_sh_{s}": 0.0 for s in STATS})
    live["play_prob_override"] = [0.0, np.nan, np.nan, np.nan]   # the injury report: player 1 out
    mins = model.predict(live).query("stat == 'minutes'").set_index("player_id")
    healthy = model.predict(live.assign(play_prob_override=[1.0, 1.0, 1.0, 1.0]))
    before = healthy.query("stat == 'minutes'").set_index("player_id")
    assert mins.at[3, "mean"] / mins.at[3, "p_play"] > before.at[3, "mean"] / before.at[3, "p_play"] + 7
    model.teammates = None                                         # switched off: no shift
    off = model.predict(live).query("stat == 'minutes'").set_index("player_id")
    assert off.at[3, "mean"] / off.at[3, "p_play"] == pytest.approx(24.0)
    model.teammates = adj
    pts = model.predict(live).query("stat == 'pts'").set_index("player_id")
    pts0 = healthy.query("stat == 'pts'").set_index("player_id")
    gained = (pts.at[3, "mean"] / pts.at[3, "p_play"]) / (pts0.at[3, "mean"] / pts0.at[3, "p_play"])
    assert gained > 1.25                                           # his points follow his extra minutes


def test_makes_never_exceed_attempts_when_teammates_sit():
    """Audit F18: makes follow attempts, so the shooting percentage holds."""
    cfg = settings()
    on = cfg.model_copy(update={"baseline": cfg.baseline.model_copy(
        update={"teammates": cfg.baseline.teammates.model_copy(update={"enabled": True})})})
    adj = teammates.TeammatesAdjust(on)
    adj.coef = np.array([0.1, 0.0, 0.0])
    adj.b = {s: 0.0 for s in STATS} | {"ftm": 0.9, "fta": 0.1, "fgm": 0.9, "fga": 0.1}  # deliberately unequal
    model = BaselineModel(on)
    model.phi = {s: 1.0 for s in (*STATS, "minutes")}
    model.teammates = adj
    live = _team().assign(date="2025-11-05", play_rate_ewma=0.95, play_prob=0.95, games_prior=50,
                          season_games=10_000, tmo_prior_min=0.0,
                          **{f"tmo_prior_sh_{s}": 0.0 for s in STATS})
    live["fta_pm_ewma"] = live["ftm_pm_ewma"] = 0.2             # a 100% free-throw shooter
    live["play_prob_override"] = [0.0, np.nan, np.nan, np.nan]
    out = model.predict(live).pivot_table(index="player_id", columns="stat", values="mean")
    assert (out["ftm"] <= out["fta"] + 1e-12).all() and (out["fgm"] <= out["fga"] + 1e-12).all()
    assert out.loc[3, "fta"] > out.loc[3, "fta"] * 0 and out.loc[3, "ftm"] == pytest.approx(out.loc[3, "fta"])

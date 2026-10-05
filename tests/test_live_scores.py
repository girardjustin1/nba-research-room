"""Live scoreboard on a tiny invented store: pre-tip runs only, segments, news, weekly odds."""

from __future__ import annotations

from datetime import UTC, date, datetime

import pandas as pd
import pytest

from research_room import live_scores, store
from research_room.config import settings

DAY = date(2026, 11, 4)
TIP = pd.Timestamp("2026-11-05 00:00", tz="UTC")  # 7 PM Eastern
META = {"source": "test", "fetched_at": pd.Timestamp(datetime(2026, 11, 4, tzinfo=UTC))}


@pytest.fixture
def seeded(con):
    store.upsert(
        con,
        "games",
        pd.DataFrame(
            [
                {
                    "game_id": 7,
                    "season": 2026,
                    "game_date": DAY,
                    "tip_utc": TIP,
                    "status_state": "final",
                    "postseason": False,
                    "home_team_id": 1,
                    "visitor_team_id": 2,
                    **META,
                }
            ]
        ),
    )
    line = {
        "fgm": 0.0,
        "fga": 0.0,
        "ftm": 0.0,
        "fta": 0.0,
        "fg3m": 0.0,
        "reb": 0.0,
        "ast": 0.0,
        "stl": 0.0,
        "blk": 0.0,
        "tov": 0.0,
    }
    store.upsert(
        con,
        "game_logs",
        pd.DataFrame(
            [
                {
                    "game_id": 7,
                    "player_id": 1,
                    "team_id": 1,
                    "season": 2026,
                    "game_date": DAY,
                    "minutes": 30.0,
                    "did_play": True,
                    **line,
                    "pts": 20.0,
                    **META,
                },
                {
                    "game_id": 7,
                    "player_id": 2,
                    "team_id": 1,
                    "season": 2026,
                    "game_date": DAY,
                    "minutes": 0.0,
                    "did_play": False,
                    **line,
                    "pts": 0.0,
                    **META,
                },
            ]
        ),
    )

    def proj(run_at, pid, stat, mean, sd, p, model_mean=None, market=False):
        return {
            "model": "baseline",
            "run_at": run_at,
            "player_id": pid,
            "date": DAY,
            "stat": stat,
            "mean": mean,
            "sd": sd,
            "p_play": p,
            "minutes_mean": None,
            "model_mean": model_mean,
            "market": market,
        }

    before, after = TIP - pd.Timedelta(hours=2), TIP + pd.Timedelta(hours=1)
    store.upsert(
        con,
        "projections",
        pd.DataFrame(
            [
                proj(before, 1, "pts", 18.0, 5.0, 0.9, 16.0, True),
                proj(before, 1, "minutes", 27.0, 6.0, 0.9),
                proj(before, 2, "pts", 5.0, 6.0, 0.5, 5.0),
                proj(before, 2, "minutes", 12.0, 10.0, 0.5),
                proj(after, 1, "pts", 30.0, 5.0, 1.0, 30.0),
                proj(after, 1, "minutes", 40.0, 6.0, 1.0),  # after tip
            ]
        ),
    )
    return con


def test_grades_the_last_pre_tip_run_by_segment(seeded):
    cfg = settings()
    out = live_scores.update(seeded, cfg, through=DAY)
    assert out["status"] == "ok"
    s = seeded.execute("SELECT * FROM live_scores").df().set_index(["stat", "segment"])
    assert s.loc[("pts", "all"), "n"] == 2
    assert s.loc[("pts", "all"), "bias"] == pytest.approx(((18 - 20) + (5 - 0)) / 2)  # not the after-tip run
    assert s.loc[("pts", "played"), "bias"] == pytest.approx(18 / 0.9 - 20)
    assert s.loc[("pts", "market"), "mae"] == pytest.approx(2.0)
    assert s.loc[("pts", "market_model"), "mae"] == pytest.approx(4.0)
    assert s.loc[("p_play", "brier"), "rmse"] == pytest.approx(((0.9 - 1) ** 2 + 0.5**2) / 2)
    assert live_scores.update(seeded, cfg, through=DAY)["status"] == "ok"  # idempotent


def test_news_and_weekly_odds(seeded):
    cfg = settings()
    store.upsert(
        seeded,
        "status_events",
        pd.DataFrame(
            [
                {
                    "event_id": "e1",
                    "player_id": 2,
                    "team_id": 1,
                    "status": "Out",
                    "minutes_cap": None,
                    "starting": None,
                    "confidence": 0.9,
                    "account": "beat",
                    "authority_rank": 3,
                    "ts": TIP - pd.Timedelta(hours=3),
                    **META,
                }
            ]
        ),
    )
    store.upsert(
        seeded,
        "nba_report_teams",
        pd.DataFrame(
            [
                {
                    "report_ts": TIP - pd.Timedelta(hours=2),
                    "game_id": 7,
                    "team_id": 1,
                    "submitted": True,
                    **META,
                }
            ]
        ),
    )
    store.upsert(
        seeded,
        "nba_report_rows",
        pd.DataFrame(
            [
                {
                    "report_ts": TIP - pd.Timedelta(hours=2),
                    "game_id": 7,
                    "team_id": 1,
                    "player_id": 1,
                    "status": "Questionable",
                    "reason": "",
                    **META,
                }
            ]
        ),
    )
    live_scores.update(seeded, cfg, through=DAY)
    news = {(r["source"], r["status"]): r for r in live_scores.summary(seeded, cfg, since=DAY)["news"]}
    assert news[("x", "Out")]["listed"] == 1 and news[("x", "Out")]["played"] == 0
    assert news[("nba_report", "Questionable")]["played_rate"] == 1.0
    assert news[("nba_report", "Questionable")]["assumed"] == cfg.overrides.status_play_prob["Questionable"]
    # week 2 (Nov 2-8): two snapshots, then the final Yahoo file after the week
    me, opp = cfg.league.my_team_id, 99
    store.upsert(
        seeded,
        "matchup_snapshots",
        pd.DataFrame(
            [
                {
                    "week": 2,
                    "ts": pd.Timestamp("2026-11-02 12:00", tz="UTC"),
                    "opponent_team_id": opp,
                    "p_win_week": 0.6,
                },
                {
                    "week": 2,
                    "ts": pd.Timestamp("2026-11-06 12:00", tz="UTC"),
                    "opponent_team_id": opp,
                    "p_win_week": 0.9,
                },
            ]
        ),
    )
    cats = {
        "fg_pct": 0.5,
        "ft_pct": 0.8,
        "fg3m": 40,
        "pts": 400,
        "reb": 150,
        "ast": 90,
        "stl": 30,
        "blk": 20,
        "tov": 50,
    }
    worse = {**cats, "pts": 350, "reb": 140, "ast": 80, "stl": 20, "blk": 10, "tov": 60}
    at = pd.Timestamp("2026-11-09 15:00", tz="UTC")
    store.upsert(
        seeded,
        "yahoo_matchups",
        pd.DataFrame(
            [
                {"snapshot_at": at, "week": 2, "team_id": me, "opponent_team_id": opp, **cats, **META},
                {"snapshot_at": at, "week": 2, "team_id": opp, "opponent_team_id": me, **worse, **META},
            ]
        ),
    )
    odds = live_scores.summary(seeded, cfg, since=DAY)["weekly_odds"]
    assert odds["weeks"] == 1
    assert odds["brier_first_snapshot"] == pytest.approx((0.6 - 1) ** 2)
    assert odds["brier_all_snapshots"] == pytest.approx(((0.6 - 1) ** 2 + (0.9 - 1) ** 2) / 2)

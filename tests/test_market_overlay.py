from __future__ import annotations

from datetime import UTC, datetime, timedelta

import numpy as np
import pandas as pd
import pytest
from scipy.stats import norm

from research_room import store
from research_room.config import settings
from research_room.projections import market

NOW = datetime(2026, 11, 4, 18, 0, tzinfo=UTC)


def test_fit_recovers_a_known_normal_and_guards_bad_ladders():
    k = np.array([19.5, 24.5, 29.5])
    p = 1 - norm.cdf((k - 25.0) / 6.0)
    mu, sd = market.fit(k, p, base_sd=6.5, sd_bounds=(0.5, 2.0))
    assert mu == pytest.approx(25.0, abs=0.05) and sd == pytest.approx(6.0, abs=0.05)
    mu1, sd1 = market.fit(np.array([24.5]), np.array([0.5]), base_sd=6.0, sd_bounds=(0.5, 2.0))
    assert mu1 == pytest.approx(24.5) and sd1 == 6.0  # one line: baseline sd kept
    assert market.fit(k, np.array([0.2, 0.5, 0.7]), 6.0, (0.5, 2.0)) is None  # easier as the line rises
    _, wide = market.fit(np.array([10.5, 30.5]), np.array([0.55, 0.45]), 5.0, (0.5, 2.0))
    assert wide == pytest.approx(10.0)  # sd capped at 2x baseline


def _ladder(con, source, stat, rows, fetched=NOW, vendor="kalshi"):
    store.upsert(
        con,
        "props_ladder",
        pd.DataFrame(
            [
                {
                    "source": source,
                    "game_id": 77,
                    "player_id": 501,
                    "stat": stat,
                    "threshold": t,
                    "side": "over",
                    "prob": p,
                    "ts": pd.Timestamp(fetched),
                    "vendor": vendor,
                    "fetched_at": pd.Timestamp(fetched),
                }
                for t, p in rows
            ]
        ),
    )


def test_overlay_sets_market_games_and_leaves_the_rest(con):
    cfg = settings()
    _ladder(con, "kalshi", "pts", [(19.5, 0.80), (24.5, 0.50), (29.5, 0.20)])
    _ladder(con, "rundown", "pts", [(24.5, 0.52)], vendor="rundown:3")  # median with kalshi at 24.5
    _ladder(con, "kalshi", "blk", [(1.5, 0.3)])  # untested stat: not used
    _ladder(con, "kalshi", "reb", [(7.5, 0.5)], fetched=NOW - timedelta(days=3))  # stale: not used
    proj = pd.DataFrame(
        {
            "player_id": 501,
            "game_id": 77,
            "date": "2026-11-04",
            "stat": ["pts", "reb", "blk", "ast"],
            "mean": [20.0, 6.0, 0.8, 4.0],
            "sd": [6.0, 2.5, 0.9, 2.0],
        }
    )
    out = market.overlay(con, proj, cfg, now=NOW).set_index("stat")
    assert bool(out.at["pts", "market"]) and out.at["pts", "mean"] == pytest.approx(24.5, abs=0.3)
    assert not out.loc[["reb", "blk", "ast"], "market"].any()
    assert out.at["reb", "mean"] == 6.0 and out.at["blk", "mean"] == 0.8
    off = cfg.model_copy(
        update={
            "markets": cfg.markets.model_copy(
                update={"overlay": cfg.markets.overlay.model_copy(update={"enabled": False})}
            )
        }
    )
    assert not market.overlay(con, proj, off, now=NOW)["market"].any()

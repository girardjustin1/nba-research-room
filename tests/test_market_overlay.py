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


def test_if_he_plays_round_trip():
    """A projection with P(plays) splits into its line if he plays and back, exactly."""
    mu_c, sd_c = market.conditional(12.0, 15.0, 0.5)
    assert mu_c == pytest.approx(24.0)
    assert market.unconditional(mu_c, sd_c, 0.5) == pytest.approx((12.0, 15.0))
    assert market.conditional(0.0, 0.0, 0.0) == (0.0, 0.0)


def _proj(p_play, mean_if_plays=20.0, sd_if_plays=6.0):
    mean, sd = market.unconditional(mean_if_plays, sd_if_plays, p_play)
    return pd.DataFrame({"player_id": [501], "game_id": [77], "date": ["2026-11-04"], "stat": ["pts"],
                         "mean": [mean], "sd": [sd], "p_play": [p_play]})


def _news(status, at, cap=None):
    return pd.DataFrame({"player_id": [501], "date": [datetime(2026, 11, 4).date()], "play_prob": [None],
                         "minutes_cap": [cap], "status": [status], "authority": ["beat"],
                         "source": ["X @beat"], "ts": [pd.Timestamp(at)], "note": [None]})


def test_market_line_counts_if_he_plays(con):
    """The ladder is his line if he plays: the projection is P(plays) x the market's line."""
    _ladder(con, "kalshi", "pts", [(19.5, 0.80), (24.5, 0.50), (29.5, 0.20)])
    out = market.overlay(con, _proj(0.5), settings(), now=NOW)
    assert bool(out.at[0, "market"])
    assert out.at[0, "mean"] == pytest.approx(0.5 * 24.5, abs=0.2)
    mu, sd = market.fit(np.array([19.5, 24.5, 29.5]), np.array([0.8, 0.5, 0.2]), 6.0, (0.5, 2.0))
    assert out.at[0, "sd"] == pytest.approx(market.unconditional(mu, sd, 0.5)[1])
    out0 = market.overlay(con, _proj(0.0), settings(), now=NOW)     # ruled out: stays zero
    assert not out0.at[0, "market"] and out0.at[0, "mean"] == 0.0


def test_news_after_the_price_keeps_the_model(con):
    """An Out after the price can't bring his points back; a limiting report after the price
    drops that source; a price after the news, or plain 'available', still counts."""
    _ladder(con, "kalshi", "pts", [(19.5, 0.80), (24.5, 0.50), (29.5, 0.20)])   # priced at NOW
    later = NOW + timedelta(hours=1)
    out = market.overlay(con, _proj(0.0), settings(), now=later, news=_news("Out", later))
    assert not out.at[0, "market"] and out.at[0, "mean"] == 0.0
    q = market.overlay(con, _proj(0.5, 18.0), settings(), now=later, news=_news("Questionable", later))
    assert bool(q.at[0, "market_stale"]) and not q.at[0, "market"]
    assert q.at[0, "mean"] == pytest.approx(9.0)                         # the model's number stands
    cap = market.overlay(con, _proj(1.0, 18.0), settings(), now=later, news=_news("Available", later, 24))
    assert bool(cap.at[0, "market_stale"])                               # a minutes cap limits him
    ok = market.overlay(con, _proj(1.0), settings(), now=later, news=_news("Available", later))
    assert bool(ok.at[0, "market"])
    old = market.overlay(con, _proj(0.5), settings(), now=later,
                         news=_news("Questionable", NOW - timedelta(hours=2)))
    assert bool(old.at[0, "market"])                                     # priced after the news
    _ladder(con, "rundown", "pts", [(29.5, 0.50)], fetched=later + timedelta(minutes=5), vendor="rundown:3")
    mixed = market.overlay(con, _proj(1.0), settings(), now=later + timedelta(minutes=10),
                           news=_news("Questionable", later))
    assert bool(mixed.at[0, "market"])
    assert mixed.at[0, "mean"] == pytest.approx(29.5, abs=0.01)          # only the newer price

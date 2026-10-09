"""The props test (research_room/props_test.py, jobs/props_test.py) on invented data, no network."""

from __future__ import annotations

from datetime import UTC, datetime

import numpy as np
import pandas as pd
import pytest
from jobs import props_test as job
from scipy.stats import nbinom, norm

from research_room import props_test as pt
from research_room.config import PropsTestConfig, settings


def cfg_small(**kw) -> PropsTestConfig:
    base = {"first_games": 4, "step_games": 2, "max_games": 8, "min_rungs": 10, "draws": 500, "seed": 7}
    return PropsTestConfig(**(base | kw))


# ------------------------------------------------------------------ sample
def test_sample_order_is_fixed_by_the_seed_not_the_input_order():
    a = pt.sample_order([5, 3, 9, 1, 7], seed=1)
    assert a == pt.sample_order([9, 7, 5, 3, 1], seed=1)
    assert sorted(a) == [1, 3, 5, 7, 9]
    assert a != pt.sample_order([5, 3, 9, 1, 7], seed=2)


def test_next_size_grows_while_a_judged_stat_is_short_and_stops_at_the_cap():
    c = cfg_small()
    enough = {"fg3m": 10, "stl": 10, "blk": 10}
    assert pt.next_size(4, enough, c, available=100) is None
    assert pt.next_size(4, enough | {"stl": 3}, c, available=100) == 6
    assert pt.next_size(8, enough | {"stl": 3}, c, available=100) is None       # max_games
    assert pt.next_size(4, enough | {"blk": 0}, c, available=5) == 5            # the games there are
    assert pt.next_size(4, {"fg3m": 10, "stl": 10, "blk": 10, "pts": 0}, c, available=100) is None


# ------------------------------------------------------------------ price
def candle(end, bid, ask, vol):
    return {"end_period_ts": end, "yes_bid": {"close": f"{bid:.4f}"}, "yes_ask": {"close": f"{ask:.4f}"},
            "volume": f"{vol:.2f}"}


def test_pretip_quote_takes_the_last_candle_before_tip_and_the_volume_up_to_it():
    tip = 10_000
    cs = [candle(6_400, 0.30, 0.50, 40), candle(10_000, 0.41, 0.45, 70), candle(13_600, 0.90, 0.99, 500)]
    q = pt.pretip_quote(cs, tip)
    assert q == {"bid": 0.41, "ask": 0.45, "volume": 110.0, "candle_end": 10_000}
    assert pt.pretip_quote([candle(13_600, 0.4, 0.5, 9)], tip) is None
    assert pt.pretip_quote([], tip) is None


def test_liquid_mid_is_the_live_rule():
    cfg = settings()
    assert pt.liquid_mid({"bid": 0.41, "ask": 0.45, "volume": 150.0}, cfg) == pytest.approx(0.43)
    assert pt.liquid_mid({"bid": 0.30, "ask": 0.45, "volume": 500.0}, cfg) is None    # spread 15c
    assert pt.liquid_mid({"bid": 0.41, "ask": 0.45, "volume": 99.0}, cfg) is None     # thin
    assert pt.liquid_mid({"bid": 0.0, "ask": 0.05, "volume": 500.0}, cfg) is None     # one quote
    assert pt.liquid_mid(None, cfg) is None


# ------------------------------------------------------------------ baseline P(over)
def test_normal_tail_above_the_line():
    p = pt.p_over_normal([10.0, 10.0, 3.0], [4.0, 0.0, 0.0], [12.5, 9.5, 3.5])
    assert p[0] == pytest.approx(norm.sf(12.5, 10, 4))
    assert list(p[1:]) == [1.0, 0.0]                                             # point mass


def test_count_tail_is_poisson_or_negative_binomial():
    p = pt.p_over_count([1.0, 2.0, 0.0], [1.0, 2.0, 0.0], [0.5, 1.5, 0.5])
    assert p[0] == pytest.approx(1 - np.exp(-1))                                 # Poisson: var = mean
    r = 2.0**2 / (4.0 - 2.0)
    assert p[1] == pytest.approx(nbinom.sf(1, r, r / (r + 2.0)))                 # P(X >= 2), var 4
    assert p[2] == 0.0


def rungs_frame(n_games=12, per_game=3, market_err=0.05, base_err=0.30, seed=0):
    """Invented rungs: the market close to what happened, the baseline far off."""
    rng = np.random.default_rng(seed)
    rows = []
    for g in range(n_games):
        for k in range(per_game):
            y = int(rng.random() < 0.5)
            rows.append({"game_id": g, "player_id": 100 + k, "stat": "stl", "threshold": 0.5, "y": y,
                         "p_market": abs(y - market_err), "mu": 1.0, "sd": 1.0, "p_play": 0.9,
                         "actual": float(y)})
    df = pd.DataFrame(rows)
    df = pt.add_baseline(df)
    df["p_base"] = np.abs(df["y"] - base_err)                                     # force a worse baseline
    return df


def test_add_baseline_keeps_the_old_comparison_for_f17():
    df = pt.add_baseline(pd.DataFrame({"mu": [1.2], "sd": [1.1], "threshold": [0.5], "p_play": [0.8]}))
    assert df["p_base_old"].iloc[0] == pytest.approx(0.8 * df["p_base"].iloc[0])
    assert 0 < df["p_base_count"].iloc[0] < 1


# ------------------------------------------------------------------ scores and the rule
def test_paired_range_resamples_whole_games():
    a, b = np.array([0.1, 0.1, 0.2, 0.2]), np.array([0.2, 0.2, 0.25, 0.25])
    d, lo, hi = pt.paired_range(a, b, np.array([1, 1, 2, 2]), draws=200, level=0.8, seed=0)
    assert d == pytest.approx(-0.075)
    assert -0.1 - 1e-12 <= lo <= hi <= -0.05 + 1e-12


def test_decide():
    c = cfg_small()
    assert pt.decide(9, -0.01, c) == "baseline keeps (too few rungs)"
    assert pt.decide(10, -0.001, c) == "market leads"
    assert pt.decide(10, 0.002, c) == "baseline keeps (not shown)"


def test_score_applies_the_rule_to_judged_stats_only():
    c = cfg_small()
    df = rungs_frame()
    row = pt.score(df, c).iloc[0]
    assert row["rungs"] == 36 and row["games"] == 12
    assert row["brier_market"] == pytest.approx(0.05**2)
    assert row["brier_base"] == pytest.approx(0.30**2)
    assert row["hi"] < 0 and row["decision"] == "market leads"
    few = pt.score(df[df["game_id"] < 3], c).iloc[0]                             # 9 rungs < 10
    assert few["decision"] == "baseline keeps (too few rungs)"
    ref = pt.score(df.assign(stat="pts"), c).iloc[0]
    assert not ref["judged"] and ref["decision"] == "reference (no rule)"


def test_calibration_bands():
    df = rungs_frame()
    cal = pt.calibration(df, "p_market")
    assert set(cal["band"]) == {"(0.8, 1.0]", "[0.0, 0.2]"} or len(cal) == 2
    assert cal["n"].sum() == len(df)
    top = cal[cal["predicted"] > 0.5].iloc[0]
    assert top["happened"] == 1.0


def test_implied_means_recover_a_normal_ladder():
    mu, sd = 24.0, 6.0
    k = np.array([19.5, 24.5, 29.5])
    df = pd.DataFrame({"game_id": 1, "player_id": 7, "stat": "pts", "threshold": k,
                       "p_market": norm.sf(k, mu, sd), "mu": 21.0, "sd": 6.5, "actual": 25.0})
    m = pt.implied_means(df, (0.5, 2.0))
    assert m["market_mean"].iloc[0] == pytest.approx(mu, abs=1e-6)
    t = pt.rmse_table(pd.concat([m.assign(game_id=g) for g in range(5)]), cfg_small()).iloc[0]
    assert t["rmse_market"] == pytest.approx(1.0, abs=1e-6) and t["rmse_base"] == pytest.approx(4.0)


# ------------------------------------------------------------------ the job's fetch, offline
class FakeArchive:
    """Invented Kalshi answers: one steals event, two rungs."""

    def __init__(self):
        self.calls = []

    def paged(self, path, params, key):
        self.calls.append(path)
        return [
            {"ticker": "KXNBASTL-26MAR03NOPLAL-LALLJAMES23-1", "event_ticker": "KXNBASTL-26MAR03NOPLAL",
             "title": "LeBron James: 1+ steals", "floor_strike": 0.5, "volume_fp": "400.00",
             "open_time": "2026-03-02T15:00:00Z", "result": "yes"},
            {"ticker": "KXNBASTL-26MAR03NOPLAL-LALLJAMES23-2", "event_ticker": "KXNBASTL-26MAR03NOPLAL",
             "title": "LeBron James: 2+ steals", "floor_strike": 1.5, "volume_fp": "40.00",
             "open_time": "2026-03-02T15:00:00Z", "result": "no"},
        ]

    def get(self, path, params):
        self.calls.append(path)
        tip = params["end_ts"]
        return {"candlesticks": [candle(tip - 3600, 0.60, 0.66, 120), candle(tip + 3600, 0.99, 1.0, 900)]}


def test_fetch_game_prices_only_rungs_that_could_be_liquid():
    cfg = settings()
    tip = datetime(2026, 3, 4, 3, 0, tzinfo=UTC)
    arch = FakeArchive()
    df = job.fetch_game(arch, cfg, 42, tip, {"KXNBASTL": "KXNBASTL-26MAR03NOPLAL"}, {"KXNBASTL": "stl"})
    assert list(df["threshold"]) == [0.5, 1.5]
    assert df["p_market"].iloc[0] == pytest.approx(0.63)
    assert pd.isna(df["p_market"].iloc[1])                     # 40 contracts all life: never fetched
    assert sum(c.endswith("/candlesticks") for c in arch.calls) == 1
    assert (df["game_id"] == 42).all() and set(df["stat"]) == {"stl"}


def test_archive_reads_its_cache_offline(tmp_path):
    arch = job.Archive("https://example.invalid", tmp_path, per_second=100, offline=True)
    with pytest.raises(RuntimeError, match="not cached"):
        arch.get("/events", {"series_ticker": "KXNBASTL"})
    import hashlib
    import json

    key = hashlib.sha1(("/events" + json.dumps({"series_ticker": "X"}, sort_keys=True)).encode()).hexdigest()
    (tmp_path / key[:2]).mkdir()
    (tmp_path / key[:2] / f"{key}.json").write_text(json.dumps({"events": [{"event_ticker": "X-1"}]}))
    assert arch.paged("/events", {"series_ticker": "X"}, "events") == [{"event_ticker": "X-1"}]
    assert arch.fetched == 0

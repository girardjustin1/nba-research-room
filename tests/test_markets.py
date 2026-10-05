"""Betting-market ingest (Kalshi, TheRundown) on recorded-shape fixtures with invented players."""

from __future__ import annotations

from datetime import UTC, date, datetime

import pandas as pd
import pytest

from research_room import store
from research_room.config import settings
from research_room.ingest import kalshi, rundown

NOW = datetime(2026, 11, 3, 18, 0, tzinfo=UTC)
META = {"source": "test", "fetched_at": pd.Timestamp(NOW)}


@pytest.fixture
def cfg():
    return settings()


@pytest.fixture
def seeded(con):
    store.upsert(
        con,
        "teams",
        pd.DataFrame(
            [{"team_id": 1, "abbreviation": "NYK", **META}, {"team_id": 2, "abbreviation": "SAS", **META}]
        ),
    )
    store.upsert(
        con,
        "games",
        pd.DataFrame(
            [
                {
                    "game_id": 77,
                    "season": 2026,
                    "game_date": date(2026, 11, 4),
                    "home_team_id": 2,
                    "visitor_team_id": 1,
                    "postseason": False,
                    **META,
                }
            ]
        ),
    )
    store.upsert(
        con,
        "players",
        pd.DataFrame(
            [
                {"player_id": 501, "full_name": "Invented Guard", "team_id": 1, **META},
                {"player_id": 502, "full_name": "Made Up Center", "team_id": 2, **META},
            ]
        ),
    )
    return con


def rung(player, team, k, bid, ask, vol, uuid="u1"):
    return {
        "ticker": f"KXNBAPTS-26NOV04NYKSAS-{team}XPLAYER1-{k}",
        "event_ticker": "KXNBAPTS-26NOV04NYKSAS",
        "title": f"{player}: {k}+ points",
        "floor_strike": k - 0.5,
        "yes_bid_dollars": f"{bid:.4f}",
        "yes_ask_dollars": f"{ask:.4f}",
        "last_price_dollars": f"{(bid + ask) / 2:.4f}",
        "volume_fp": f"{vol:.2f}",
        "open_interest_fp": "100.00",
        "custom_strike": {"basketball_player": uuid},
        "updated_time": "2026-11-03T17:00:00Z",
    }


def test_event_ticker_and_liquidity_rules(cfg):
    assert kalshi.parse_event_ticker("KXNBAPTS-26JUN13NYKSAS") == (date(2026, 6, 13), "NYK", "SAS")
    assert kalshi.parse_event_ticker("garbage") is None
    df = kalshi.parse_props(
        [
            rung("Invented Guard", "NYK", 20, 0.60, 0.62, 5000),
            rung("Invented Guard", "NYK", 25, 0.30, 0.50, 5000),  # spread too wide
            rung("Invented Guard", "NYK", 30, 0.10, 0.12, 5),
        ],
        "pts",
        NOW,
        cfg,
    )  # too thin
    assert df["prob"].tolist()[0] == pytest.approx(0.61)
    assert df["prob"].isna().tolist() == [False, True, True]  # quotes kept, probability missing
    assert df["team"].tolist() == ["NYK"] * 3 and df["threshold"].tolist() == [19.5, 24.5, 29.5]


class FakeClient:
    def __init__(self, pages):
        self.pages, self.calls = pages, []

    def get(self, url, params=None):
        self.calls.append((url, params))
        for key, page in self.pages.items():
            if key in url + str(params):
                return page
        return {"markets": [], "events": []}


def test_kalshi_sync_writes_ladders_matches_games_and_quarantines(seeded, cfg):
    pages = {
        "KXNBAPTS": {
            "markets": [
                rung("Invented Guard", "NYK", 20, 0.60, 0.62, 5000),
                rung("Invented Guard", "NYK", 25, 0.45, 0.47, 5000),
                rung("Nobody Known", "SAS", 10, 0.5, 0.52, 5000, uuid="u9"),
            ]
        },
        "KXNBAGAME": {
            "markets": [
                {
                    "ticker": "KXNBAGAME-26NOV04NYKSAS-SAS",
                    "event_ticker": "KXNBAGAME-26NOV04NYKSAS",
                    "yes_bid_dollars": "0.6000",
                    "yes_ask_dollars": "0.6200",
                    "volume_fp": "900",
                }
            ]
        },
    }
    out = kalshi.sync(seeded, cfg, client=FakeClient(pages), now=NOW)
    assert out == {"prop_rungs": 2, "game_sides": 1, "unmatched_rungs": 1}
    lad = kalshi.implied_ladder(seeded, 501, "pts", 77)
    assert lad["threshold"].tolist() == [19.5, 24.5] and lad["p_over"].tolist() == pytest.approx([0.61, 0.46])
    q = seeded.execute("SELECT raw_name FROM unresolved_names WHERE source = 'kalshi'").fetchall()
    assert q == [("Nobody Known",)]
    side = seeded.execute("SELECT side, prob FROM odds WHERE vendor = 'kalshi'").fetchall()
    assert side[0][0] == "home" and side[0][1] == pytest.approx(0.61)


def test_implied_ladder_is_never_increasing(seeded, cfg):
    rows = pd.DataFrame(
        {
            "source": "kalshi",
            "game_id": 77,
            "player_id": 501,
            "stat": "reb",
            "side": "over",
            "threshold": [4.5, 6.5, 8.5],
            "prob": [0.70, 0.74, 0.30],
            "ts": pd.Timestamp(NOW),
            "vendor": "kalshi",
            "fetched_at": pd.Timestamp(NOW),
        }
    )
    store.upsert(seeded, "props_ladder", rows)
    assert kalshi.implied_ladder(seeded, 501, "reb", 77)["p_over"].tolist() == [0.70, 0.70, 0.30]
    assert kalshi.implied_ladder(seeded, 501, "ast", 77).empty


def _event():
    price = lambda p, main=True: {"price": p, "is_main_line": main, "updated_at": "2026-11-03T17:00:00Z"}  # noqa: E731
    return {
        "event_id": "e1",
        "event_date": "2026-11-05T00:30:00Z",
        "teams": [
            {"team_id": 18, "abbreviation": "NY", "is_home": False},
            {"team_id": 30, "abbreviation": "SA", "is_home": True},
        ],
        "markets": [
            {
                "market_id": 1,
                "participants": [
                    {
                        "id": 18,
                        "type": "TYPE_TEAM",
                        "name": "NY",
                        "lines": [{"id": "m1", "prices": {"19": price(150)}}],
                    },
                    {
                        "id": 30,
                        "type": "TYPE_TEAM",
                        "name": "SA",
                        "lines": [{"id": "m2", "prices": {"19": price(-170)}}],
                    },
                ],
            },
            {
                "market_id": 3,
                "participants": [
                    {
                        "id": 9,
                        "type": "TYPE_RESULT",
                        "name": "Over",
                        "lines": [{"id": "t1", "value": "221.5", "prices": {"19": price(-110)}}],
                    },
                    {
                        "id": 10,
                        "type": "TYPE_RESULT",
                        "name": "Under",
                        "lines": [{"id": "t2", "value": "221.5", "prices": {"19": price(-110)}}],
                    },
                ],
            },
            {
                "market_id": 29,
                "participants": [
                    {
                        "id": 4401,
                        "type": "TYPE_PLAYER",
                        "name": "Invented Guard",
                        "lines": [
                            {"id": "p1", "value": "Over 22.5", "prices": {"23": price(-120, False)}},
                            {"id": "p2", "value": "Under 22.5", "prices": {"23": price(100, False)}},
                            {"id": "p3", "value": "Over 30.5", "prices": {"23": price(250, False)}},
                        ],
                    },
                    {
                        "id": 4402,
                        "type": "TYPE_PLAYER",
                        "name": "Ghost Player",
                        "lines": [{"id": "p4", "value": "Over 9.5", "prices": {"23": price(-110, False)}}],
                    },
                ],
            },
        ],
    }


def test_rundown_parse_and_sync(seeded, cfg):
    lines, props = rundown.parse_event(_event(), cfg, NOW)
    assert set(lines["market"]) == {"moneyline", "total"} and set(lines["side"]) == {
        "home",
        "away",
        "over",
        "under",
    }
    assert props["threshold"].tolist() == [22.5, 22.5, 30.5, 9.5]
    out = rundown.sync(
        seeded,
        cfg,
        client=FakeClient({"events/2026-11-04": {"events": [_event()]}}),
        today=date(2026, 11, 4),
        now=NOW,
    )
    assert out["game_lines"] == 4 and out["prop_lines"] == 3 and out["unmatched_props"] == 1
    ml = dict(
        seeded.execute(
            "SELECT side, prob FROM odds WHERE vendor = 'rundown:19' AND market = 'moneyline'"
        ).fetchall()
    )
    assert ml["home"] + ml["away"] == pytest.approx(1.0) and ml["home"] > ml["away"]  # de-vigged pair
    pp = seeded.execute(
        "SELECT threshold, side, prob FROM props_ladder WHERE source = 'rundown' ORDER BY threshold, side"
    ).fetchall()
    assert pp[0][2] + pp[1][2] == pytest.approx(1.0)  # 22.5 over/under pair
    assert pp[2][0] == 30.5 and pp[2][2] is None  # no pair -> price kept, no probability


def test_both_kalshi_title_formats_give_the_player():
    assert kalshi.player_from_title("Jalen Brunson: 30+ points") == "Jalen Brunson"
    assert kalshi.player_from_title("Kawhi Leonard records 25+ points") == "Kawhi Leonard"
    assert kalshi.player_from_title("De'Aaron Fox records 8+ assists") == "De'Aaron Fox"
    assert kalshi.player_from_title("Denver wins") is None
    df = kalshi.parse_props(
        [
            {
                **rung("Invented Guard", "NYK", 20, 0.6, 0.62, 5000),
                "title": "Invented Guard records 20+ points",
            }
        ],
        "pts",
        NOW,
        settings(),
    )
    assert df["player_name"].tolist() == ["Invented Guard"]

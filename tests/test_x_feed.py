"""X news feed with a fake X client and a fake parser: no paid calls."""

from __future__ import annotations

from datetime import UTC, date, datetime

import pandas as pd
import pytest

from research_room import store
from research_room.config import settings
from research_room.ingest import x_feed

NOW = datetime(2026, 11, 4, 21, 0, tzinfo=UTC)  # 4 pm ET, game day
META = {"source": "test", "fetched_at": pd.Timestamp(NOW)}


@pytest.fixture
def seeded(con):
    store.upsert(
        con,
        "teams",
        pd.DataFrame(
            [{"team_id": 1, "abbreviation": "BOS", **META}, {"team_id": 2, "abbreviation": "MIA", **META}]
        ),
    )
    store.upsert(
        con,
        "games",
        pd.DataFrame(
            [
                {
                    "game_id": 9,
                    "season": 2026,
                    "game_date": date(2026, 11, 4),
                    "home_team_id": 1,
                    "visitor_team_id": 2,
                    "postseason": False,
                    "tip_utc": pd.Timestamp("2026-11-05T00:30:00Z"),
                    **META,
                }
            ]
        ),
    )
    store.upsert(
        con, "players", pd.DataFrame([{"player_id": 501, "full_name": "Invented Wing", "team_id": 1, **META}])
    )
    return con


class FakeX:
    def __init__(self, posts):
        self.posts, self.calls = posts, []

    def get(self, url, params=None):
        self.calls.append(params)
        return {"data": self.posts, "includes": {"users": [{"id": "u1", "username": "celtics"}]}}


class FakeParser:
    def __init__(self):
        self.seen = []

    def parse(self, posts):
        self.seen += posts
        return [
            {
                "post_id": p["id"],
                "player": "Invented Wing",
                "team": "BOS",
                "status": "Questionable",
                "minutes_cap": None,
                "starting": None,
                "confidence": 0.9,
            }
            for p in posts
        ] + [
            {
                "post_id": posts[0]["id"],
                "player": "Nobody Known",
                "team": "MIA",
                "status": "Out",
                "confidence": 0.8,
            }
        ]


def _posts():
    return [
        {
            "id": "100",
            "author_id": "u1",
            "created_at": "2026-11-04T20:30:00Z",
            "text": "Invented Wing (ankle) is questionable for tonight.",
        },
        {
            "id": "101",
            "author_id": "u1",
            "created_at": "2026-11-04T20:40:00Z",
            "text": "Great win last night!",
        },
    ]


def test_queries_fit_the_limit_and_cover_every_handle():
    handles = [f"handle_{i:03d}" for i in range(60)]
    qs = x_feed.queries(handles, 512)
    assert all(len(q) <= 512 for q in qs) and len(qs) > 1
    assert sorted(h for q in qs for h in handles if f"from:{h}" in q) == handles


def test_watch_list_keeps_team_accounts_for_teams_playing_only():
    acc = pd.DataFrame(
        {
            "handle": ["NBA", "Insider", "celtics", "heatbeat", "lakers"],
            "user_id": "1",
            "team": [None, None, "BOS", "MIA", "LAL"],
            "tier": ["official", "insider", "official", "beat", "official"],
        }
    )
    assert x_feed.watch_list(acc, {"BOS", "MIA"})["handle"].tolist() == [
        "NBA",
        "Insider",
        "celtics",
        "heatbeat",
    ]


def test_poll_writes_status_events_and_keeps_no_text(seeded):
    parser = FakeParser()
    out = x_feed.poll(seeded, settings(), client=FakeX(_posts()), parser=parser, now=NOW)
    assert out["status"] == "ok" and out["events"] == 1
    assert [p["id"] for p in parser.seen] == ["100"]  # the non-news post never reaches the LLM
    ev = seeded.execute("SELECT player_id, status, account, authority_rank FROM status_events").fetchall()
    assert ev == [(501, "Questionable", "celtics", 1)]  # official team account outranks all
    assert "text" not in seeded.execute("SELECT * FROM status_events LIMIT 0").df().columns
    q = seeded.execute("SELECT raw_name FROM unresolved_names WHERE source = 'x'").fetchall()
    assert q == [("Nobody Known",)]


def test_budget_is_hard_and_no_games_means_no_reads(seeded):
    cfg = settings()
    tight = cfg.model_copy(update={"x_feed": cfg.x_feed.model_copy(update={"daily_read_budget": 2})})
    fx = FakeX(_posts())
    first = x_feed.poll(seeded, tight, client=fx, parser=FakeParser(), now=NOW)
    assert first["posts_read"] == 0 and fx.calls == []  # under 10 left: no search at all
    store.upsert(
        seeded,
        "x_feed_log",
        pd.DataFrame(
            [{"poll_at": pd.Timestamp(NOW), "query_key": "k", "day": date(2026, 11, 4), "posts_read": 300}]
        ),
    )
    spent = x_feed.poll(seeded, cfg, client=FakeX(_posts()), parser=FakeParser(), now=NOW)
    assert spent["status"] == "skipped" and "budget" in spent["reason"]
    off = x_feed.poll(
        seeded, cfg, client=FakeX(_posts()), parser=FakeParser(), now=datetime(2026, 11, 6, 21, tzinfo=UTC)
    )
    assert off == {"status": "skipped", "reason": "no games today"}


class TimeFrameParser(FakeParser):
    def parse(self, posts):
        self.seen += posts
        return [{"post_id": posts[0]["id"], "player": "Invented Wing", "team": "BOS", "status": "Out",
                 "out_days_min": 14, "out_days_max": "21", "confidence": 0.9}]


def test_a_stated_time_frame_is_stored_in_days(seeded):
    x_feed.poll(seeded, settings(), client=FakeX(_posts()), parser=TimeFrameParser(), now=NOW)
    ev = seeded.execute("SELECT status, out_days_min, out_days_max FROM status_events").fetchall()
    assert ev == [("Out", 14.0, 21.0)]
    assert x_feed._days("soon") is None and x_feed._days(0) is None

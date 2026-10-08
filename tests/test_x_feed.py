"""X news feed with a fake X client and a fake parser: no paid calls."""

from __future__ import annotations

from datetime import UTC, date, datetime

import pandas as pd
import pytest

from research_room import overrides, store
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


class DatedParser(FakeParser):
    """Each post's status, with the game date the post states (None: not stated)."""

    def __init__(self, stated=None):
        super().__init__()
        self.stated = stated

    def parse(self, posts):
        self.seen += posts
        return [{"post_id": p["id"], "player": "Invented Wing", "team": None, "status": "Out",
                 "game_date": self.stated, "confidence": 0.9} for p in posts]


def _next_game(con):
    store.upsert(con, "games", pd.DataFrame([{
        "game_id": 10, "season": 2026, "game_date": date(2026, 11, 6), "home_team_id": 2,
        "visitor_team_id": 1, "postseason": False, "tip_utc": pd.Timestamp("2026-11-07T00:30:00Z"), **META}]))


def _one_post(at, text="Invented Wing is out."):
    return [{"id": "200", "author_id": "u1", "created_at": at, "text": text}]


def test_a_status_is_tied_to_the_game_it_is_about(seeded):
    _next_game(seeded)
    parser = DatedParser()
    x_feed.poll(seeded, settings(), client=FakeX(_one_post("2026-11-04T20:30:00Z")), parser=parser, now=NOW)
    assert parser.seen[0]["at_et"] == "Wednesday 2026-11-04 15:30 ET"   # relative days are read from it
    row = seeded.execute("SELECT team_id, game_id, game_date, game_basis FROM status_events").fetchone()
    assert row == (1, 9, date(2026, 11, 4), "next_game")             # team from the players table


def test_a_late_night_post_is_about_the_next_game_not_tonight(seeded):
    _next_game(seeded)
    late = datetime(2026, 11, 5, 4, 0, tzinfo=UTC)                   # 11 pm ET, after tonight's tip
    x_feed.poll(seeded, settings(), client=FakeX(_one_post("2026-11-05T03:55:00Z")), parser=DatedParser(),
                now=late)
    row = seeded.execute("SELECT game_id, game_date FROM status_events").fetchone()
    assert row == (10, date(2026, 11, 6))
    ov = overrides.from_status_events(seeded, date(2026, 11, 4), date(2026, 11, 7), late, settings())
    assert ov["date"].tolist() == [date(2026, 11, 6)] and not ov["carried"].any()   # audit B10


def test_a_stated_date_wins_and_a_date_without_a_game_falls_back(seeded):
    _next_game(seeded)
    x_feed.poll(seeded, settings(), client=FakeX(_one_post("2026-11-04T20:30:00Z")),
                parser=DatedParser("2026-11-06"), now=NOW)
    assert seeded.execute("SELECT game_id, game_basis FROM status_events").fetchone() == (10, "stated")
    seeded.execute("DELETE FROM status_events")
    seeded.execute("DELETE FROM x_feed_log")
    x_feed.poll(seeded, settings(), client=FakeX(_one_post("2026-11-04T20:30:00Z")),
                parser=DatedParser("2026-11-05"), now=NOW)                # no game that day
    assert seeded.execute("SELECT game_id, game_basis FROM status_events").fetchone() == (9, "next_game")


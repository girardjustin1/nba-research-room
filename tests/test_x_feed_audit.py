"""The round-3 audit fixes for the X feed and the overrides (invented posts and players only)."""

from __future__ import annotations

from datetime import UTC, date, datetime
from types import SimpleNamespace

import pandas as pd
import pytest

from research_room import overrides, store
from research_room.config import settings
from research_room.ingest import x_feed
from tests.test_x_feed import META, NOW, seeded  # noqa: F401 - the fixture

OUT = {"player": "Invented Wing", "team": "BOS", "status": "Out", "confidence": 0.9}


def _post(i, at="2026-11-04T20:30:00Z", text="Invented Wing is out tonight."):
    return {"id": str(i), "author_id": "u1", "created_at": at, "text": text}


class Pages:
    """A search that returns `per` posts a page, newest first, with next_token until the end."""

    def __init__(self, posts, per=100):
        self.posts, self.per, self.calls = posts, per, []

    def get(self, url, params=None):
        self.calls.append(dict(params))
        k = int(params.get("next_token") or 0)
        page = self.posts[k : k + self.per]
        meta = {"next_token": str(k + self.per)} if k + self.per < len(self.posts) else {}
        return {"data": page, "includes": {"users": [{"id": "u1", "username": "celtics"}]}, "meta": meta}


class Echo:
    """A perfect parser: one Out for each post it is given."""

    def __init__(self):
        self.seen = []

    def parse(self, posts):
        self.seen += posts
        return [{**OUT, "post_id": p["id"]} for p in posts]


class Boom:
    def parse(self, posts):
        raise RuntimeError("model down")


def test_reads_stay_counted_when_parsing_fails_and_nothing_moves_on(seeded):  # noqa: F811
    with pytest.raises(RuntimeError):
        x_feed.poll(seeded, settings(), client=Pages([_post(1), _post(2)]), parser=Boom(), now=NOW)
    left = x_feed.budget_left(seeded, date(2026, 11, 4), settings())
    assert left == settings().x_feed.daily_read_budget - 2
    assert seeded.execute("SELECT count(*) FROM x_feed_cursor").fetchone()[0] == 0     # audit X01
    again = Echo()
    x_feed.poll(seeded, settings(), client=Pages([_post(1), _post(2)]), parser=again, now=NOW)
    assert [p["id"] for p in again.seen] == ["1", "2"]          # the same posts, parsed this time


def test_every_page_is_read_and_a_read_post_is_never_parsed_twice(seeded):  # noqa: F811
    posts = [_post(i, text="Invented Wing will sit tonight.") for i in range(250)]
    parser = Echo()
    out = x_feed.poll(seeded, settings(), client=Pages(posts), parser=parser, now=NOW)
    assert out["posts_read"] == 250 and len(parser.seen) == 250                        # audit X02
    second = Echo()
    x_feed.poll(seeded, settings(), client=Pages(posts[:5]), parser=second,
                now=pd.Timestamp(NOW) + pd.Timedelta(minutes=15))
    assert second.seen == []                                     # the overlap re-read is not re-parsed


def test_the_next_poll_reads_from_where_the_last_left_off(seeded):  # noqa: F811
    fx = Pages([_post(1)])
    x_feed.poll(seeded, settings(), client=fx, parser=Echo(), now=NOW)
    first_start = pd.Timestamp(fx.calls[0]["start_time"])
    assert first_start == pd.Timestamp(NOW) - pd.Timedelta(hours=settings().x_feed.catchup_hours)
    later = pd.Timestamp(NOW) + pd.Timedelta(hours=5)             # a 5-hour gap: nothing skipped (X03)
    fx2 = Pages([])
    x_feed.poll(seeded, settings(), client=fx2, parser=Echo(), now=later)
    expected = pd.Timestamp(NOW) - pd.Timedelta(minutes=1 + settings().x_feed.overlap_minutes)
    assert pd.Timestamp(fx2.calls[0]["start_time"]) == expected.floor("s")


@pytest.mark.parametrize("text", ["Invented Wing will sit tonight.", "Invented Wing is day-to-day.",
                                  "Invented Wing is good to go.", "Invented Wing won't suit up.",
                                  "Invented Wing (knee) will be re-evaluated next week."])
def test_plain_availability_phrases_reach_the_model(text):
    assert x_feed.NEWS.search(text)                                                  # audit X04


def test_an_in_game_injury_never_becomes_an_out_for_the_next_game(seeded):  # noqa: F811
    class SaysTonight(Echo):                       # the model wrongly dates it to tonight's game
        def parse(self, posts):
            return [{**OUT, "post_id": p["id"], "game_date": "2026-11-04"} for p in posts]

    store.upsert(seeded, "games", pd.DataFrame([{
        "game_id": 10, "season": 2026, "game_date": date(2026, 11, 6), "home_team_id": 2,
        "visitor_team_id": 1, "postseason": False, "tip_utc": pd.Timestamp("2026-11-07T00:30:00Z"), **META}]))
    during = datetime(2026, 11, 5, 1, 30, tzinfo=UTC)          # an hour after tonight's tip
    x_feed.poll(seeded, settings(), client=Pages([_post(1, at="2026-11-05T01:20:00Z")]),
                parser=SaysTonight(), now=during)
    assert seeded.execute("SELECT game_basis FROM status_events").fetchone() == ("unmatched",)   # X05
    assert overrides.resolve(seeded, date(2026, 11, 4), date(2026, 11, 8), as_of=during, cfg=settings(),
                             manual_path=_no_manual()).empty


def test_the_model_s_output_is_checked_before_use():
    cfg = settings()
    ok = {**OUT, "post_id": "1"}
    assert x_feed.valid_event(ok, cfg) is None
    assert x_feed.valid_event({**ok, "minutes_cap": -5}, cfg) == "impossible minutes limit"        # X14
    assert x_feed.valid_event({**ok, "confidence": 0.1}, cfg) == "low confidence"
    assert x_feed.valid_event({**ok, "out_days_min": 10, "out_days_max": 3}, cfg) is not None
    assert x_feed.valid_event({**ok, "player": "Invented Wing is out tonight with a sore knee, "
                                               "the team said in a statement"}, cfg) == "not a name"  # X13
    assert x_feed.valid_event({**ok, "player": "D'Angelo Rüssell-Jones Jr."}, cfg) is None


def test_a_cut_off_reply_is_split_and_retried_not_dropped():
    class Client:
        def __init__(self):
            self.messages, self.sizes = self, []

        def create(self, **k):
            import json

            batch = json.loads(k["messages"][0]["content"])
            self.sizes.append(len(batch))
            if len(batch) > 3:                                   # too many posts: the answer is cut off
                return SimpleNamespace(stop_reason="max_tokens", content=[])
            ev = [{**OUT, "post_id": p["post_id"]} for p in batch]
            return SimpleNamespace(stop_reason="tool_use",
                                   content=[SimpleNamespace(type="tool_use", input={"events": ev})])

    posts = [{"id": str(i), "handle": "h", "created_at": "x", "at_et": "x", "dates_ahead": "x", "text": "t"}
             for i in range(10)]
    p = x_feed.LlmParser(settings(), client=Client())
    out = p.parse(posts)
    assert sorted(e["post_id"] for e in out) == [str(i) for i in range(10)] and p.failed == []   # X15
    assert max(p.client.sizes) == 10 and min(p.client.sizes) <= 3


def _no_manual():
    from pathlib import Path
    from tempfile import mkdtemp

    f = Path(mkdtemp()) / "o.yaml"
    f.write_text("overrides: []\n")
    return f


def _ev(eid, status, ts, rank=1, lo=None, hi=None):
    return {"event_id": eid, "player_id": 501, "team_id": 1, "status": status, "minutes_cap": None,
            "confidence": 0.9, "account": "a", "authority_rank": rank, "ts": ts, "out_days_min": lo,
            "out_days_max": hi, "source": "x", "fetched_at": ts}


def test_a_return_ends_an_absence_whatever_dates_are_asked_for(seeded):  # noqa: F811
    t0 = pd.Timestamp("2026-10-23T16:00:00Z")
    store.upsert(seeded, "status_events", pd.DataFrame([
        _ev("a", "Out", t0, lo=14, hi=21),                                     # out 2-3 weeks
        _ev("b", "Available", pd.Timestamp("2026-10-26T16:00:00Z"))]))         # back on Oct 26
    as_of, m = datetime(2026, 10, 27, 20, tzinfo=UTC), _no_manual()
    wide = overrides.resolve(seeded, date(2026, 10, 23), date(2026, 10, 28), as_of=as_of, manual_path=m)
    narrow = overrides.resolve(seeded, date(2026, 10, 27), date(2026, 10, 28), as_of=as_of, manual_path=m)
    assert date(2026, 10, 27) not in set(wide["date"]) and narrow.empty                       # X07


def test_a_losing_report_does_not_end_an_official_absence(seeded):  # noqa: F811
    store.upsert(seeded, "status_events", pd.DataFrame([
        _ev("a", "Out", pd.Timestamp("2026-10-23T16:00:00Z"), lo=14, hi=21),
        _ev("b", "Out", pd.Timestamp("2026-10-26T15:00:00Z")),                  # official, same day
        _ev("c", "Probable", pd.Timestamp("2026-10-26T16:00:00Z"), rank=4)]))   # aggregator, later
    ov = overrides.resolve(seeded, date(2026, 10, 26), date(2026, 10, 28),
                           as_of=datetime(2026, 10, 26, 20, tzinfo=UTC), manual_path=_no_manual())
    by = {pd.Timestamp(d).date(): r for d, r in zip(ov["date"], ov["play_prob"], strict=True)}
    assert by[date(2026, 10, 26)] == 0.0 and by[date(2026, 10, 27)] == 0.0                     # X08

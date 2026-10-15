"""Yahoo's draft results as the listener's backup (draft/yahoo_feed.py), on a fake league: never
the real API."""

from __future__ import annotations

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from research_room import api
from research_room.config import settings
from research_room.draft import tracker, yahoo_feed
from tests.test_board import make_pool


class FakeLeague:
    """Yahoo's draft results so far, and its player details (counting the lookups)."""

    def __init__(self, picks: list[tuple[int, int]], names: dict[int, tuple[str, str]]):
        self.picks, self.names, self.lookups = picks, names, []

    def draft_results(self):
        made = [{"pick": n, "round": 1, "team_key": "466.l.1.t.1", "player_id": pid} for n, pid in self.picks]
        return made + [{"pick": 99, "round": 9, "team_key": "466.l.1.t.1"}]   # not made yet: no player

    def player_details(self, ids):
        self.lookups.append(list(ids))
        return [{"player_id": i, "name": {"full": self.names[i][0]}, "editorial_team_abbr": self.names[i][1]}
                for i in ids if i in self.names]


def test_the_window_runs_from_before_the_start_to_hours_after():
    cfg, start = settings(), pd.Timestamp(settings().draft.starts_at)
    assert not yahoo_feed.in_window(start - pd.Timedelta(minutes=31), cfg)
    assert yahoo_feed.in_window(start - pd.Timedelta(minutes=29), cfg)
    assert yahoo_feed.in_window(start + pd.Timedelta(hours=5), cfg)
    assert not yahoo_feed.in_window(start + pd.Timedelta(hours=7), cfg)


def test_read_looks_each_player_up_once_and_skips_picks_not_made():
    lg = FakeLeague([(1, 501), (2, 502)], {501: ("Invented Guard", "Bos"), 502: ("Made Up Center", "Mia")})
    feed = yahoo_feed.YahooFeed(connect=lambda cfg: lg)
    picks = feed.read(settings())
    assert [(p.pick_no, p.name, p.team_abbr) for p in picks] == [(1, "Invented Guard", "BOS"),
                                                                 (2, "Made Up Center", "MIA")]
    lg.picks.append((3, 503))
    lg.names[503] = ("Pretend Forward", "Den")
    assert len(feed.read(settings())) == 3
    assert lg.lookups == [[501, 502], [503]]                                    # new players only


def test_apply_adds_what_the_log_lacks_and_reports_the_rest():
    picks = [yahoo_feed.YahooPick(1, 501, "A", None), yahoo_feed.YahooPick(2, 502, "B", None),
             yahoo_feed.YahooPick(3, 503, "Nobody", None), yahoo_feed.YahooPick(4, 504, "D", None),
             yahoo_feed.YahooPick(5, 505, "E", None)]
    ids = {"A": 11, "B": 12, "D": 14, "E": 15}
    recorded = {1: 11, 2: 99}                                   # 1 matches; 2 has another player
    written = []

    def record(n, pid, name):
        if n == 5:
            raise tracker.PickError("E is already drafted")
        written.append((n, pid))

    st = yahoo_feed.FeedStatus()
    assert yahoo_feed.apply(picks, recorded, lambda n, t: ids.get(n), record, st) == 1
    assert written == [(4, 14)] and recorded[4] == 14
    assert st.conflicts == [2] and st.unmatched == ["Nobody"] and "already drafted" in st.detail
    assert st.added == 1 and st.yahoo_picks == 5 and st.checked_at
    recorded[3] = 13                                            # the owner entered pick 3 by hand
    yahoo_feed.apply(picks[:3], recorded, lambda n, t: ids.get(n), record, st)
    assert st.unmatched == [] and st.conflicts == [2]           # this read's lists only


@pytest.fixture
def room(tmp_path, monkeypatch):
    s = settings()
    cfg = s.model_copy(update={"league": s.league.model_copy(update={"teams": 4}),
                               "draft": s.draft.model_copy(update={"rounds": 5, "pool_size": 60})})

    def fake_start(draft_id, my_slot, punts, cfg=None, db_path=None, mock=None):
        state = tracker.new_state(draft_id, base, my_slot)
        sess = api.Session(draft_id, base, make_pool(), 3.1, set(punts), state)
        sess.rebuild()
        return sess

    base = cfg
    monkeypatch.setattr(api, "start_session", fake_start)
    lg = FakeLeague([], {})
    feed = yahoo_feed.YahooFeed(connect=lambda c: lg)
    app = api.create_app(db_path=str(tmp_path / "f.duckdb"), run_mock_thread=False, feed=feed)
    return TestClient(app), app, lg


def test_yahoos_picks_reach_the_room_like_the_listeners(room):
    client, app, lg = room
    start = pd.Timestamp(settings().draft.starts_at)
    s = client.post("/draft/session", json={"draft_id": api.real_draft_id(), "my_slot": 2}).json()
    assert s["yahoo_feed"]["state"] == "off" and s["yahoo_feed"]["added"] == 0
    pool = client.get("/draft/players", params={"limit": 5}).json()["players"]
    a, b, c = (p["name"] for p in pool[:3])
    assert app.state.yahoo_feed_step(start - pd.Timedelta(hours=2)) == 0          # too early
    assert client.get("/draft/session").json()["yahoo_feed"]["state"] == "waiting"

    lg.picks += [(1, 701), (2, 702)]
    lg.names.update({701: (a, None), 702: (b, None)})
    from research_room import store as _store

    real_now = _store.utcnow
    _store.utcnow = lambda: start.to_pydatetime()                                  # the room is open
    try:
        client.post("/draft/pick", json={"player_name": a, "source": "listener"})  # the listener had pick 1
    finally:
        _store.utcnow = real_now
    assert app.state.yahoo_feed_step(start) == 1                                   # Yahoo adds pick 2
    s = client.get("/draft/session").json()
    assert [(p["pick_no"], p["player_name"]) for p in s["picks"]] == [(1, a), (2, b)]
    from research_room import store

    con = store.connect(app.state.db_path)
    try:
        sources = con.execute("SELECT pick_no, entry_source FROM draft_picks WHERE draft_id = ? "
                              "ORDER BY pick_no", [api.real_draft_id()]).fetchall()
    finally:
        con.close()
    assert sources == [(1, "listener"), (2, "yahoo")]
    assert s["current_pick"] == 3 and s["yahoo_feed"]["state"] == "live" and s["yahoo_feed"]["added"] == 1

    lg.picks += [(3, 703)]
    lg.names[703] = ("Nobody Real", None)
    assert app.state.yahoo_feed_step(start) == 0
    assert client.get("/draft/session").json()["yahoo_feed"]["unmatched"] == ["Nobody Real"]
    client.post("/draft/pick", json={"player_name": c, "pick_no": 3})              # entered by hand
    app.state.yahoo_feed_step(start)
    assert client.get("/draft/session").json()["yahoo_feed"]["unmatched"] == []


def test_a_yahoo_outage_is_reported_and_mock_drafts_are_left_alone(room):
    client, app, lg = room
    start = pd.Timestamp(settings().draft.starts_at)
    client.post("/draft/session", json={"draft_id": api.real_draft_id(), "my_slot": 2})

    def down():
        raise RuntimeError("HTTP 999 request denied")

    lg.draft_results = down
    assert app.state.yahoo_feed_step(start) == 0
    st = client.get("/draft/session").json()["yahoo_feed"]
    assert st["state"] == "error" and "throttled" in st["detail"]
    client.post("/draft/mock", json={"draft_id": "mock-1", "my_slot": 1, "teams": 4, "speed_s": 1})
    assert app.state.yahoo_feed_step(start) == 0
    assert client.get("/draft/session").json()["yahoo_feed"] is None


def test_a_practice_session_never_gets_the_leagues_picks(room):
    """A Yahoo mock draft runs under its own id, with its own size: the league's real picks (and
    its draft order and keepers) belong to the real draft only."""
    client, app, lg = room
    start = pd.Timestamp(settings().draft.starts_at)
    s = client.post("/draft/session", json={"draft_id": "practice-1", "my_slot": 3}).json()
    lg.picks += [(1, 701)]
    pool = client.get("/draft/players", params={"limit": 1}).json()["players"]
    lg.names[701] = (pool[0]["name"], None)
    assert app.state.yahoo_feed_step(start) == 0
    s = client.get("/draft/session").json()
    assert s["picks"] == [] and s["yahoo_feed"]["state"] == "off" and "practice" in s["yahoo_feed"]["detail"]
    r = client.post("/draft/session", json={"draft_id": api.real_draft_id(), "teams": 12})
    assert r.status_code == 400 and "real draft" in r.json()["detail"]

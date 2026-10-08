"""In-app notifications on an invented store: injury and opponent news, no repeats, the impact from
the matchup snapshots, read state, the lineup-lock and add/drop rules, and the API routes."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime

import duckdb
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from research_room import alerts, api, schedule, store
from research_room.config import settings

DAY = date(2026, 11, 4)
NOW = datetime(2026, 11, 4, 21, 0, tzinfo=UTC)  # 4 PM Eastern
TIP = pd.Timestamp("2026-11-05 00:00", tz="UTC")  # 7 PM Eastern
SINCE = datetime(2026, 11, 4, 19, 0, tzinfo=UTC)  # the refresh started; snapshots below are 18:00 and 20:00
META = {"source": "test", "fetched_at": pd.Timestamp(NOW)}


@pytest.fixture
def seeded(con, monkeypatch):
    cfg = settings()
    me, opp = cfg.league.my_team_id, 5
    store.upsert(
        con,
        "teams",
        pd.DataFrame(
            [{"team_id": t, "abbreviation": a, "full_name": a, **META} for t, a in ((1, "NYK"), (2, "SAS"))]
        ),
    )
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
                {"player_id": i, "full_name": n, "team_id": t, "position": "G", **META}
                for i, n, t in ((1, "Invented Guard", 1), (2, "Bench Wing", 1), (3, "Rival Center", 2))
            ]
        ),
    )
    snap = pd.Timestamp(NOW) - pd.Timedelta(hours=1)
    store.upsert(
        con,
        "yahoo_rosters",
        pd.DataFrame(
            [
                {
                    "snapshot_at": snap,
                    "team_id": me,
                    "yahoo_player_key": "k1",
                    "player_name": "Invented Guard",
                    "player_id": 1,
                    "selected_slot": "PG",
                    "eligible_positions": "PG,G,Util",
                    "status": None,
                    **META,
                },
                {
                    "snapshot_at": snap,
                    "team_id": me,
                    "yahoo_player_key": "k2",
                    "player_name": "Bench Wing",
                    "player_id": 2,
                    "selected_slot": "BN",
                    "eligible_positions": "SF,F,Util",
                    "status": None,
                    **META,
                },
                {
                    "snapshot_at": snap,
                    "team_id": opp,
                    "yahoo_player_key": "k3",
                    "player_name": "Rival Center",
                    "player_id": 3,
                    "selected_slot": "C",
                    "eligible_positions": "C,Util",
                    "status": None,
                    **META,
                },
            ]
        ),
    )
    ts = pd.Timestamp(NOW) - pd.Timedelta(minutes=30)
    store.upsert(
        con,
        "status_events",
        pd.DataFrame(
            [
                {
                    "event_id": f"e{p}",
                    "player_id": p,
                    "team_id": t,
                    "status": s,
                    "minutes_cap": None,
                    "starting": None,
                    "confidence": 0.9,
                    "account": "TeamPR",
                    "authority_rank": 1,
                    "ts": ts,
                    **META,
                }
                for p, t, s in ((1, 1, "Out"), (2, 1, "Questionable"), (3, 2, "Doubtful"))
            ]
        ),
    )
    week = schedule.week_of(DAY, cfg.season)
    for when, p, kind, w, o in (
        (NOW.replace(hour=18), 0.55, "nightly", week, opp),
        (NOW.replace(hour=20), 0.47, "news", week, opp),
        (NOW.replace(hour=20, minute=30), 0.10, "news", week + 1, opp),  # another week: never used
        (NOW.replace(hour=20, minute=40), 0.90, "news", week, 9),  # another opponent: never used
    ):
        store.upsert(
            con,
            "matchup_snapshots",
            pd.DataFrame(
                [
                    {
                        "week": w,
                        "ts": pd.Timestamp(when),
                        "opponent_team_id": o,
                        "p_win_week": p,
                        "expected_cats": 4.5,
                        "p_cats": json.dumps({c.key: 0.5 for c in cfg.categories}),
                        "cats_me": 0,
                        "cats_opp": 0,
                        "event_kind": kind,
                        "event_label": kind,
                    }
                ]
            ),
        )
    monkeypatch.setattr(alerts, "_opponent", lambda con, cfg, day: opp)
    monkeypatch.setattr(alerts, "_lineup_alert", lambda con, cfg, now: [])
    return con


def test_my_injuries_and_my_opponents_news_with_the_snapshot_impact(seeded):
    out = alerts.generate(seeded, settings(), NOW, "pregame", since=SINCE)
    assert out["errors"] == []
    rows = seeded.execute("SELECT kind, priority, title, player_id, impact FROM notifications").df()
    by = rows.set_index("player_id")
    assert by.at[1, "kind"] == "injury" and by.at[1, "priority"] == "urgent"  # in my lineup, out, before tip
    assert by.at[2, "kind"] == "injury" and by.at[2, "priority"] == "normal"  # bench, questionable
    assert by.at[3, "kind"] == "news" and by.at[3, "title"] == "Rival Center doubtful today"
    impact = json.loads(by.at[1, "impact"])  # this week, this opponent, this refresh only (B01, B02)
    assert impact["delta_p_win"] == pytest.approx(-0.08) and impact["severity"] == "high"
    assert "All news in this refresh" in impact["summary"]
    assert impact["confidence"]["missing"][0]["key"] == "per_player"
    assert "game_day" in set(rows["kind"])
    assert alerts.generate(seeded, settings(), NOW, "pregame", since=SINCE)["new"] == 0  # never repeated


def test_impact_needs_a_snapshot_from_this_refresh(seeded):
    cfg = settings()
    assert alerts.week_impact(seeded, cfg, NOW, None) is None
    later = datetime(2026, 11, 4, 20, 50, tzinfo=UTC)  # after every snapshot: nothing this refresh saved
    assert alerts.week_impact(seeded, cfg, NOW, later) is None
    early = datetime(2026, 11, 4, 17, 0, tzinfo=UTC)  # no snapshot before the refresh to compare with
    assert alerts.week_impact(seeded, cfg, NOW, early) is None


def _status(con, eid, pid, status, minutes):
    store.upsert(
        con,
        "status_events",
        pd.DataFrame(
            [
                {
                    "event_id": eid,
                    "player_id": pid,
                    "team_id": 1,
                    "status": status,
                    "minutes_cap": None,
                    "starting": None,
                    "confidence": 0.9,
                    "account": "TeamPR",
                    "authority_rank": 1,
                    "ts": pd.Timestamp(NOW) - pd.Timedelta(minutes=minutes),
                    **META,
                }
            ]
        ),
    )


def test_a_new_status_report_is_a_new_alert_and_the_old_one_is_kept(seeded):
    cfg = settings()
    alerts.generate(seeded, cfg, NOW, "pregame")
    _status(seeded, "e1b", 1, "Questionable", 5)  # a newer, softer report for the same player
    out = alerts.generate(seeded, cfg, NOW, "pregame")
    assert out["by_kind"] == {"injury": 1}
    rows = seeded.execute("SELECT title, priority FROM notifications WHERE player_id = 1").df()
    assert set(rows["title"]) == {"Invented Guard ruled out today", "Invented Guard questionable today"}
    _status(seeded, "e1c", 1, "Out", 2)  # back to out: a new episode, so it alerts again (B03)
    assert alerts.generate(seeded, cfg, NOW, "pregame")["by_kind"] == {"injury": 1}


def test_a_repeat_takes_the_current_wording(seeded):
    cfg = settings()
    alerts.generate(seeded, cfg, NOW, "pregame")
    seeded.execute("UPDATE yahoo_rosters SET selected_slot = 'BN' WHERE player_id = 1")  # benched since
    assert alerts.generate(seeded, cfg, NOW, "pregame")["new"] == 0
    row = seeded.execute("SELECT priority, body FROM notifications WHERE player_id = 1").fetchone()
    assert row[0] == "high" and row[1].endswith("He's on your bench.")


def test_no_alerts_once_the_game_started_or_for_a_game_off_the_slate(seeded):
    cfg = settings()
    after_tip = datetime(2026, 11, 5, 0, 30, tzinfo=UTC)
    assert alerts._status_alerts(seeded, cfg, after_tip, None) == []
    seeded.execute("UPDATE games SET postponed = true WHERE game_id = 7")
    assert alerts._status_alerts(seeded, cfg, NOW, None) == []
    seeded.execute("UPDATE games SET postponed = false, status_state = 'final' WHERE game_id = 7")
    assert alerts._status_alerts(seeded, cfg, NOW, None) == []


def test_a_report_filed_for_his_old_team_does_not_alert(seeded):
    seeded.execute("UPDATE players SET team_id = 2 WHERE player_id = 1")  # traded to the other side
    found = alerts._status_alerts(seeded, settings(), NOW, None)
    assert 1 not in {f["player_id"] for f in found}  # the Out was posted for team 1 (B05)
    assert 2 in {f["player_id"] for f in found}


def test_an_urgent_alert_reads_as_history_after_its_deadline(seeded, tmp_path):
    cfg = settings()
    alerts.generate(seeded, cfg, NOW, "pregame")
    db = tmp_path / "x.duckdb"

    def pick(res):
        return next(i for i in res["items"] if i["kind"] == "injury" and i["player"]["player_id"] == 1)

    assert pick(alerts.notifications_response(seeded, cfg, NOW, db_path=db))["priority"] == "urgent"
    later = datetime(2026, 11, 5, 1, 0, tzinfo=UTC)
    assert pick(alerts.notifications_response(seeded, cfg, later, db_path=db))["priority"] == "normal"


def test_read_state_and_the_response(seeded, tmp_path):
    cfg = settings()
    alerts.generate(seeded, cfg, NOW, "pregame")
    db = tmp_path / "x.duckdb"
    res = alerts.notifications_response(seeded, cfg, NOW, db_path=db)
    assert res["unread"] == len(res["items"]) > 0
    first = res["items"][0]["id"]
    alerts.mark_read(cfg, [first], db_path=db)
    assert alerts.notifications_response(seeded, cfg, NOW, db_path=db)["unread"] == len(res["items"]) - 1
    alerts.mark_read(cfg, None, now=pd.Timestamp(NOW) + pd.Timedelta(minutes=1), db_path=db)
    assert alerts.notifications_response(seeded, cfg, NOW, db_path=db)["unread"] == 0
    item = next(i for i in res["items"] if i["player"] and i["player"]["player_id"] == 3)
    assert item["player"]["owner"] == "opponent" and item["claim"] is None


def test_marks_from_two_threads_both_land_and_a_bad_file_is_set_aside(tmp_path):
    from concurrent.futures import ThreadPoolExecutor

    cfg, db = settings(), tmp_path / "x.duckdb"
    with ThreadPoolExecutor(8) as ex:
        list(ex.map(lambda i: alerts.mark_read(cfg, [f"n-{i}"], db_path=db), range(40)))
    assert len(alerts.read_state(cfg, db)["ids"]) == 40  # no mark lost to a race (B07)
    alerts.mark_read(cfg, None, now=pd.Timestamp("2026-11-04 22:00", tz="UTC"), db_path=db)
    alerts.mark_read(cfg, None, now=pd.Timestamp("2026-11-04 21:00", tz="UTC"), db_path=db)
    assert alerts.read_state(cfg, db)["all_before"].startswith("2026-11-04T22:00")  # never moves back
    path = alerts._read_path(cfg, db)
    path.write_text("{not json")
    assert alerts.mark_read(cfg, ["n-x"], db_path=db)["ids"] == ["n-x"]
    assert len(list(tmp_path.glob("notifications_read.corrupt-*"))) == 1


def test_the_pregame_window_runs_until_the_last_tip():
    from zoneinfo import ZoneInfo

    from jobs.pregame import in_window

    et = lambda h, m=0: datetime(2026, 11, 4, h, m, tzinfo=ZoneInfo(alerts.ET))  # noqa: E731
    tips = (et(19), et(22, 30))
    assert not in_window(et(15, 59), tips, 3)
    assert in_window(et(16), tips, 3) and in_window(et(21), tips, 3) and in_window(et(22, 30), tips, 3)
    assert not in_window(et(22, 31), tips, 3) and not in_window(et(20), None, 3)


def test_add_drop_alerts_need_a_real_gain(monkeypatch, con):
    from research_room import moves_api

    def mv(mid, d):
        return {
            "move_id": mid,
            "player": {"player_id": 9, "name": "Free Agent"},
            "counterpart": None,
            "delta_p_win": {"mean": d},
            "reason": "Adds 3 games.",
            "cat_deltas": [],
            "confidence": None,
            "deadline": None,
            "provenance": [],
        }
    monkeypatch.setattr(
        moves_api, "moves_response", lambda con, cfg, now: {"moves": [mv("a", 0.04), mv("b", 0.005)]}
    )
    found = alerts._waiver_alerts(con, settings(), pd.Timestamp(NOW))
    assert [f["action"]["ref"] for f in found] == ["a"]  # 0.5 pts is below the bar


def test_lineup_reminder_only_close_to_the_lock(monkeypatch, con):
    from research_room import season_api

    day = {
        "date": str(DAY),
        "is_today": True,
        "first_lock_at": TIP.isoformat(),
        "games_started_optimal": 9,
        "games_started_current": 8,
        "slots": [{"slot": "PG", "changed": True, "optimal": {"player": {"name": "Bench Wing"}}}],
    }
    monkeypatch.setattr(season_api, "lineup_response", lambda con, cfg, now: {"days": [day], "as_of": None})
    cfg = settings()
    assert alerts._lineup_alert(con, cfg, pd.Timestamp(NOW))[0]["title"] == "Lineup locks start at 7:00 PM"
    assert alerts._lineup_alert(con, cfg, pd.Timestamp("2026-11-04 15:00", tz="UTC")) == []  # 9 h before


def test_api_routes(tmp_path, monkeypatch):
    db = tmp_path / "api.duckdb"
    c = store.connect(db)
    store.upsert(
        c,
        "notifications",
        pd.DataFrame(
            [
                {
                    "id": "n-1",
                    "kind": "model",
                    "priority": "low",
                    "created_at": pd.Timestamp.now(tz="UTC"),
                    "title": "Projections updated",
                    "body": "x",
                    "player_id": None,
                    "owner": None,
                    "impact": None,
                    "action": None,
                    "deadline": None,
                    "provenance": "[]",
                    "run": "nightly",
                }
            ]
        ),
    )
    c.close()
    client = TestClient(api.create_app(db_path=db))
    r = client.get("/season/notifications").json()
    assert r["unread"] == 1 and r["items"][0]["title"] == "Projections updated"
    assert client.post("/season/notifications/read", json={}).json() == {"unread": 0}
    def held(*a, **k):  # a job holding the store: the mark still saves, the count is unknown (B08)
        raise duckdb.IOException("Could not set lock on file")

    monkeypatch.setattr(store, "connect", held)
    r = client.post("/season/notifications/read", json={"ids": ["n-2"]})
    assert r.status_code == 200 and r.json() == {"unread": None}
    assert "n-2" in alerts.read_state(settings(), db)["ids"]

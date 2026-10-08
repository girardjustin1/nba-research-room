"""In-app notifications on an invented store: injury and opponent news, no repeats, the impact from
the matchup snapshots, read state, the lineup-lock and add/drop rules, and the API routes."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from research_room import alerts, api, store
from research_room.config import settings

DAY = date(2026, 11, 4)
NOW = datetime(2026, 11, 4, 21, 0, tzinfo=UTC)  # 4 PM Eastern
TIP = pd.Timestamp("2026-11-05 00:00", tz="UTC")  # 7 PM Eastern
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
    for when, p, kind in ((NOW.replace(hour=18), 0.55, "nightly"), (NOW.replace(hour=20), 0.47, "news")):
        store.upsert(
            con,
            "matchup_snapshots",
            pd.DataFrame(
                [
                    {
                        "week": 3,
                        "ts": pd.Timestamp(when),
                        "opponent_team_id": opp,
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
    out = alerts.generate(seeded, settings(), NOW, "pregame")
    assert out["errors"] == []
    rows = seeded.execute("SELECT kind, priority, title, player_id, impact FROM notifications").df()
    by = rows.set_index("player_id")
    assert by.at[1, "kind"] == "injury" and by.at[1, "priority"] == "urgent"  # in my lineup, out, before tip
    assert by.at[2, "kind"] == "injury" and by.at[2, "priority"] == "normal"  # bench, questionable
    assert by.at[3, "kind"] == "news" and by.at[3, "title"] == "Rival Center doubtful today"
    impact = json.loads(by.at[1, "impact"])
    assert impact["delta_p_win"] == pytest.approx(-0.08) and impact["severity"] == "high"
    assert "game_day" in set(rows["kind"])
    assert alerts.generate(seeded, settings(), NOW, "pregame")["new"] == 0  # never repeated


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

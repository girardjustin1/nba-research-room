"""Yahoo Fantasy API (read only) on recorded-shape fakes of yahoo_fantasy_api's outputs. No network,
invented teams and players."""

from __future__ import annotations

from datetime import UTC, date, datetime

import pandas as pd
import pytest

from research_room import store
from research_room.config import settings
from research_room.ingest import yahoo, yahoo_api

GAME = "466"
NOW = datetime(2026, 11, 4, 18, 0, tzinfo=UTC)
META = {"source": "test", "fetched_at": pd.Timestamp(NOW)}


def tkey(t):
    return f"{GAME}.l.79805.t.{t}"


class FakeTeam:
    def __init__(self, t):
        self.t = t

    def roster(self, week=None, day=None):
        pid, name, pos = {
            1: (101, "Invented Guard", ["PG", "SG", "G", "Util"]),
            11: (111, "Made Up Center", ["C", "Util"]),
        }[self.t]
        return [
            {
                "player_id": pid,
                "name": name,
                "position_type": "P",
                "eligible_positions": pos,
                "selected_position": "Util" if self.t == 1 else "C",
                "status": "" if self.t == 1 else "INJ",
            }
        ]

    def add_player(self, player_key):  # a write the app must never reach
        raise AssertionError("the guard should have stopped this")


class FakeHandler:
    """The library's raw-request handler: only the league settings read is used (stat ids)."""

    ids = {"FG%": 5, "FT%": 8, "3PTM": 10, "PTS": 12, "REB": 15, "AST": 16, "ST": 17, "BLK": 18, "TO": 19}

    def get_settings_raw(self, league_id):
        stats = [
            {"stat": {"stat_id": i, "display_name": d, "position_type": "P"}} for d, i in self.ids.items()
        ]
        stats.append({"stat": {"stat_id": 9004003, "display_name": "FGM/A", "position_type": "P",
                               "is_only_display_stat": "1"}})
        return {"fantasy_content": {"league": [{"league_key": league_id},
                                               {"settings": [{"stat_categories": {"stats": stats}}]}]}}


class FakeLeague:
    league_id = f"{GAME}.l.79805"

    def __init__(self):
        self.yhandler = FakeHandler()

    def teams(self):
        return {
            tkey(1): {
                "team_key": tkey(1),
                "team_id": "1",
                "name": "Team One",
                "draft_position": 2,
                "roster_adds": {"coverage_type": "week", "coverage_value": "3", "value": "2"},
            },
            tkey(11): {
                "team_key": tkey(11),
                "team_id": "11",
                "name": "Team Eleven",
                "draft_position": 1,
                "roster_adds": {"coverage_type": "week", "coverage_value": "3", "value": "1"},
            },
        }

    def to_team(self, key):
        return FakeTeam(int(key.rsplit(".t.", 1)[1]))

    def free_agents(self, position):
        return (
            [
                {
                    "player_id": 201,
                    "name": "Free Wing",
                    "status": "",
                    "position_type": "P",
                    "eligible_positions": ["SF", "F", "Util"],
                    "percent_owned": 12,
                }
            ]
            if position in ("SF",)
            else []
        )

    def player_details(self, ids):
        known = {201: ("Free Wing", "Bos"), 101: ("Invented Guard", "NY"), 111: ("Made Up Center", "SA")}
        return [
            {"player_id": str(i), "name": {"full": known[i][0]}, "editorial_team_abbr": known[i][1]}
            for i in ids
            if i in known
        ]

    def current_week(self):
        return 3

    def matchups(self, week):
        def side(t, pts):
            stats = [
                {"stat": {"stat_id": "5", "value": ".471"}},
                {"stat": {"stat_id": "8", "value": ".800"}},
                {"stat": {"stat_id": "10", "value": "40"}},
                {"stat": {"stat_id": "12", "value": str(pts)}},
                {"stat": {"stat_id": "15", "value": "150"}},
                {"stat": {"stat_id": "16", "value": "90"}},
                {"stat": {"stat_id": "17", "value": "30"}},
                {"stat": {"stat_id": "18", "value": "20"}},
                {"stat": {"stat_id": "19", "value": "50"}},
                {"stat": {"stat_id": "9004003", "value": "300/637"}},
            ]
            return {
                "team": [
                    [{"team_key": tkey(t)}, {"team_id": str(t)}, {"name": f"T{t}"}],
                    {"team_stats": {"coverage_type": "week", "week": str(week), "stats": stats}},
                ]
            }

        return {
            "fantasy_content": {
                "league": [
                    {"league_key": f"{GAME}.l.79805"},
                    {
                        "scoreboard": {
                            "week": str(week),
                            "0": {
                                "matchups": {
                                    "0": {
                                        "matchup": {
                                            "week": str(week),
                                            "0": {
                                                "teams": {"0": side(1, 400), "1": side(11, 380), "count": 2}
                                            },
                                        }
                                    },
                                    "count": 1,
                                }
                            },
                        }
                    },
                ]
            }
        }

    def draft_results(self):
        return [
            {"pick": 1, "round": 1, "team_key": tkey(11), "player_id": 111},
            {"pick": 2, "round": 1, "team_key": tkey(1), "player_id": 101},
        ]

    def settings(self):
        rp = [
            {"roster_position": {"position": p, "position_type": "P", "count": n}}
            for p, n in (
                ("PG", 1),
                ("SG", 1),
                ("G", 1),
                ("SF", 1),
                ("PF", 1),
                ("F", 1),
                ("C", 2),
                ("Util", 2),
                ("BN", 2),
                ("IL", 1),
            )
        ]
        return {
            "num_teams": "14",
            "draft_type": "live",
            "draft_status": "predraft",
            "start_week": "1",
            "end_week": "2",
            "uses_keepers": "0",
            "max_weekly_adds": "4",
            "roster_positions": rp,
        }

    def stat_categories(self):
        return [
            {"display_name": d, "position_type": "P"}
            for d in ("FG%", "FT%", "3PTM", "PTS", "REB", "AST", "ST", "BLK", "TO")
        ]

    def week_date_range(self, week):
        return {1: (date(2026, 10, 19), date(2026, 11, 1)), 2: (date(2026, 11, 2), date(2026, 11, 8))}[week]

    def end_week(self):
        return 2

    def edit_date(self):  # in the real library, not a read call we use
        return None


@pytest.fixture
def lg():
    return yahoo_api.ReadOnly(FakeLeague(), yahoo_api.READ_LEAGUE)


def test_writes_are_blocked(lg):
    with pytest.raises(yahoo_api.YahooWriteBlocked):
        lg.to_team(tkey(1)).add_player("466.p.1")
    for name in ("add_player", "drop_player", "change_positions", "edit_date", "propose_trade"):
        with pytest.raises(yahoo_api.YahooWriteBlocked):
            getattr(lg, name)
    with pytest.raises(yahoo_api.YahooWriteBlocked):
        lg.something = 1
    assert lg.to_team(tkey(1)).roster()[0]["name"] == "Invented Guard"  # reads still work


def test_snapshots_match_the_csv_schemas(lg):
    b = yahoo_api.ApiBackend(lg, GAME, settings(), now=NOW)
    assert set(b.available()) == set(yahoo.SCHEMAS)
    teams = b.read("teams").set_index("team_id")
    assert teams.at[11, "team_name"] == "Team Eleven"
    roster = b.read("roster").set_index("team_id")
    assert roster.at[1, "selected_slot"] == "Util" and roster.at[1, "eligible_positions"] == "PG,SG,G,Util"
    assert roster.at[11, "yahoo_player_key"] == "466.p.111"
    fa = b.read("players").iloc[0]
    assert fa["team_abbr"] == "BOS" and fa["pct_rostered"] == 12
    m = b.read("matchup").set_index("team_id")
    assert (
        m.at[1, "opponent_team_id"] == 11
        and m.at[1, "pts"] == 400
        and m.at[11, "fg_pct"] == pytest.approx(0.471)
    )
    assert m.at[1, "acquisitions_used"] == 2
    d = b.read("draft_results").set_index("pick_no")
    assert d.at[1, "team_id"] == 11 and d.at[1, "player_name"] == "Made Up Center"


def test_the_api_feeds_the_same_ingest_as_the_csvs(con, lg):
    store.upsert(
        con,
        "players",
        pd.DataFrame(
            [
                {"player_id": i, "full_name": n, **META}
                for i, n in ((1, "Invented Guard"), (2, "Made Up Center"), (3, "Free Wing"))
            ]
        ),
    )
    from research_room.ingest import yahoo_live

    api = yahoo_api.ApiBackend(lg, GAME, settings(), now=NOW)
    out = yahoo.load_live(con, yahoo_live._Limited(api, settings().league.my_team_id), settings())
    counts = out["loaded"]
    assert counts["teams"] == 2 and counts["roster"] == 2 and counts["matchup"] == 2
    ids = dict(con.execute("SELECT player_name, player_id FROM yahoo_rosters").fetchall())
    assert ids == {"Invented Guard": 1, "Made Up Center": 2}
    assert con.execute("SELECT count(*) FROM player_xref").fetchone()[0] == 0     # nothing recorded


def test_league_facts_are_set_beside_our_settings(lg):
    cfg = settings()
    facts = yahoo_api.league_facts(lg, cfg)
    assert facts["rounds"] == 12 and facts["draft_order"] == [11, 1] and facts["num_teams"] == 14
    rows = {r["fact"]: r for r in yahoo_api.compare(facts, cfg)}
    assert rows["draft rounds"]["status"] == "match"
    assert rows["categories"]["status"] == "match" and rows["roster slots"]["status"] == "match"
    assert rows["keepers"]["status"] == "match" and rows["weekly acquisitions"]["status"] == "match"
    assert rows["my draft slot"]["yahoo"] == 1  # team 11 picks first in this fake
    assert rows["week dates"]["status"] in ("match", "differs")  # our calendar has more weeks than the fake
    assert rows["category stat ids"]["status"] == "match"


def test_a_wrong_category_stat_id_is_caught(monkeypatch):
    league = FakeLeague()
    league.yhandler.ids = {**FakeHandler.ids, "BLK": 99}
    lg = yahoo_api.ReadOnly(league, yahoo_api.READ_LEAGUE)
    rows = {r["fact"]: r for r in yahoo_api.compare(yahoo_api.league_facts(lg, settings()), settings())}
    ids = rows["category stat ids"]
    assert ids["status"] == "differs" and ids["yahoo"]["BLK"] == 99


def test_parallel_reads_give_the_same_snapshots(lg):
    one = yahoo_api.ApiBackend(lg, GAME, settings(), now=NOW, workers=1)
    four = yahoo_api.ApiBackend(lg, GAME, settings(), now=NOW, workers=4)
    four.prefetch(tuple(yahoo.SCHEMAS))
    for name in yahoo.SCHEMAS:
        pd.testing.assert_frame_equal(one.read(name), four.read(name))


def test_read_problems_are_named():
    assert yahoo_api.problem(RuntimeError('{"error": {"description": "Not authorized."}}')) == "no_access"
    assert yahoo_api.problem(RuntimeError("HTTP 999 Request denied")) == "throttled"
    assert yahoo_api.problem(ConnectionError("reset by peer")) == "down"


def test_no_write_call_is_on_the_allowed_lists():
    writes = {
        "add_and_drop_players",
        "add_player",
        "change_positions",
        "claim_and_drop_players",
        "claim_player",
        "drop_player",
        "propose_trade",
        "accept_trade",
        "reject_trade",
    }
    assert not writes & (yahoo_api.READ_LEAGUE | yahoo_api.READ_TEAM)


def test_the_live_read_falls_back_to_the_csv_inbox_when_the_api_fails(con, monkeypatch, tmp_path):
    from research_room.ingest import yahoo_live
    from tests.conftest import REAL_ATTACH

    monkeypatch.setattr(yahoo_api, "signed_in", lambda: True)

    def broken(cfg=None):
        raise ConnectionError("Yahoo is down")

    monkeypatch.setattr(yahoo_api, "connect", broken)
    (tmp_path / "teams.csv").write_text("team_id,team_name\n1,Invented Alpha\n")
    cfg = settings()
    cfg = cfg.model_copy(update={"paths": cfg.paths.model_copy(update={"inbox_dir": tmp_path})})
    out = REAL_ATTACH(con, cfg, yahoo_live.PAGE)
    assert out["source"] == "csv" and "Yahoo is down" in out["api_error"]
    assert out["loaded"] == {"teams": 1}
    assert out["yahoo"]["state"] == "down" and out["yahoo"]["degraded"]


def _cfg(tmp_path, **yahoo_settings):
    cfg = settings()
    return cfg.model_copy(update={
        "paths": cfg.paths.model_copy(update={"inbox_dir": tmp_path}),
        "yahoo": cfg.yahoo.model_copy(update=yahoo_settings),
    })


def test_a_slow_read_gives_up_on_time_and_pages_then_skip_yahoo(con, monkeypatch, tmp_path):
    import time

    from research_room.ingest import yahoo_live
    from tests.conftest import REAL_ATTACH

    monkeypatch.setattr(yahoo_api, "signed_in", lambda: True)
    calls = []

    def slow(*a, **k):
        calls.append(1)
        time.sleep(0.6)
        raise AssertionError("past its limit: the result is dropped")

    monkeypatch.setattr(yahoo_live, "_read_api", slow)
    cfg = _cfg(tmp_path, page_time_limit_s=0.1, pause_after_failure_s=60)
    started = time.monotonic()
    out = REAL_ATTACH(con, cfg, yahoo_live.PAGE)
    assert time.monotonic() - started < 0.5 and out["source"] == "csv"
    assert out["yahoo"]["state"] == "slow" and out["yahoo"]["paused"]
    assert "showing your own entries" in out["yahoo"]["message"]
    again = REAL_ATTACH(con, cfg, yahoo_live.PAGE)                     # a page moments later: no wait
    assert len(calls) == 1 and again["yahoo"]["state"] == "slow" and "skipped" in again["api_error"]
    REAL_ATTACH(con, cfg, yahoo_live.PAGE, time_limit=0.1)              # a job always tries
    assert len(calls) == 2
    assert yahoo_live.status()["state"] == "slow"


def test_a_good_read_is_live_and_lifts_the_pause(con, monkeypatch, tmp_path):
    from research_room.ingest import yahoo_live
    from tests.conftest import REAL_ATTACH

    monkeypatch.setattr(yahoo_api, "signed_in", lambda: True)
    state = {"fail": True}

    def connect(cfg=None):
        if state["fail"]:
            raise RuntimeError('{"error": {"description": "Not authorized."}}')
        return yahoo_api.ReadOnly(FakeLeague(), yahoo_api.READ_LEAGUE), GAME

    monkeypatch.setattr(yahoo_api, "connect", connect)
    cfg = _cfg(tmp_path, page_time_limit_s=5, pause_after_failure_s=60, parallel_reads=4)
    out = REAL_ATTACH(con, cfg, yahoo_live.PAGE)
    assert out["yahoo"]["state"] == "no_access" and "isn't letting" in out["yahoo"]["message"]
    state["fail"] = False
    REAL_ATTACH(con, cfg, yahoo_live.PAGE)                               # paused: still skipped
    assert yahoo_live.status()["state"] == "no_access"
    out = REAL_ATTACH(con, cfg, yahoo_live.PAGE, time_limit=5)           # the nightly run gets through
    assert out["source"] == "api" and out["yahoo"]["state"] == "live" and not out["yahoo"]["paused"]
    me = cfg.league.my_team_id
    teams = {r[0] for r in con.execute("SELECT DISTINCT team_id FROM yahoo_rosters").fetchall()}
    assert teams <= {me, 1}                                              # me and this week's opponent
    assert REAL_ATTACH(con, cfg, yahoo_live.PAGE)["yahoo"]["state"] == "live"


def test_the_status_route(tmp_path):
    from fastapi.testclient import TestClient

    from research_room import api

    db = tmp_path / "s.duckdb"
    store.connect(db).close()
    client = TestClient(api.create_app(db_path=str(db), run_mock_thread=False))
    body = client.get("/system/yahoo").json()
    assert body["state"] == "off" and body["degraded"] is False and "message" in body

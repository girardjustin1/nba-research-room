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


class FakeLeague:
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

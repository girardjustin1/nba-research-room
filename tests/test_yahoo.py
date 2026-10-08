from __future__ import annotations

import io
import os
import re
from datetime import UTC, datetime

import pandas as pd
import pytest

from research_room import store
from research_room.ingest import yahoo

NOW = datetime(2026, 10, 4, tzinfo=UTC)

ROSTER = """team_id,player_name,selected_slot,eligible_positions,status,team_abbr
11,Nikola Jokic,C,C,,DEN
11,Jalen Williams,SF,"SG,SF",GTD,OKC
11,Mystery Man,BN,PG/SG,,BOS
"""
PLAYERS = """player_name,team_abbr,eligible_positions,pct_rostered,status,owner_team_id
Jalen Williams,GS,SF;PF,45%,,
Nikola Jokic,DEN,C,100,,11
"""
MATCHUP = """week,team_id,opponent_team_id,fg_pct,ft_pct,fg3m,pts,reb,ast,stl,blk,tov
1,11,4,0.471,0.802,41,612,240,150,38,25,70
"""
DRAFT = """pick_no,round,team_id,player_name,team_abbr
1,1,3,Nikola Jokic,DEN
"""


@pytest.fixture
def inbox(tmp_path):
    def write(name: str, text: str, mtime: int = 1_790_000_000):
        p = tmp_path / f"{name}.csv"
        p.write_text(text)
        os.utime(p, (mtime, mtime))
    return tmp_path, write


@pytest.fixture
def universe(con):
    teams = [(1, "DEN"), (2, "OKC"), (3, "GSW"), (4, "BOS")]
    store.upsert(con, "teams", pd.DataFrame([{"team_id": t, "abbreviation": a, "source": "t",
                                               "fetched_at": NOW} for t, a in teams]))
    players = [(7, "Nikola Jokić", 1), (10, "Jalen Williams", 2), (11, "Jalen Williams", 3)]
    store.upsert(con, "players", pd.DataFrame([{"player_id": p, "full_name": n, "team_id": t,
                                                 "source": "t", "fetched_at": NOW} for p, n, t in players]))
    return con


def test_validate_coerces_types_and_positions():
    raw = pd.read_csv(io.StringIO(PLAYERS), dtype=str, keep_default_na=False)
    df = yahoo.validate("players", raw)
    assert df["pct_rostered"].tolist() == [45.0, 100.0]
    assert df["eligible_positions"].tolist() == ["SF,PF", "C"]
    assert df["owner_team_id"].isna().tolist() == [True, False]


@pytest.mark.parametrize(("text", "message"), [
    ("team_id,player_name,selected_slot\n11,A,C\n", "missing required column"),
    (ROSTER.replace("status,team_abbr", "status,team_abbr,extra").replace(",DEN\n", ",DEN,x\n"),
     "unknown column"),
    (ROSTER.replace("11,Nikola", "eleven,Nikola"), "team_id: not a int at line(s) [2]"),
    (ROSTER.replace(",C,C,", ",XX,C,"), "unknown slot"),
    (ROSTER.replace("PG/SG", "PG/QB"), "unknown position code"),
    (ROSTER.replace("11,Mystery Man", ",Mystery Man"), "blank in required column at line(s) [4]"),
])
def test_validate_rejects_bad_files_with_readable_errors(text, message):
    raw = pd.read_csv(io.StringIO(text), dtype=str, keep_default_na=False)
    with pytest.raises(yahoo.YahooCsvError, match=re.escape(message)):
        yahoo.validate("roster", raw)


def test_load_live_fills_memory_resolves_names_and_records_nothing(universe, inbox):
    folder, write = inbox
    write("roster", ROSTER)
    write("players", PLAYERS)
    write("matchup", MATCHUP)
    write("draft_results", DRAFT)
    out = yahoo.load_live(universe, yahoo.CsvBackend(folder), show_names=True)
    assert out["loaded"] == {"roster": 3, "players": 2, "matchup": 1}   # draft results: the listener's
    roster = dict(universe.execute("SELECT player_name, player_id FROM yahoo_rosters").fetchall())
    assert roster == {"Nikola Jokic": 7, "Jalen Williams": 10, "Mystery Man": None}
    fa = universe.execute("SELECT player_id FROM yahoo_players WHERE player_name='Jalen Williams'").fetchone()
    assert fa[0] == 11                                       # Yahoo "GS" -> BDL GSW tie-break
    assert out["unresolved"] == 1 and out["unresolved_names"][0].startswith("Mystery Man")
    snap = universe.execute("SELECT DISTINCT snapshot_at FROM yahoo_rosters").fetchone()[0]
    assert snap == datetime.fromtimestamp(1_790_000_000, tz=UTC)
    # Nothing Yahoo is recorded anywhere (the Yahoo data policy).
    assert universe.execute("SELECT count(*) FROM player_xref WHERE source = 'yahoo'").fetchone()[0] == 0
    assert universe.execute("SELECT count(*) FROM unresolved_names").fetchone()[0] == 0
    assert universe.execute("SELECT count(*) FROM draft_picks").fetchone()[0] == 0
    temp = dict(universe.execute(
        "SELECT table_name, temporary FROM duckdb_tables() WHERE table_name LIKE 'yahoo_%'").fetchall())
    assert temp and all(temp.values())
    assert "unresolved_names" not in yahoo.load_live(universe, yahoo.CsvBackend(folder))   # never logged


def test_reloading_unchanged_files_is_a_no_op(universe, inbox):
    folder, write = inbox
    write("roster", ROSTER)
    yahoo.load_live(universe, yahoo.CsvBackend(folder))
    yahoo.load_live(universe, yahoo.CsvBackend(folder))
    assert universe.execute("SELECT count(*) FROM yahoo_rosters").fetchone()[0] == 3


def test_one_bad_file_loads_nothing(universe, inbox):
    folder, write = inbox
    write("roster", ROSTER)
    write("matchup", "week,team_id\n1,11\n")
    with pytest.raises(yahoo.YahooCsvError, match="matchup.csv"):
        yahoo.load_live(universe, yahoo.CsvBackend(folder))
    assert universe.execute("SELECT count(*) FROM yahoo_rosters").fetchone()[0] == 0


def test_empty_inbox_loads_only_league_settings(universe, tmp_path):
    assert yahoo.load_live(universe, yahoo.CsvBackend(tmp_path))["loaded"] == {}
    assert universe.execute("SELECT count(*) FROM yahoo_league").fetchone()[0] == 1


def test_pull_from_downloads_moves_only_newer_files(tmp_path):
    from jobs.ingest_inbox import pull_from_downloads
    inbox, downloads = tmp_path / "inbox", tmp_path / "dl"
    inbox.mkdir()
    downloads.mkdir()
    (inbox / "roster.csv").write_text("old")
    (downloads / "roster.csv").write_text("new")
    (downloads / "players.csv").write_text("p")
    (downloads / "unrelated.csv").write_text("x")
    os.utime(inbox / "roster.csv", (1, 1))
    assert sorted(pull_from_downloads(inbox, downloads)) == ["players.csv", "roster.csv"]
    assert (inbox / "roster.csv").read_text() == "new" and (downloads / "unrelated.csv").exists()
    (downloads / "matchup.csv").write_text("stale")
    os.utime(downloads / "matchup.csv", (1, 1))
    (inbox / "matchup.csv").write_text("fresh")
    assert pull_from_downloads(inbox, downloads) == []


def test_teams_csv_loads_names_and_rejects_bad_ids(con, tmp_path):
    from research_room.draft import tracker
    from research_room.ingest import yahoo
    inbox = tmp_path / "inbox"
    inbox.mkdir()
    (inbox / "teams.csv").write_text("team_id,team_name\n1,Invented Alpha\n2,Made-Up Beta 🤠\n")
    counts = yahoo.load_live(con, yahoo.CsvBackend(inbox))["loaded"]
    assert counts["teams"] == 2
    assert tracker.league_team_names(con) == {1: "Invented Alpha", 2: "Made-Up Beta 🤠"}

    (inbox / "teams.csv").write_text("team_id,team_name\n15,Too Many\n")
    with pytest.raises(yahoo.YahooCsvError, match="team_id must be 1..14"):
        yahoo.load_live(con, yahoo.CsvBackend(inbox))

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


def test_ingest_inbox_writes_tables_resolves_names_and_quarantines(universe, inbox, tmp_path):
    folder, write = inbox
    write("roster", ROSTER)
    write("players", PLAYERS)
    write("matchup", MATCHUP)
    write("draft_results", DRAFT)
    counts = yahoo.ingest_inbox(universe, yahoo.CsvBackend(folder))
    assert counts == {"roster": 3, "players": 2, "matchup": 1, "draft_results": 1}
    roster = dict(universe.execute("SELECT player_name, player_id FROM yahoo_rosters").fetchall())
    assert roster == {"Nikola Jokic": 7, "Jalen Williams": 10, "Mystery Man": None}
    fa = universe.execute("SELECT player_id FROM yahoo_players WHERE player_name='Jalen Williams'").fetchone()
    assert fa[0] == 11                                       # Yahoo "GS" -> BDL GSW tie-break
    q = universe.execute("SELECT raw_name, reason FROM unresolved_names").fetchall()
    assert q == [("Mystery Man", "no_match")]
    snap = universe.execute("SELECT DISTINCT snapshot_at FROM yahoo_rosters").fetchone()[0]
    assert snap == datetime.fromtimestamp(1_790_000_000, tz=UTC)
    assert universe.execute("SELECT player_id FROM draft_picks").fetchone()[0] == 7
    # Every rostered player is either matched or in quarantine (acceptance criterion).
    unmatched = universe.execute("""
        SELECT count(*) FROM yahoo_rosters r
        WHERE r.player_id IS NULL AND NOT EXISTS (
            SELECT 1 FROM unresolved_names u WHERE u.source='yahoo' AND u.source_key=r.yahoo_player_key)
    """).fetchone()[0]
    assert unmatched == 0


def test_reingesting_unchanged_files_is_a_no_op(universe, inbox):
    folder, write = inbox
    write("roster", ROSTER)
    yahoo.ingest_inbox(universe, yahoo.CsvBackend(folder))
    yahoo.ingest_inbox(universe, yahoo.CsvBackend(folder))
    assert universe.execute("SELECT count(*) FROM yahoo_rosters").fetchone()[0] == 3


def test_one_bad_file_writes_nothing(universe, inbox):
    folder, write = inbox
    write("roster", ROSTER)
    write("matchup", "week,team_id\n1,11\n")
    with pytest.raises(yahoo.YahooCsvError, match="matchup.csv"):
        yahoo.ingest_inbox(universe, yahoo.CsvBackend(folder))
    assert universe.execute("SELECT count(*) FROM yahoo_rosters").fetchone()[0] == 0


def test_empty_inbox_ingests_only_league_settings(universe, tmp_path):
    assert yahoo.ingest_inbox(universe, yahoo.CsvBackend(tmp_path)) == {}
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

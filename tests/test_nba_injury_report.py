"""The NBA injury report: file names, parsing the report's text, storing it, and reading it into
the overrides (listed statuses, and 'not listed' for teams that have filed). Invented players."""

from __future__ import annotations

from datetime import UTC, date, datetime

import numpy as np
import pandas as pd
import pytest

from research_room import overrides, store
from research_room.config import settings
from research_room.ingest import nba_injury_report as nr

NOW = datetime(2026, 11, 4, 22, 7, tzinfo=UTC)          # 5:07 PM Eastern
META = {"source": "test", "fetched_at": pd.Timestamp(NOW)}
DAY = date(2026, 11, 4)

TEXT = """Injury Report: 11/04/26 05:00 PM
Game Date Game Time Matchup Team Player Name Current Status Reason
11/04/2026 07:30 (ET) NYK@SAS New York Knicks Guard Jr., Invented Questionable Injury/Illness - Left
Ankle; Sprain
Wing, Made Up Out G League - Two-Way
San Antonio Spurs Center, Made Up Doubtful Injury/Illness - Back; Spasms
Page 1 of 2
Nobody, Unknown Probable Rest
10:00 (ET) BOS@LAC Boston Celtics NOT YET SUBMITTED
LA Clippers Forward, Some Out Injury/Illness - Knee
"""


@pytest.fixture
def seeded(con):
    teams = [(1, "NYK", "New York Knicks"), (2, "SAS", "San Antonio Spurs"), (3, "BOS", "Boston Celtics"),
             (4, "LAC", "LA Clippers")]
    store.upsert(con, "teams", pd.DataFrame(
        [{"team_id": i, "abbreviation": a, "full_name": n, **META} for i, a, n in teams]))
    store.upsert(con, "games", pd.DataFrame([
        {"game_id": 77, "season": 2026, "game_date": DAY, "home_team_id": 2, "visitor_team_id": 1,
         "postseason": False, **META},
        {"game_id": 78, "season": 2026, "game_date": DAY, "home_team_id": 4, "visitor_team_id": 3,
         "postseason": False, **META},
    ]))
    players = [(501, "Invented Guard Jr.", 1), (502, "Made Up Wing", 1), (503, "Healthy Starter", 1),
               (601, "Made Up Center", 2), (602, "Spurs Starter", 2), (701, "Celtic Guy", 3),
               (801, "Some Forward", 4)]
    store.upsert(con, "players", pd.DataFrame(
        [{"player_id": i, "full_name": n, "team_id": t, **META} for i, n, t in players]))
    return con


def test_file_names_cover_both_formats_newest_first():
    cfg = settings()
    names = nr.candidates(NOW, cfg)
    assert names[:3] == ["Injury-Report_2026-11-04_05_00PM.pdf", "Injury-Report_2026-11-04_05PM.pdf",
                         "Injury-Report_2026-11-04_04_45PM.pdf"]
    assert names[-2:] == ["Injury-Report_2026-11-04_02_00PM.pdf", "Injury-Report_2026-11-04_02PM.pdf"]


def test_parse_reads_carried_lines_suffixes_and_unfiled_teams(seeded):
    ts, players, teams = nr.parse_text(TEXT, nr.team_names(seeded))
    assert ts == datetime(2026, 11, 4, 22, 0, tzinfo=UTC)
    got = {(r.raw_name, r.team_id, r.status) for r in players.itertuples()}
    assert got == {("Invented Guard Jr.", 1, "Questionable"), ("Made Up Wing", 1, "Out"),
                   ("Made Up Center", 2, "Doubtful"), ("Unknown Nobody", 2, "Probable"),
                   ("Some Forward", 4, "Out")}
    filed = {(r.team_id, r.submitted) for r in teams.itertuples()}
    assert filed == {(1, True), (2, True), (3, False), (4, True)}
    assert players.loc[players["raw_name"] == "Made Up Wing", "reason"].item() == "G League - Two-Way"


class FakeClient:
    def __init__(self, files):
        self.files, self.asked = files, []

    def get_bytes(self, url):
        self.asked.append(url.rsplit("/", 1)[-1])
        return self.files.get(url.rsplit("/", 1)[-1])


def test_sync_stores_once_and_quarantines_unknown_names(seeded, monkeypatch):
    monkeypatch.setattr(nr, "pdf_text", lambda content: TEXT)
    client = FakeClient({"Injury-Report_2026-11-04_05_00PM.pdf": b"%PDF-1.7 fake"})
    out = nr.sync(seeded, settings(), client, now=NOW)
    assert out["status"] == "ok" and out["players"] == 4 and out["unmatched"] == 1
    assert out["not_submitted"] == 1
    assert client.asked == ["Injury-Report_2026-11-04_05_00PM.pdf"]
    bad = seeded.execute("SELECT raw_name FROM unresolved_names WHERE source = 'nba_report'").fetchall()
    assert bad == [("Unknown Nobody",)]
    assert nr.sync(seeded, settings(), client, now=NOW)["status"] == "unchanged"
    assert nr.sync(seeded, settings(), FakeClient({}), now=NOW)["status"] == "skipped"


def test_overrides_read_statuses_and_not_listed(seeded, monkeypatch):
    cfg = settings()
    monkeypatch.setattr(nr, "pdf_text", lambda content: TEXT)
    nr.sync(seeded, cfg, FakeClient({"Injury-Report_2026-11-04_05_00PM.pdf": b"%PDF"}), now=NOW)
    rows = overrides.from_nba_report(seeded, DAY, DAY, NOW, cfg).set_index("player_id")
    assert rows.at[501, "play_prob"] == cfg.overrides.status_play_prob["Questionable"]
    assert rows.at[601, "play_prob"] == cfg.overrides.status_play_prob["Doubtful"]
    assert rows.at[503, "status"] == overrides.NOT_LISTED and pd.isna(rows.at[503, "play_prob"])
    assert rows.at[602, "status"] == overrides.NOT_LISTED
    assert 701 not in rows.index                                   # Boston hasn't filed: no news
    # a stale BallDontLie "Out" loses to the league's report not listing him
    store.upsert(seeded, "injuries", pd.DataFrame([{
        "player_id": 503, "status": "Out", "description": "old", "return_date": None,
        "source": "bdl", "fetched_at": pd.Timestamp(NOW) - pd.Timedelta(hours=2)}]))
    best = overrides.resolve(seeded, DAY, DAY, as_of=NOW, cfg=cfg).set_index("player_id")
    assert best.at[503, "status"] == overrides.NOT_LISTED


def test_status_news_time_is_the_first_report_with_it(seeded, monkeypatch):
    cfg = settings()
    earlier = TEXT.replace("05:00 PM", "01:00 PM").replace("Questionable", "Probable", 1)
    later = TEXT.replace("05:00 PM", "05:30 PM")
    for text, when, utc_hour, minute in ((earlier, "01_00PM", 18, 0), (TEXT, "05_00PM", 22, 0),
                                         (later, "05_30PM", 22, 30)):
        monkeypatch.setattr(nr, "pdf_text", lambda content, t=text: t)
        nr.sync(seeded, cfg, FakeClient({f"Injury-Report_2026-11-04_{when}.pdf": b"%PDF"}),
                now=datetime(2026, 11, 4, utc_hour, minute + 5, tzinfo=UTC))
    rows = overrides.from_nba_report(seeded, DAY, DAY, datetime(2026, 11, 5, tzinfo=UTC), cfg)
    rows = rows.set_index("player_id")
    assert pd.Timestamp(rows.at[501, "ts"]) == pd.Timestamp("2026-11-04 22:00", tz="UTC")  # Q since 5 PM
    assert pd.Timestamp(rows.at[502, "ts"]) == pd.Timestamp("2026-11-04 18:00", tz="UTC")  # out since 1 PM


def test_not_listed_rotation_players_play_by_their_play_rate():
    cfg = settings()
    df = pd.DataFrame({"status_override": [overrides.NOT_LISTED] * 3 + [None],
                       "play_rate_ewma": [1.0, 0.2, 1.0, 1.0], "min_played_ewma": [30.0, 25.0, 5.0, 30.0]})
    p = overrides.fill_unlisted(df, cfg)
    u = cfg.overrides.unlisted
    assert p[0] == u.probs[-1] and p[1] == u.probs[0]
    assert np.isnan(p[2]) and np.isnan(p[3])                      # bench player; not a report row


def test_a_reader_on_an_older_store_sees_no_report(tmp_path):
    """Read-only connections don't create new tables: no report, no crash."""
    path = tmp_path / "old.duckdb"
    w = store.connect(path)
    w.execute("DROP TABLE nba_report_teams")
    w.execute("DROP TABLE nba_report_rows")
    w.close()
    r = store.connect(path, read_only=True)
    assert overrides.from_nba_report(r, DAY, DAY, NOW, settings()).empty
    r.close()


def test_a_filed_report_without_him_breaks_the_news_run(seeded, monkeypatch):
    """Audit F10: Questionable at 5 PM, missing from a filed 5:30 report, Questionable again at
    6 PM: the news time is 6 PM, not 5 PM."""
    cfg = settings()
    gone = TEXT.replace("05:00 PM", "05:30 PM").replace(
        "Guard Jr., Invented Questionable Injury/Illness - Left\nAnkle; Sprain\n", "")
    back = TEXT.replace("05:00 PM", "06:00 PM")
    for text, when, utc_hour, minute in ((TEXT, "05_00PM", 22, 0), (gone, "05_30PM", 22, 30),
                                         (back, "06_00PM", 23, 0)):
        monkeypatch.setattr(nr, "pdf_text", lambda content, t=text: t)
        nr.sync(seeded, cfg, FakeClient({f"Injury-Report_2026-11-04_{when}.pdf": b"%PDF"}),
                now=datetime(2026, 11, 4, utc_hour, minute + 5, tzinfo=UTC))
    later = datetime(2026, 11, 5, tzinfo=UTC)
    rows = overrides.from_nba_report(seeded, DAY, DAY, later, cfg).set_index("player_id")
    assert pd.Timestamp(rows.at[501, "ts"]) == pd.Timestamp("2026-11-04 23:00", tz="UTC")

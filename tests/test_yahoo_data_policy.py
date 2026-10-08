"""Yahoo data policy: read live, held in memory for one job or page, never stored, cached or
indexed; read only; my team and my opponent only; never fed to a model or an AI tool; deletable
in one command. Invented names only."""

from __future__ import annotations

import re
from pathlib import Path

import duckdb
import pandas as pd
import pytest

from research_room import store
from research_room.config import settings
from research_room.ingest import yahoo, yahoo_api, yahoo_live

SENTINEL = "Zzyzx Quillfeather"  # an invented player name: must never reach the store
SRC = Path(__file__).resolve().parents[1] / "src" / "research_room"


def _inbox(tmp_path, me, opp):
    (tmp_path / "teams.csv").write_text(
        f"team_id,team_name\n{me},Invented Mine\n{opp},Invented Rival\n3,Other\n"
    )
    (tmp_path / "roster.csv").write_text(
        "team_id,player_name,selected_slot,eligible_positions,status,team_abbr\n"
        f"{me},{SENTINEL},PG,PG,,BOS\n{opp},Invented Rival Guard,PG,PG,,MIA\n3,Third Team Guard,PG,PG,,NYK\n"
    )
    cats = "fg_pct,ft_pct,fg3m,pts,reb,ast,stl,blk,tov"
    (tmp_path / "matchup.csv").write_text(
        f"week,team_id,opponent_team_id,{cats}\n1,{me},{opp},.5,.8,1,10,5,3,1,1,2\n"
        f"1,{opp},{me},.4,.7,0,9,4,2,0,0,3\n"
    )
    return tmp_path


def test_nothing_from_yahoo_survives_the_connection(tmp_path):
    cfg = settings()
    me = cfg.league.my_team_id
    db = tmp_path / "s.duckdb"
    con = store.connect(db)
    (tmp_path / "in").mkdir()
    inbox = _inbox(tmp_path / "in", me, 2)
    out = yahoo.load_live(con, yahoo_live._Limited(yahoo.CsvBackend(inbox), me), cfg)
    assert out["loaded"]["roster"] == 2  # mine + opponent, not team 3
    assert (
        con.execute("SELECT count(*) FROM yahoo_rosters WHERE player_name = ?", [SENTINEL]).fetchone()[0] == 1
    )
    con.close()
    raw = duckdb.connect(str(db), read_only=True)
    tables = [r[0] for r in raw.execute("SELECT table_name FROM duckdb_tables()").fetchall()]
    assert not [t for t in tables if t.startswith("yahoo_")]
    for t in tables:  # the name is nowhere in the file
        cols = [
            r[0]
            for r in raw.execute(
                "SELECT column_name FROM duckdb_columns() WHERE table_name = ? AND data_type = 'VARCHAR'", [t]
            ).fetchall()
        ]
        for c in cols:
            hit = raw.execute(f'SELECT count(*) FROM "{t}" WHERE "{c}" LIKE ?', [f"%{SENTINEL}%"]).fetchone()[
                0
            ]
            assert hit == 0, (t, c)
    raw.close()


def test_stored_copies_from_before_are_dropped_on_start(tmp_path):
    db = tmp_path / "old.duckdb"
    raw = duckdb.connect(str(db))
    raw.execute("CREATE TABLE yahoo_rosters (team_id INTEGER, player_name VARCHAR)")
    raw.execute(f"INSERT INTO yahoo_rosters VALUES (11, '{SENTINEL}')")
    raw.close()
    con = store.connect(db)
    con.execute("INSERT INTO player_xref VALUES ('yahoo', 'k', 'x', 1, 'exact', now())")
    assert store.purge_stored_yahoo(con) == {"player_xref": 1, "unresolved_names": 0}
    stored = con.execute(
        "SELECT count(*) FROM duckdb_tables() WHERE NOT temporary AND table_name LIKE 'yahoo_%'"
    )
    assert stored.fetchone()[0] == 0
    con.close()


def test_the_purge_removes_every_yahoo_item(tmp_path, con):
    from jobs.yahoo_purge import purge

    cfg = settings()
    cfg = cfg.model_copy(
        update={
            "paths": cfg.paths.model_copy(
                update={"inbox_dir": tmp_path / "inbox", "db": tmp_path / "data" / "s.duckdb"}
            )
        }
    )
    (tmp_path / "inbox").mkdir()
    (tmp_path / "data").mkdir()
    for f in ("inbox/roster.csv", "inbox/teams.csv", "inbox/opponent.json", "oauth2.json", "data/notifications_read.json"):
        (tmp_path / f).write_text("x")
    con.execute("INSERT INTO week_outcomes VALUES (1, 5, 4, now())")
    out = purge(con, cfg, root=tmp_path)
    assert out["week_outcomes"] == 1 and con.execute("SELECT count(*) FROM week_outcomes").fetchone()[0] == 0
    assert not any(
        (tmp_path / f).exists()
        for f in ("inbox/roster.csv", "inbox/teams.csv", "inbox/opponent.json", "oauth2.json", "data/notifications_read.json")
    )


def test_throttled_reads_back_off_and_other_errors_do_not_retry():
    waits, calls = [], []

    def throttled():
        calls.append(1)
        raise RuntimeError('b\'{"error": "Request denied"}\' 999')

    with pytest.raises(RuntimeError):
        yahoo_api._with_backoff(throttled, sleep=waits.append)()
    assert waits == [2, 4, 8, 16] and len(calls) == 5  # exponential, then gives up

    def broken():
        calls.append(1)
        raise ValueError("bad league id")

    calls.clear()
    with pytest.raises(ValueError):
        yahoo_api._with_backoff(broken, sleep=waits.append)()
    assert len(calls) == 1

    state = {"n": 0}

    def flaky():
        state["n"] += 1
        if state["n"] < 3:
            raise RuntimeError("429 Too Many Requests")
        return "ok"

    assert yahoo_api._with_backoff(flaky, sleep=lambda s: None)() == "ok"


MODEL_CODE = [
    "projections",
    "features.py",
    "teammates.py",
    "calibration.py",
    "backtest.py",
    "backtest_news.py",
    "shadow.py",
    "scorecard.py",
    "ingest/x_feed.py",
    "overrides.py",
]


@pytest.mark.parametrize("path", MODEL_CODE)
def test_no_model_or_ai_code_reads_yahoo_data(path):
    """Models fit on NBA box scores only, and the X reader (the only AI tool) sees X posts only."""
    target = SRC / path
    for f in target.rglob("*.py") if target.is_dir() else [target]:
        assert not re.search(
            r"yahoo_(rosters|players|matchups|teams|league)|yahoo_live|ingest\.yahoo\b", f.read_text()
        ), f


def test_the_ai_reader_is_sent_post_fields_only():
    from types import SimpleNamespace

    from research_room.ingest import x_feed

    sent = {}

    class Client:
        messages = None

        def __init__(self):
            self.messages = self

        def create(self, **k):
            sent.update(k)
            return SimpleNamespace(stop_reason="tool_use", content=[])

    p = x_feed.LlmParser(settings(), client=Client())
    p.parse(
        [
            {
                "id": "1",
                "handle": "h",
                "created_at": "c",
                "at_et": "a",
                "dates_ahead": "d",
                "text": "t",
                "extra": "never sent",
            }
        ]
    )
    import json

    batch = json.loads(sent["messages"][0]["content"])
    assert set(batch[0]) == {"post_id", "account", "at", "at_et", "dates_ahead", "text"}
    assert "yahoo" not in json.dumps(sent).lower()


def test_rosters_are_mine_and_my_opponent_only(tmp_path):
    cfg = settings()
    me = cfg.league.my_team_id
    inbox = _inbox(tmp_path, me, 2)
    lim = yahoo_live._Limited(yahoo.CsvBackend(inbox), me)
    assert set(lim.read("roster")["team_id"]) == {me, 2}
    assert isinstance(lim.read("teams"), pd.DataFrame)

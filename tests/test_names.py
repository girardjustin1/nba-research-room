from __future__ import annotations

from datetime import UTC, datetime

import pandas as pd
import pytest

from research_room import store
from research_room.ingest.names import NameResolver, load_team_aliases, normalize_name, resolve_and_record

PLAYERS = pd.DataFrame([
    {"player_id": 1, "full_name": "Nikola Jokić", "team_abbr": "DEN"},
    {"player_id": 2, "full_name": "P.J. Washington Jr.", "team_abbr": "DAL"},
    {"player_id": 3, "full_name": "Shai Gilgeous-Alexander", "team_abbr": "OKC"},
    {"player_id": 10, "full_name": "Jalen Williams", "team_abbr": "OKC"},
    {"player_id": 11, "full_name": "Jalen Williams", "team_abbr": "GSW"},
    {"player_id": 20, "full_name": "Herbert Jones", "team_abbr": "NOP"},
])


@pytest.mark.parametrize(("raw", "expected"), [
    ("Nikola Jokić", "nikola jokic"),
    ("P.J. Washington Jr.", "pj washington"),
    ("PJ Washington", "pj washington"),
    ("Shai Gilgeous-Alexander", "shai gilgeous alexander"),
    ("De'Aaron Fox", "deaaron fox"),
    ("Jaren Jackson Jr", "jaren jackson"),
    ("  KEVIN   durant ", "kevin durant"),
    (None, ""),
])
def test_normalize_name(raw, expected):
    assert normalize_name(raw) == expected


def test_exact_match_is_accent_and_suffix_insensitive():
    r = NameResolver(PLAYERS)
    assert r.resolve("Nikola Jokic").player_id == 1
    assert r.resolve("PJ Washington").player_id == 2
    assert r.resolve("Shai Gilgeous Alexander").method == "exact"


def test_shared_name_is_split_by_team_or_quarantined():
    r = NameResolver(PLAYERS, team_aliases={"GS": "GSW"})
    assert r.resolve("Jalen Williams", "OKC").player_id == 10
    assert r.resolve("Jalen Williams", "GS").player_id == 11       # Yahoo abbreviation mapped
    amb = r.resolve("Jalen Williams")
    assert amb.player_id is None and amb.reason == "ambiguous" and len(amb.candidates) == 2


def test_unmatched_is_never_guessed_but_suggests_candidates():
    res = NameResolver(PLAYERS).resolve("Nikola Jokicc")
    assert res.player_id is None and res.reason == "no_match"
    assert "nikola jokic" in res.candidates


def test_aliases_by_id_and_by_name():
    aliases = [{"name": "Herbert Jones", "player_id": None, "variants": ["Herb Jones"]},
               {"name": "Jalen Williams", "player_id": 10, "variants": ["J-Dub"]},
               {"name": "Gone Player", "player_id": 999, "variants": ["Ghost"]}]
    r = NameResolver(PLAYERS, aliases)
    assert (r.resolve("Herb Jones").player_id, r.resolve("Herb Jones").method) == (20, "alias_name")
    assert r.resolve("J-Dub").player_id == 10
    assert r.resolve("Ghost").reason == "alias_target_missing"


def test_repo_team_aliases_parse_as_strings():
    mapping = load_team_aliases()
    assert mapping["NO"] == "NOP" and all(isinstance(k, str) for k in mapping)


def test_resolve_and_record_writes_xref_and_quarantine_then_clears(con):
    rows = pd.DataFrame([
        {"source_key": "y1", "raw_name": "Nikola Jokic", "team_abbr": "DEN"},
        {"source_key": "y2", "raw_name": "Jalen Williams", "team_abbr": None},
        {"source_key": "y3", "raw_name": "Nobody Atall", "team_abbr": "BOS"},
    ])
    ids = resolve_and_record(con, "yahoo", rows, NameResolver(PLAYERS))
    assert ids.tolist() == [1, pd.NA, pd.NA]
    assert con.execute("SELECT count(*) FROM player_xref").fetchone()[0] == 1
    q = dict(con.execute("SELECT source_key, reason FROM unresolved_names").fetchall())
    assert q == {"y2": "ambiguous", "y3": "no_match"}

    # Same name with a team now resolves and leaves the quarantine.
    fixed = pd.DataFrame([{"source_key": "y2", "raw_name": "Jalen Williams", "team_abbr": "OKC"}])
    resolve_and_record(con, "yahoo", fixed, NameResolver(PLAYERS))
    assert [r[0] for r in con.execute("SELECT source_key FROM unresolved_names").fetchall()] == ["y3"]


def test_player_universe_joins_team_abbreviation(con):
    from research_room.ingest.names import player_universe
    now = datetime(2026, 10, 1, tzinfo=UTC)
    store.upsert(con, "teams", pd.DataFrame([{"team_id": 8, "abbreviation": "DEN", "source": "t",
                                               "fetched_at": now}]))
    store.upsert(con, "players", pd.DataFrame([{"player_id": 1, "full_name": "Nikola Jokić", "team_id": 8,
                                                 "source": "t", "fetched_at": now}]))
    assert player_universe(con).iloc[0]["team_abbr"] == "DEN"

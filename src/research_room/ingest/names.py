"""Cross-source player identity: map a name from any source to a BallDontLie player_id.

Inputs: `players` + `teams` tables (the BDL universe), config/aliases.yaml, and rows of
(source_key, raw_name, team_abbr) from an ingest module.
Outputs: a player_id per row, or None.
Tables: reads players, teams; writes player_xref (resolved) and unresolved_names (quarantine).

Rules:
- Matching is exact after normalisation (accents, case, punctuation, Jr./III suffixes).
- If several players share a normalised name, the team breaks the tie; if it cannot, the row
  is quarantined as ambiguous. Ambiguous or unmatched names are never merged or guessed.
- Close matches are recorded as `candidates` in the quarantine to help write an alias, but
  never used automatically.
"""

from __future__ import annotations

import difflib
import re
import unicodedata
from dataclasses import dataclass, field

import duckdb
import pandas as pd

from research_room import store
from research_room.config import load_aliases

_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def normalize_name(name: str | None) -> str:
    """Comparison key: 'Nikola Jokić' -> 'nikola jokic'; 'P.J. Washington Jr.' -> 'pj washington'."""
    if not name:
        return ""
    text = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode()
    text = text.lower().replace("-", " ")
    text = re.sub(r"[.'’`,]", "", text)
    tokens = [t for t in re.sub(r"[^a-z0-9 ]", " ", text).split() if t]
    while len(tokens) > 1 and tokens[-1] in _SUFFIXES:
        tokens.pop()
    return " ".join(tokens)


def load_team_aliases(path=None) -> dict[str, str]:
    """Map other sources' team abbreviations (e.g. Yahoo 'GS') to BDL ones ('GSW')."""
    import yaml

    from research_room.config import CONFIG_DIR

    raw = yaml.safe_load(((path or CONFIG_DIR / "aliases.yaml")).read_text()) or {}
    mapping = raw.get("team_aliases") or {}
    if any(isinstance(k, bool) for k in mapping):
        raise ValueError("aliases.yaml team_aliases has an unquoted key YAML read as true/false; quote it")
    return {str(k).upper(): str(v).upper() for k, v in mapping.items()}


@dataclass
class Resolution:
    player_id: int | None
    method: str | None = None          # alias_id | alias_name | exact | exact_team
    reason: str | None = None          # no_match | ambiguous | alias_target_missing
    candidates: list[str] = field(default_factory=list)


class NameResolver:
    """Resolve raw names against a fixed player universe. Pure: no database access."""

    def __init__(self, players: pd.DataFrame, aliases: list[dict] | None = None,
                 team_aliases: dict[str, str] | None = None) -> None:
        """`players` needs columns player_id, full_name and (optionally) team_abbr."""
        self._team_aliases = team_aliases or {}
        self._by_name: dict[str, list[tuple[int, str | None]]] = {}
        for row in players.itertuples(index=False):
            key = normalize_name(row.full_name)
            team = getattr(row, "team_abbr", None)
            self._by_name.setdefault(key, []).append((int(row.player_id), team if team else None))
        self._ids = {pid for entries in self._by_name.values() for pid, _ in entries}
        self._alias: dict[str, tuple[str, int | None, str]] = {}
        for entry in aliases or []:
            canonical = entry.get("name", "")
            for variant in entry.get("variants", []) or []:
                self._alias[normalize_name(variant)] = ("alias", entry.get("player_id"), canonical)

    def _team(self, abbr: str | None) -> str | None:
        if not abbr:
            return None
        up = str(abbr).upper()
        return self._team_aliases.get(up, up)

    def resolve(self, raw_name: str, team_abbr: str | None = None) -> Resolution:
        key = normalize_name(raw_name)
        team = self._team(team_abbr)
        if key in self._alias:
            _, alias_id, canonical = self._alias[key]
            if alias_id is not None:
                if int(alias_id) in self._ids:
                    return Resolution(int(alias_id), method="alias_id")
                return Resolution(None, reason="alias_target_missing", candidates=[str(alias_id)])
            key = normalize_name(canonical)
            matches = self._by_name.get(key, [])
            if len(matches) == 1:
                return Resolution(matches[0][0], method="alias_name")
        matches = self._by_name.get(key, [])
        if len(matches) == 1:
            return Resolution(matches[0][0], method="exact")
        if len(matches) > 1:
            on_team = [pid for pid, t in matches if team and t == team]
            if len(on_team) == 1:
                return Resolution(on_team[0], method="exact_team")
            return Resolution(None, reason="ambiguous",
                              candidates=[f"{pid} ({t or '?'})" for pid, t in matches])
        close = difflib.get_close_matches(key, self._by_name.keys(), n=3, cutoff=0.85)
        return Resolution(None, reason="no_match", candidates=close)


def player_universe(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """BDL players with their current team abbreviation."""
    return con.execute("""
        SELECT p.player_id, p.full_name, t.abbreviation AS team_abbr
        FROM players p LEFT JOIN teams t USING (team_id)
    """).df()


def resolve_and_record(con: duckdb.DuckDBPyConnection, source: str, rows: pd.DataFrame,
                       resolver: NameResolver | None = None) -> pd.Series:
    """Resolve `rows` (source_key, raw_name, team_abbr) and persist the outcome.

    Returns a nullable Int64 Series of player_id aligned to `rows`. Resolved rows go to
    `player_xref`; the rest go to `unresolved_names` and are removed from it once resolved.
    """
    resolver = resolver or NameResolver(player_universe(con), load_aliases(), load_team_aliases())
    now = store.utcnow()
    ids, xref, quarantine = [], [], []
    for row in rows.itertuples(index=False):
        team = getattr(row, "team_abbr", None)
        res = resolver.resolve(row.raw_name, team)
        ids.append(res.player_id)
        if res.player_id is not None:
            xref.append({"source": source, "source_key": str(row.source_key), "raw_name": row.raw_name,
                         "player_id": res.player_id, "method": res.method, "resolved_at": now})
        else:
            quarantine.append({"source": source, "source_key": str(row.source_key),
                               "raw_name": row.raw_name, "team_abbr": team, "reason": res.reason,
                               "candidates": "; ".join(res.candidates), "last_seen": now})
    if xref:
        store.upsert(con, "player_xref", pd.DataFrame(xref))
        keys = pd.DataFrame(xref)[["source", "source_key"]]
        con.register("_resolved", keys)
        con.execute("DELETE FROM unresolved_names u USING _resolved r "
                    "WHERE u.source = r.source AND u.source_key = r.source_key")
        con.unregister("_resolved")
    if quarantine:
        q = pd.DataFrame(quarantine)
        first = con.execute("SELECT source, source_key, first_seen FROM unresolved_names WHERE source = ?",
                            [source]).df()
        q = q.merge(first, on=["source", "source_key"], how="left")
        q["first_seen"] = q["first_seen"].fillna(now)
        store.upsert(con, "unresolved_names", q)
    return pd.Series(ids, index=rows.index, dtype="Int64")

"""Yahoo Fantasy ingest (read-only). CSV snapshots in data/inbox/ are the default backend;
an OAuth `ApiBackend` will implement the same interface once API access is approved.

Inputs: data/inbox/{teams,roster,players,matchup,draft_results}.csv (column schemas in `SCHEMAS`
and the README), settings.league.
Outputs: validated snapshot frames written to the store, names resolved to BDL ids.
Tables: writes yahoo_league, yahoo_teams, yahoo_rosters, yahoo_players, yahoo_matchups, draft_picks,
player_xref, unresolved_names, ingest_runs; reads players, teams.

Nothing here performs any action inside Yahoo. Each file's snapshot time is its modification
time (UTC), so re-ingesting an unchanged file is a no-op.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol

import duckdb
import pandas as pd

from research_room import store
from research_room.config import Settings, settings
from research_room.ingest.names import normalize_name, resolve_and_record

SOURCE = "yahoo"


@dataclass(frozen=True)
class Column:
    name: str
    kind: str              # str | int | float | positions
    required: bool = True


SCHEMAS: dict[str, tuple[Column, ...]] = {
    "teams": (Column("team_id", "int"), Column("team_name", "str")),
    "roster": (
        Column("team_id", "int"), Column("player_name", "str"), Column("selected_slot", "str"),
        Column("eligible_positions", "positions"), Column("status", "str", required=False),
        Column("team_abbr", "str", required=False), Column("yahoo_player_key", "str", required=False),
    ),
    "players": (
        Column("player_name", "str"), Column("team_abbr", "str"),
        Column("eligible_positions", "positions"), Column("pct_rostered", "float"),
        Column("status", "str", required=False), Column("owner_team_id", "int", required=False),
        Column("yahoo_player_key", "str", required=False),
    ),
    "matchup": (
        Column("week", "int"), Column("team_id", "int"), Column("opponent_team_id", "int"),
        *(Column(c, "float") for c in ("fg_pct", "ft_pct", "fg3m", "pts", "reb", "ast", "stl", "blk", "tov")),
        Column("acquisitions_used", "int", required=False),
    ),
    "draft_results": (
        Column("pick_no", "int"), Column("round", "int"), Column("team_id", "int"),
        Column("player_name", "str"), Column("team_abbr", "str", required=False),
        Column("yahoo_player_key", "str", required=False),
    ),
}

_SLOTS = {"PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "BN", "IL", "IL+"}


class YahooCsvError(ValueError):
    """A CSV in the inbox does not match its schema. The message lists every problem."""


class YahooBackend(Protocol):
    def available(self) -> dict[str, datetime]: ...
    def read(self, name: str) -> pd.DataFrame: ...


def _positions(value: object) -> str | None:
    """'PG/SG', 'PG, SG', 'PG;SG' -> 'PG,SG'. Unknown codes are an error."""
    if value is None or (isinstance(value, float) and pd.isna(value)) or str(value).strip() == "":
        return None
    codes = [c.strip().upper() for c in re.split(r"[,/;|]", str(value)) if c.strip()]
    bad = [c for c in codes if c not in _SLOTS]
    if bad:
        raise ValueError(f"unknown position code(s) {bad}")
    return ",".join("Util" if c == "UTIL" else c for c in codes)


def validate(name: str, raw: pd.DataFrame) -> pd.DataFrame:
    """Coerce `raw` to the schema for `name`, or raise YahooCsvError listing every problem."""
    schema = SCHEMAS[name]
    df = raw.rename(columns=lambda c: str(c).strip().lower())
    problems = []
    missing = [c.name for c in schema if c.required and c.name not in df.columns]
    if missing:
        problems.append(f"missing required column(s): {missing}")
    unknown = sorted(set(df.columns) - {c.name for c in schema})
    if unknown:
        problems.append(f"unknown column(s): {unknown} (expected {[c.name for c in schema]})")
    if problems:
        raise YahooCsvError(f"{name}.csv: " + "; ".join(problems))
    out = pd.DataFrame(index=df.index)
    for col in schema:
        if col.name not in df.columns:
            out[col.name] = None
            continue
        series = df[col.name]
        blank = series.isna() | (series.astype(str).str.strip() == "")
        if col.required and blank.any():
            rows = (series.index[blank] + 2).tolist()            # +2: header line, 1-based
            problems.append(f"{col.name}: blank in required column at line(s) {rows[:10]}")
        if col.kind == "int":
            conv = pd.to_numeric(series.where(~blank), errors="coerce")
            bad = ~blank & (conv.isna() | (conv % 1 != 0))
            out[col.name] = conv.astype("Int64")
        elif col.kind == "float":
            text = series.where(~blank).astype("string").str.replace("%", "", regex=False)
            conv = pd.to_numeric(text, errors="coerce")
            bad = ~blank & conv.isna()
            out[col.name] = conv.astype("Float64")
        elif col.kind == "positions":
            vals, bad_idx = [], []
            for idx, v in series.items():
                try:
                    vals.append(_positions(v))
                except ValueError as exc:
                    vals.append(None)
                    bad_idx.append((idx, str(exc)))
            out[col.name] = vals
            for idx, msg in bad_idx[:10]:
                problems.append(f"{col.name} line {idx + 2}: {msg}")
            bad = pd.Series(False, index=series.index)            # reported line by line above
        else:
            out[col.name] = series.where(~blank).astype("string").str.strip()
            bad = pd.Series(False, index=series.index)
        if bad.any():
            lines = (series.index[bad] + 2).tolist()[:10]
            problems.append(f"{col.name}: not a {col.kind} at line(s) {lines}")
    if "selected_slot" in out:
        slots = out["selected_slot"].dropna().str.upper()
        bad_slots = sorted(set(slots) - _SLOTS)
        if bad_slots:
            problems.append(f"selected_slot: unknown slot(s) {bad_slots}")
    if problems:
        raise YahooCsvError(f"{name}.csv: " + "; ".join(problems))
    return out.reset_index(drop=True)


class CsvBackend:
    """Reads Yahoo snapshots saved as CSV in the inbox directory."""

    def __init__(self, inbox_dir: Path | None = None) -> None:
        self.inbox = Path(inbox_dir) if inbox_dir else settings().paths.inbox_dir

    def path(self, name: str) -> Path:
        return self.inbox / f"{name}.csv"

    def available(self) -> dict[str, datetime]:
        """Snapshot name -> file modification time (UTC, whole seconds) for files present."""
        out = {}
        for name in SCHEMAS:
            p = self.path(name)
            if p.exists():
                out[name] = datetime.fromtimestamp(int(p.stat().st_mtime), tz=UTC)
        return out

    def read(self, name: str) -> pd.DataFrame:
        raw = pd.read_csv(self.path(name), dtype=str, keep_default_na=False, skipinitialspace=True)
        df = validate(name, raw)
        df["snapshot_at"] = self.available()[name]
        return df


def _source_keys(df: pd.DataFrame) -> pd.Series:
    """Yahoo player key if given, else a stable key from normalised name + NBA team."""
    team = df["team_abbr"].fillna("").astype(str).str.upper()
    fallback = df["player_name"].map(normalize_name) + "|" + team
    return df["yahoo_player_key"].fillna(fallback).astype(str)


def _resolve(con, df: pd.DataFrame) -> pd.Series:
    rows = pd.DataFrame({"source_key": df["yahoo_player_key"], "raw_name": df["player_name"],
                         "team_abbr": df["team_abbr"]})
    return resolve_and_record(con, SOURCE, rows)


def ingest_inbox(con: duckdb.DuckDBPyConnection, backend: YahooBackend | None = None,
                 cfg: Settings | None = None) -> dict[str, int]:
    """Validate and load every snapshot present. A bad file raises before anything is written."""
    cfg = cfg or settings()
    backend = backend or CsvBackend(cfg.paths.inbox_dir)
    present = backend.available()
    frames = {name: backend.read(name) for name in present}          # validate all first
    now = store.utcnow()
    counts: dict[str, int] = {}
    with store.ingest_run(con, SOURCE, "ingest_inbox") as run:
        league = {k: v for k, v in cfg.model_dump(mode="json").items()
                  if k not in ("paths", "bdl", "x_feed")}
        store.upsert(con, "yahoo_league", pd.DataFrame([{
            "league_id": cfg.league.league_id, "snapshot_at": now, "settings": json.dumps(league),
            "source": "settings_yaml", "fetched_at": now}]))
        for name, df in frames.items():
            df = df.copy()
            if "team_abbr" not in df:
                df["team_abbr"] = None
            if "yahoo_player_key" in df:
                df["yahoo_player_key"] = _source_keys(df)
            df["source"], df["fetched_at"] = SOURCE, now
            if name == "teams":
                bad = df[(df["team_id"] < 1) | (df["team_id"] > cfg.league.teams)]
                if not bad.empty:
                    raise YahooCsvError(f"teams.csv: team_id must be 1..{cfg.league.teams}, "
                                        f"got {bad['team_id'].tolist()}")
                counts[name] = store.upsert(con, "yahoo_teams", df.drop(columns=["team_abbr"]))
            elif name == "roster":
                df["player_id"] = _resolve(con, df)
                counts[name] = store.upsert(con, "yahoo_rosters", df.drop(columns=["team_abbr"]))
            elif name == "players":
                df["player_id"] = _resolve(con, df)
                counts[name] = store.upsert(con, "yahoo_players", df)
            elif name == "matchup":
                counts[name] = store.upsert(con, "yahoo_matchups", df.drop(columns=["team_abbr"]))
            elif name == "draft_results":
                ids = _resolve(con, df)
                picks = pd.DataFrame({
                    "draft_id": f"yahoo-{cfg.league.league_id}-{cfg.season.nba_season}",
                    "pick_no": df["pick_no"], "round": df["round"], "team_id": df["team_id"],
                    "player_id": ids, "player_name": df["player_name"], "is_keeper": False,
                    "entry_source": "yahoo_csv", "picked_at": df["snapshot_at"], "undone": False})
                counts[name] = store.upsert(con, "draft_picks", picks)
        run["rows"] = sum(counts.values())
        run["detail"] = json.dumps(counts)
    return counts

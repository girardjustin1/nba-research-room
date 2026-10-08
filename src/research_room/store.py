"""DuckDB store: connection, schema, idempotent upserts, raw-response cache, Parquet export.

Inputs: pandas DataFrames from ingest modules; settings.paths for file locations.
Outputs: the DuckDB file at settings.paths.db and nightly Parquet copies.
Tables: owns the schema for every table (see `SCHEMA`).

Conventions:
- Every ingested table carries `source` and `fetched_at` (UTC).
- `season` follows BallDontLie: the year a season starts (2025 = 2025-26).
- Upserts are keyed on each table's natural primary key, so re-running an ingest is a no-op
  apart from refreshing changed rows.
- The Streamlit app opens the store read-only; only jobs write.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import duckdb
import pandas as pd

from research_room.config import settings


@dataclass(frozen=True)
class Table:
    columns: tuple[tuple[str, str], ...]
    pk: tuple[str, ...]

    @property
    def names(self) -> list[str]:
        return [c for c, _ in self.columns]


def _t(pk: tuple[str, ...], *cols: str) -> Table:
    parsed = tuple((c.split()[0], " ".join(c.split()[1:])) for c in cols)
    return Table(columns=parsed, pk=pk)


_INGEST = ("source VARCHAR NOT NULL", "fetched_at TIMESTAMPTZ NOT NULL")

SCHEMA: dict[str, Table] = {
    "teams": _t(("team_id",),
        "team_id INTEGER", "abbreviation VARCHAR", "city VARCHAR", "name VARCHAR",
        "full_name VARCHAR", "conference VARCHAR", "division VARCHAR", *_INGEST),
    "players": _t(("player_id",),
        "player_id INTEGER", "first_name VARCHAR", "last_name VARCHAR", "full_name VARCHAR",
        "position VARCHAR", "height VARCHAR", "weight VARCHAR", "jersey_number VARCHAR",
        "team_id INTEGER", "draft_year INTEGER", "country VARCHAR", *_INGEST),
    "games": _t(("game_id",),
        "game_id INTEGER", "season INTEGER", "game_date DATE", "tip_utc TIMESTAMPTZ",
        "status VARCHAR", "status_state VARCHAR", "postseason BOOLEAN", "season_type VARCHAR",
        "ist_stage VARCHAR", "postponed BOOLEAN", "home_team_id INTEGER",
        "visitor_team_id INTEGER", "home_score INTEGER", "visitor_score INTEGER", *_INGEST),
    "game_logs": _t(("game_id", "player_id"),
        "game_id INTEGER", "player_id INTEGER", "team_id INTEGER", "season INTEGER",
        "game_date DATE", "minutes DOUBLE", "did_play BOOLEAN",
        "fgm DOUBLE", "fga DOUBLE", "ftm DOUBLE", "fta DOUBLE", "fg3m DOUBLE", "fg3a DOUBLE",
        "oreb DOUBLE", "dreb DOUBLE", "reb DOUBLE", "ast DOUBLE", "stl DOUBLE", "blk DOUBLE",
        "tov DOUBLE", "pf DOUBLE", "pts DOUBLE", "plus_minus DOUBLE", *_INGEST),
    "advanced_stats": _t(("game_id", "player_id"),
        "game_id INTEGER", "player_id INTEGER", "team_id INTEGER", "season INTEGER",
        "game_date DATE", "usage_pct DOUBLE", "pace DOUBLE", "possessions DOUBLE",
        "off_rating DOUBLE", "def_rating DOUBLE", "net_rating DOUBLE", "ts_pct DOUBLE",
        "efg_pct DOUBLE", "pie DOUBLE", "extra JSON", *_INGEST),
    "injuries": _t(("player_id", "fetched_at"),
        "player_id INTEGER", "status VARCHAR", "description VARCHAR", "return_date VARCHAR",
        *_INGEST),
    "odds": _t(("game_id", "vendor", "market", "side", "is_opening", "ts"),
        "game_id INTEGER", "vendor VARCHAR", "market VARCHAR", "side VARCHAR",
        "is_opening BOOLEAN", "line DOUBLE", "price_american DOUBLE", "prob DOUBLE",
        "ts TIMESTAMPTZ", *_INGEST),
    "props_ladder": _t(("source", "game_id", "player_id", "stat", "threshold", "side", "ts"),
        "game_id INTEGER", "player_id INTEGER", "stat VARCHAR", "threshold DOUBLE",
        "side VARCHAR", "prob DOUBLE", "price DOUBLE", "volume DOUBLE", "vendor VARCHAR",
        "ts TIMESTAMPTZ", "bid DOUBLE", "ask DOUBLE", "open_interest DOUBLE", "market_ref VARCHAR",
        *_INGEST),
    "status_events": _t(("event_id",),
        "event_id VARCHAR", "player_id INTEGER", "team_id INTEGER", "status VARCHAR",
        "minutes_cap DOUBLE", "starting BOOLEAN", "confidence DOUBLE", "account VARCHAR",
        "authority_rank INTEGER", "ts TIMESTAMPTZ", "out_days_min DOUBLE", "out_days_max DOUBLE",
        "game_id INTEGER", "game_date DATE", "game_basis VARCHAR", "first_seen_at TIMESTAMPTZ",
        "limited BOOLEAN", *_INGEST),
    "nba_report_rows": _t(("report_ts", "game_id", "player_id"),
        "report_ts TIMESTAMPTZ", "game_id INTEGER", "team_id INTEGER", "player_id INTEGER",
        "status VARCHAR", "reason VARCHAR", *_INGEST),
    "nba_report_teams": _t(("report_ts", "game_id", "team_id"),
        "report_ts TIMESTAMPTZ", "game_id INTEGER", "team_id INTEGER", "submitted BOOLEAN", *_INGEST),
    "x_feed_log": _t(("poll_at", "query_key"),
        "poll_at TIMESTAMPTZ", "query_key VARCHAR", "day DATE", "posts_read INTEGER",
        "newest_at TIMESTAMPTZ", "events INTEGER"),
    # How far each watched account has been read completely, and the post ids read recently
    # (ids only, never text), so an overlapping read is never parsed twice (round-3 audit X02).
    "x_feed_cursor": _t(("handle",),
        "handle VARCHAR", "read_through TIMESTAMPTZ", "updated_at TIMESTAMPTZ"),
    "x_feed_seen": _t(("post_id",),
        "post_id VARCHAR", "seen_at TIMESTAMPTZ"),
    "yahoo_league": _t(("league_id", "snapshot_at"),
        "league_id INTEGER", "snapshot_at TIMESTAMPTZ", "settings JSON", *_INGEST),
    "yahoo_rosters": _t(("snapshot_at", "team_id", "yahoo_player_key"),
        "snapshot_at TIMESTAMPTZ", "team_id INTEGER", "yahoo_player_key VARCHAR",
        "player_name VARCHAR", "player_id INTEGER", "selected_slot VARCHAR",
        "eligible_positions VARCHAR", "status VARCHAR", *_INGEST),
    "yahoo_players": _t(("snapshot_at", "yahoo_player_key"),
        "snapshot_at TIMESTAMPTZ", "yahoo_player_key VARCHAR", "player_name VARCHAR",
        "team_abbr VARCHAR", "eligible_positions VARCHAR", "pct_rostered DOUBLE",
        "status VARCHAR", "owner_team_id INTEGER", "player_id INTEGER", *_INGEST),
    "yahoo_matchups": _t(("snapshot_at", "week", "team_id"),
        "snapshot_at TIMESTAMPTZ", "week INTEGER", "team_id INTEGER",
        "opponent_team_id INTEGER", "fg_pct DOUBLE", "ft_pct DOUBLE", "fg3m DOUBLE",
        "pts DOUBLE", "reb DOUBLE", "ast DOUBLE", "stl DOUBLE", "blk DOUBLE", "tov DOUBLE",
        "acquisitions_used INTEGER", *_INGEST),
    "draft_picks": _t(("draft_id", "pick_no"),
        "draft_id VARCHAR", "pick_no INTEGER", "round INTEGER", "team_id INTEGER",
        "player_id INTEGER", "player_name VARCHAR", "is_keeper BOOLEAN",
        "entry_source VARCHAR", "picked_at TIMESTAMPTZ", "undone BOOLEAN"),
    "yahoo_teams": _t(("snapshot_at", "team_id"),
        "snapshot_at TIMESTAMPTZ", "team_id INTEGER", "team_name VARCHAR", *_INGEST),
    "draft_teams": _t(("draft_id", "team_id"),
        "draft_id VARCHAR", "team_id INTEGER", "name VARCHAR", "updated_at TIMESTAMPTZ"),
    "projections": _t(("model", "run_at", "player_id", "date", "stat"),
        "model VARCHAR", "run_at TIMESTAMPTZ", "player_id INTEGER", "date DATE",
        "stat VARCHAR", "mean DOUBLE NOT NULL", "sd DOUBLE NOT NULL", "p_play DOUBLE",
        "minutes_mean DOUBLE", "model_mean DOUBLE", "market BOOLEAN", "teammates DOUBLE",
        "news_source VARCHAR", "news_status VARCHAR", "news_carried BOOLEAN"),
    "model_scores": _t(("model", "stat", "window_start", "window_end", "run_at"),
        "model VARCHAR", "stat VARCHAR", "window_start DATE", "window_end DATE",
        "run_at TIMESTAMPTZ", "mae DOUBLE", "rmse DOUBLE", "coverage_80 DOUBLE",
        "n INTEGER", "beats_baseline BOOLEAN"),
    "sim_calibration": _t(("model", "category", "fitted_at"),
        "model VARCHAR", "category VARCHAR", "fitted_at TIMESTAMPTZ", "multiplier DOUBLE",
        "raw_multiplier DOUBLE", "train_seasons VARCHAR", "n_teams INTEGER"),
    "sim_correlation": _t(("model", "cat_a", "cat_b", "fitted_at"),
        "model VARCHAR", "cat_a VARCHAR", "cat_b VARCHAR", "fitted_at TIMESTAMPTZ", "rho DOUBLE"),
    "live_scores": _t(("day", "stat", "segment"),
        "day DATE", "stat VARCHAR", "segment VARCHAR", "n INTEGER", "mae DOUBLE", "rmse DOUBLE",
        "bias DOUBLE", "coverage_80 DOUBLE", "graded_at TIMESTAMPTZ"),
    "live_news_scores": _t(("day", "source", "status"),
        "day DATE", "source VARCHAR", "status VARCHAR", "listed INTEGER", "played INTEGER",
        "graded_at TIMESTAMPTZ"),
    "notifications": _t(("id",),
        "id VARCHAR", "kind VARCHAR", "priority VARCHAR", "created_at TIMESTAMPTZ", "title VARCHAR",
        "body VARCHAR", "player_id INTEGER", "owner VARCHAR", "impact JSON", "action JSON",
        "deadline JSON", "provenance JSON", "run VARCHAR"),
    "matchup_snapshots": _t(("week", "ts"),
        "week INTEGER", "ts TIMESTAMPTZ", "opponent_team_id INTEGER", "p_win_week DOUBLE",
        "expected_cats DOUBLE", "p_cats JSON", "cats_me INTEGER", "cats_opp INTEGER",
        "event_kind VARCHAR", "event_label VARCHAR", "projections_run_at TIMESTAMPTZ"),
    "backtest_results": _t(("run_at", "week_start", "team", "opponent"),
        "run_at TIMESTAMPTZ", "season INTEGER", "week_start DATE", "team INTEGER", "opponent INTEGER",
        "p_dn DOUBLE", "p_plan DOUBLE", "cats_dn INTEGER", "cats_plan INTEGER", "won_dn BOOLEAN",
        "won_plan BOOLEAN", "n_moves INTEGER", "solve_ms DOUBLE", "cats_opp_dn INTEGER",
        "cats_opp_plan INTEGER", "tie_dn BOOLEAN", "tie_plan BOOLEAN", "cats_detail JSON"),
    "decisions_log": _t(("decision_id",),
        "decision_id VARCHAR", "ts TIMESTAMPTZ", "page VARCHAR", "kind VARCHAR",
        "recommendation JSON", "inputs JSON", "model_version VARCHAR"),
    # --- additions beyond the build prompt (see DECISIONS.md) ---
    "external_projections": _t(("source", "snapshot", "ext_id"),
        "source VARCHAR", "snapshot DATE", "ext_id VARCHAR", "player_id INTEGER", "name VARCHAR",
        "team_abbr VARCHAR", "position VARCHAR", "age DOUBLE", "games DOUBLE", "minutes DOUBLE",
        "nba_id INTEGER", "fgm DOUBLE", "fga DOUBLE", "ftm DOUBLE", "fta DOUBLE",
        "fg3m DOUBLE", "fg3a DOUBLE",
        "oreb DOUBLE", "dreb DOUBLE", "reb DOUBLE", "ast DOUBLE", "stl DOUBLE", "blk DOUBLE",
        "tov DOUBLE", "pts DOUBLE", "yahoo_adp DOUBLE", "adv_adp DOUBLE", "ext_rank DOUBLE",
        "injury_risk VARCHAR", "role VARCHAR", "fetched_at TIMESTAMPTZ"),
    "player_xref": _t(("source", "source_key"),
        "source VARCHAR", "source_key VARCHAR", "raw_name VARCHAR", "player_id INTEGER",
        "method VARCHAR", "resolved_at TIMESTAMPTZ"),
    "unresolved_names": _t(("source", "source_key"),
        "source VARCHAR", "source_key VARCHAR", "raw_name VARCHAR", "team_abbr VARCHAR",
        "reason VARCHAR", "candidates VARCHAR", "first_seen TIMESTAMPTZ",
        "last_seen TIMESTAMPTZ"),
    "api_responses": _t(("source", "endpoint", "params_hash"),
        "source VARCHAR", "endpoint VARCHAR", "params_hash VARCHAR", "params JSON",
        "status INTEGER", "body JSON", "fetched_at TIMESTAMPTZ"),
    "ingest_runs": _t(("run_id",),
        "run_id VARCHAR", "source VARCHAR", "job VARCHAR", "started_at TIMESTAMPTZ",
        "finished_at TIMESTAMPTZ", "rows INTEGER", "status VARCHAR", "detail VARCHAR"),
}


def utcnow() -> datetime:
    return datetime.now(UTC)


def connect(path: Path | str | None = None, read_only: bool = False) -> duckdb.DuckDBPyConnection:
    """Open the store. Writers also create the schema; readers never write."""
    db_path = Path(path) if path is not None else settings().paths.db
    if str(db_path) != ":memory:":
        if read_only and not db_path.exists():
            raise FileNotFoundError(f"store not found at {db_path}; run `make backfill` first")
        db_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(db_path), read_only=read_only)
    con.execute("SET TimeZone = 'UTC'")
    if not read_only:
        init_schema(con)
    return con


def init_schema(con: duckdb.DuckDBPyConnection) -> None:
    """Create missing tables and add columns added to SCHEMA since a table was created.
    Safe to call repeatedly. (New columns are nullable; primary keys never change in place.)"""
    for name, table in SCHEMA.items():
        cols = ", ".join(f"{c} {t}" for c, t in table.columns)
        con.execute(f"CREATE TABLE IF NOT EXISTS {name} ({cols}, PRIMARY KEY ({', '.join(table.pk)}))")
        have = {r[0] for r in con.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = ?", [name]).fetchall()}
        for col, typ in table.columns:
            if col not in have:
                con.execute(f"ALTER TABLE {name} ADD COLUMN {col} {typ.replace('NOT NULL', '').strip()}")


def upsert(con: duckdb.DuckDBPyConnection, table: str, df: pd.DataFrame) -> int:
    """Insert or update rows by the table's primary key. Returns the number of rows written.

    Rows sharing a key within `df` are collapsed to the last one. Columns missing from `df`
    are written as NULL; extra columns are an error (they would be silently dropped otherwise).
    """
    if df.empty:
        return 0
    spec = SCHEMA[table]
    extra = set(df.columns) - set(spec.names)
    if extra:
        raise ValueError(f"{table}: unknown columns {sorted(extra)}")
    missing_pk = [k for k in spec.pk if k not in df.columns or df[k].isna().any()]
    if missing_pk:
        raise ValueError(f"{table}: primary key columns missing or null: {missing_pk}")
    frame = df.drop_duplicates(subset=list(spec.pk), keep="last").reindex(columns=spec.names)
    con.register("_upsert_frame", frame)
    try:
        con.execute(f"INSERT OR REPLACE INTO {table} BY NAME SELECT * FROM _upsert_frame")
    finally:
        con.unregister("_upsert_frame")
    return len(frame)


def params_hash(params: dict[str, Any]) -> str:
    """Stable hash of request params (order-independent) for the response cache key."""
    return hashlib.sha256(json.dumps(params, sort_keys=True, default=str).encode()).hexdigest()[:32]


def cache_get(con: duckdb.DuckDBPyConnection, source: str, endpoint: str,
              params: dict[str, Any]) -> dict | None:
    row = con.execute(
        "SELECT body FROM api_responses WHERE source=? AND endpoint=? AND params_hash=? AND status=200",
        [source, endpoint, params_hash(params)],
    ).fetchone()
    return json.loads(row[0]) if row else None


def cache_put(con: duckdb.DuckDBPyConnection, source: str, endpoint: str,
              params: dict[str, Any], status: int, body: dict) -> None:
    upsert(con, "api_responses", pd.DataFrame([{
        "source": source, "endpoint": endpoint, "params_hash": params_hash(params),
        "params": json.dumps(params, sort_keys=True, default=str), "status": status,
        "body": json.dumps(body), "fetched_at": utcnow(),
    }]))


@contextmanager
def ingest_run(con: duckdb.DuckDBPyConnection, source: str, job: str) -> Iterator[dict]:
    """Record a job in `ingest_runs`. Yields a dict; set `rows`/`detail` on it as you go."""
    run = {"run_id": uuid.uuid4().hex, "source": source, "job": job, "started_at": utcnow(),
           "rows": 0, "status": "running", "detail": None}
    upsert(con, "ingest_runs", pd.DataFrame([{**run, "finished_at": None}]))
    try:
        yield run
        run["status"] = "ok"
    except BaseException as exc:
        run["status"] = "error"
        run["detail"] = f"{type(exc).__name__}: {exc}"[:2000]
        raise
    finally:
        upsert(con, "ingest_runs", pd.DataFrame([{**run, "finished_at": utcnow()}]))


def has_table(con: duckdb.DuckDBPyConnection, name: str) -> bool:
    """False for a table added to SCHEMA since a read-only connection's file was last written."""
    return bool(con.execute("SELECT count(*) FROM information_schema.tables WHERE table_name = ?",
                            [name]).fetchone()[0])


def table_counts(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Row count per table, for the Data page and health checks."""
    have = {r[0] for r in con.execute("SELECT table_name FROM information_schema.tables").fetchall()}
    # A read-only connection doesn't create tables added since the last write; count those as empty.
    rows = [(t, con.execute(f"SELECT count(*) FROM {t}").fetchone()[0] if t in have else 0) for t in SCHEMA]
    return pd.DataFrame(rows, columns=["table", "rows"])


def export_parquet(con: duckdb.DuckDBPyConnection, out_dir: Path | None = None,
                   skip: tuple[str, ...] = ("api_responses",)) -> list[Path]:
    """Write one Parquet file per table (the raw response cache is skipped by default)."""
    target = Path(out_dir) if out_dir else settings().paths.parquet_dir
    target.mkdir(parents=True, exist_ok=True)
    written = []
    for name in SCHEMA:
        if name in skip:
            continue
        path = target / f"{name}.parquet"
        con.execute(f"COPY {name} TO '{path}' (FORMAT parquet)")
        written.append(path)
    return written

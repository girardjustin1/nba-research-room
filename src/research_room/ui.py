"""Shared Streamlit helpers (imported by app/ pages): read-only store access with caching.

Inputs: the DuckDB store (read-only). Outputs: cached DataFrames. Tables: reads only.
The app never calls an external API; it shows whatever the jobs last wrote.
"""

from __future__ import annotations

import duckdb
import pandas as pd
import streamlit as st

from research_room import store
from research_room.config import settings


def _db_version() -> float:
    """Cache key: the store file's mtime, so pages refresh after a job writes."""
    path = settings().paths.db
    return path.stat().st_mtime if path.exists() else 0.0


@st.cache_data(show_spinner=False)
def query(sql: str, params: tuple = (), _version: float = 0.0) -> pd.DataFrame:
    con = store.connect(read_only=True)
    try:
        return con.execute(sql, list(params)).df()
    finally:
        con.close()


def q(sql: str, *params) -> pd.DataFrame:
    return query(sql, tuple(params), _version=_db_version())


def store_ready() -> bool:
    """Render a readable message and return False if the store cannot be opened."""
    path = settings().paths.db
    if not path.exists():
        st.warning(f"No store yet at `{path}`. Run `make backfill` first.")
        return False
    try:
        q("SELECT 1")
    except duckdb.IOException:
        st.info("A job is writing to the store right now (DuckDB allows one writer). "
                "Refresh when it finishes.")
        return False
    return True

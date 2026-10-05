"""Player availability per date: injuries + X status events + manual overrides -> play_prob and
minutes_cap, with the source that decided it.

Inputs: `injuries` snapshots (BallDontLie), the NBA's official injury report (nba_report_rows /
nba_report_teams), `status_events` (X feed, Phase 3), config/overrides.yaml,
settings.overrides (status -> P(plays), how long a status lasts without a return date, authority).
Outputs: DataFrame [player_id, date, play_prob, minutes_cap, status, authority, source, ts, note],
one row per player-date that any source speaks to. Players with no row are unaffected (the
baseline's own play rate applies). `ts` is when the news was known: the post time for X, the first
snapshot listing the current status for the injury report.
Tables: reads injuries, nba_report_rows, nba_report_teams, status_events, players.

Not listed: for a team that has filed today's NBA report, each of its players who isn't on it gets
a row with status NOT_LISTED and no play_prob. It outranks BallDontLie's list (a stale "out" for a
player the league no longer lists), and fill_unlisted() turns it into P(plays) from his recent
play rate (settings.overrides.unlisted) once the projection rows are known.

Precedence, per player-date: same-day news first. A row `carried` from an earlier day (an X
post's stated absence on the days after it, BallDontLie's daily list) yields to any same-day row
(an X post that day, the NBA report, a manual entry). Then the most authoritative source (manual
> official > insider > nba_report > beat > aggregator > bdl), then the most recent report.
Injury snapshots are read as of a time, so the backtest can rebuild what was known before any tip
(no leakage).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
import yaml

from research_room import store
from research_room.config import CONFIG_DIR, Settings, settings
from research_room.ingest.names import normalize_name

COLUMNS = ["player_id", "date", "play_prob", "minutes_cap", "status", "authority", "source", "ts", "note",
           "carried"]
NOT_LISTED = "Not Listed"


def _dates(start: date, end: date) -> list[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def _prob(status: str | None, cfg: Settings) -> float | None:
    if status is None:
        return None
    table = {k.lower(): v for k, v in cfg.overrides.status_play_prob.items()}
    return table.get(str(status).strip().lower())


def from_injuries(con: duckdb.DuckDBPyConnection, start: date, end: date, as_of: datetime,
                  cfg: Settings) -> pd.DataFrame:
    """Latest BallDontLie injury snapshot at or before `as_of`, expanded to the dates it covers."""
    snap = con.execute("""
        SELECT player_id, status, description, return_date, fetched_at FROM injuries
        WHERE fetched_at = (SELECT max(fetched_at) FROM injuries WHERE fetched_at <= ?)
    """, [as_of]).df()
    days_for = {k.lower(): v for k, v in cfg.overrides.no_return_date_days.items()}
    since = _status_since(con, as_of)
    rows = []
    for r in snap.itertuples(index=False):
        p = _prob(r.status, cfg)
        if p is None:
            continue
        reported = pd.Timestamp(r.fetched_at).tz_convert("America/New_York").date()
        status = str(r.status)
        if status.lower() == "out for season":
            until = end
        elif pd.notna(r.return_date) and str(r.return_date).strip():
            until = pd.Timestamp(r.return_date).date() - timedelta(days=1)   # back on the return date
        else:
            until = reported + timedelta(days=days_for.get(status.lower(), 1) - 1)
        for d in _dates(max(start, reported), min(end, until)):
            rows.append({"player_id": int(r.player_id), "date": d, "play_prob": p, "minutes_cap": None,
                         "status": status, "authority": "bdl", "source": "BallDontLie injuries",
                         "ts": since.get(int(r.player_id), r.fetched_at),
                         "note": (r.description or "")[:200], "carried": True})
    return pd.DataFrame(rows, columns=COLUMNS)


def _status_since(con: duckdb.DuckDBPyConnection, as_of: datetime) -> dict[int, pd.Timestamp]:
    """When each player's current injury status was first reported: the first snapshot of the
    unbroken run ending at the latest one. This is the news time (every snapshot re-lists him, so
    the snapshot's own time would make an old status look new)."""
    df = con.execute("""
        WITH snaps AS (SELECT DISTINCT fetched_at AS f FROM injuries WHERE fetched_at <= ?),
        cur AS (SELECT player_id, status FROM injuries WHERE fetched_at = (SELECT max(f) FROM snaps)),
        breaks AS (
            SELECT c.player_id, max(s.f) AS last_break
            FROM cur c CROSS JOIN snaps s
            LEFT JOIN injuries i ON i.player_id = c.player_id AND i.fetched_at = s.f
            WHERE i.status IS DISTINCT FROM c.status
            GROUP BY 1)
        SELECT c.player_id, min(s.f) AS since
        FROM cur c LEFT JOIN breaks b USING (player_id)
        JOIN snaps s ON b.last_break IS NULL OR s.f > b.last_break
        GROUP BY 1
    """, [as_of]).df()
    return dict(zip(df["player_id"].astype(int), df["since"], strict=True))


def from_status_events(con: duckdb.DuckDBPyConnection, start: date, end: date, as_of: datetime,
                       cfg: Settings) -> pd.DataFrame:
    """Parsed X posts (Phase 3). An event speaks to its own game date, except an absence with a
    stated time frame: out (P(plays) 0) through the fewest days, then P(plays) rising in equal
    steps to the most days, then no row (the model's own rate). Out For Season runs to `end`.
    Rows after the post's date are `carried`: same-day news on those dates outranks them."""
    have = {r[0] for r in con.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'status_events'").fetchall()}
    days = ", ".join(c if c in have else f"NULL AS {c}" for c in ("out_days_min", "out_days_max"))
    ev = con.execute(f"""
        SELECT player_id, status, minutes_cap, account, ts, {days},
               CASE authority_rank WHEN 1 THEN 'official' WHEN 2 THEN 'insider' WHEN 3 THEN 'beat'
                    ELSE 'aggregator' END AS authority
        FROM status_events WHERE ts <= ? AND player_id IS NOT NULL
    """, [as_of]).df()
    cap = cfg.overrides.max_carry_days
    rows = []
    for r in ev.itertuples(index=False):
        d0 = pd.Timestamp(r.ts).tz_convert("America/New_York").date()
        status = str(r.status)
        lo = float(r.out_days_min) if pd.notna(r.out_days_min) else None
        hi = float(r.out_days_max) if pd.notna(r.out_days_max) else lo
        if status.lower() == "out for season":
            plan = [(d0 + timedelta(days=k), 0.0) for k in range((end - d0).days + 1)]
        elif status.lower() == "out" and lo:
            lo_d, hi_d = int(min(lo, cap)), int(min(max(hi or lo, lo), cap))
            plan = [(d0 + timedelta(days=k), 0.0) for k in range(lo_d)]
            plan += [(d0 + timedelta(days=k), (k - lo_d + 1) / (hi_d - lo_d + 2))
                     for k in range(lo_d, hi_d + 1)] if hi_d > lo_d else []
            plan = plan or [(d0, 0.0)]
        else:
            plan = [(d0, _prob(status, cfg))]
        span = f"out {lo:.0f}" + (f"-{hi:.0f}" if hi and hi > lo else "+") + " days" if lo else None
        for d, p in plan:
            if start <= d <= end:
                rows.append({"player_id": int(r.player_id), "date": d, "play_prob": p,
                             "minutes_cap": r.minutes_cap if d == d0 else None, "status": status,
                             "authority": r.authority, "source": f"X @{r.account}", "ts": r.ts,
                             "note": span, "carried": d > d0})
    return pd.DataFrame(rows, columns=COLUMNS)


def from_nba_report(con: duckdb.DuckDBPyConnection, start: date, end: date, as_of: datetime,
                    cfg: Settings) -> pd.DataFrame:
    """The latest NBA injury report at or before `as_of`: listed players with their status (news
    time = the first report listing that status for that game), and NOT_LISTED rows for every
    other player of each team that has filed."""
    from research_room.ingest.nba_injury_report import latest_report_ts

    ts = latest_report_ts(con, as_of)
    if ts is None:
        return pd.DataFrame(columns=COLUMNS)
    listed = con.execute("""
        WITH cur AS (
            SELECT r.game_id, r.team_id, r.player_id, r.status, r.reason, g.game_date
            FROM nba_report_rows r JOIN games g USING (game_id)
            WHERE r.report_ts = ? AND g.game_date BETWEEN ? AND ?)
        SELECT c.*, (SELECT min(h.report_ts) FROM nba_report_rows h
                     WHERE h.game_id = c.game_id AND h.player_id = c.player_id AND h.status = c.status
                       AND h.report_ts <= ?
                       AND h.report_ts > coalesce((SELECT max(x.report_ts) FROM nba_report_rows x
                                                   WHERE x.game_id = c.game_id AND x.player_id = c.player_id
                                                     AND x.status <> c.status AND x.report_ts <= ?),
                                                  '-infinity'::TIMESTAMPTZ)) AS since
        FROM cur c
    """, [ts, start, end, ts, ts]).df()
    rows = [{"player_id": int(r.player_id), "date": pd.Timestamp(r.game_date).date(),
             "play_prob": _prob(r.status, cfg), "minutes_cap": None, "status": r.status,
             "authority": "nba_report", "source": "NBA injury report",
             "ts": r.since if pd.notna(r.since) else ts, "note": (r.reason or "")[:200] or None,
             "carried": False}
            for r in listed.itertuples(index=False)]
    filed = con.execute("""
        SELECT t.team_id, g.game_date, p.player_id
        FROM nba_report_teams t JOIN games g USING (game_id) JOIN players p ON p.team_id = t.team_id
        WHERE t.report_ts = ? AND t.submitted AND g.game_date BETWEEN ? AND ?
    """, [ts, start, end]).df()
    on_report = {(int(r.player_id), pd.Timestamp(r.game_date).date()) for r in listed.itertuples(index=False)}
    for r in filed.itertuples(index=False):
        d = pd.Timestamp(r.game_date).date()
        if (int(r.player_id), d) not in on_report:
            rows.append({"player_id": int(r.player_id), "date": d, "play_prob": None, "minutes_cap": None,
                         "status": NOT_LISTED, "authority": "nba_report", "source": "NBA injury report",
                         "ts": ts, "note": None, "carried": False})
    return pd.DataFrame(rows, columns=COLUMNS)


def fill_unlisted(df: pd.DataFrame, cfg: Settings) -> pd.Series:
    """P(plays) for NOT_LISTED rows of projection rows `df` (status_override, play_rate_ewma,
    min_played_ewma): a rotation player by his recent play rate (settings.overrides.unlisted);
    anyone else keeps the model's own P(plays) (NaN)."""
    u = cfg.overrides.unlisted
    out = pd.Series(np.nan, index=df.index)
    if "status_override" not in df or not u.probs:
        return out
    rate = pd.to_numeric(df["play_rate_ewma"], errors="coerce")
    rot = pd.to_numeric(df["min_played_ewma"], errors="coerce") >= cfg.baseline.teammates.rotation_minutes
    hit = (df["status_override"] == NOT_LISTED) & rot & rate.notna()
    idx = np.searchsorted(np.asarray(u.play_rate_bins, dtype=float), rate[hit].to_numpy(float), side="left")
    out[hit] = np.asarray(u.probs, dtype=float)[idx]
    return out


def from_manual(con: duckdb.DuckDBPyConnection, start: date, end: date, cfg: Settings,
                path: Path | None = None) -> pd.DataFrame:
    """config/overrides.yaml entries (player_id, or a name resolved exactly against players)."""
    raw = yaml.safe_load((path or CONFIG_DIR / "overrides.yaml").read_text()) or {}
    entries = raw.get("overrides") or []
    if not entries:
        return pd.DataFrame(columns=COLUMNS)
    names = con.execute("SELECT player_id, full_name FROM players").df()
    by_name = names.assign(key=names["full_name"].map(normalize_name)).groupby("key")["player_id"].apply(list)
    rows = []
    for e in entries:
        pid = e.get("player_id")
        if pid is None:
            match = by_name.get(normalize_name(e.get("player", "")), [])
            if len(match) != 1:
                raise ValueError(f"overrides.yaml: '{e.get('player')}' matches {len(match)} players; "
                                 "add player_id")
            pid = match[0]
        lo = pd.Timestamp(e.get("from") or start).date()
        hi = pd.Timestamp(e.get("until") or end).date()
        p = e.get("play_prob", _prob(e.get("status"), cfg))
        for d in _dates(max(start, lo), min(end, hi)):
            rows.append({"player_id": int(pid), "date": d, "play_prob": p,
                         "minutes_cap": e.get("minutes_cap"), "status": e.get("status"),
                         "authority": "manual", "source": "overrides.yaml", "ts": store.utcnow(),
                         "note": e.get("note"), "carried": False})
    return pd.DataFrame(rows, columns=COLUMNS)


def _drop_overtaken(rows: pd.DataFrame) -> pd.DataFrame:
    """A carried forecast ends once newer same-day news says he's likely to play (not listed, or
    P(plays) >= 0.5): its rows from that date on are dropped. A newer "out" keeps it."""
    carried = rows[rows["carried"]]
    p = pd.to_numeric(rows["play_prob"], errors="coerce")
    fresh = rows[~rows["carried"] & ((rows["status"] == NOT_LISTED) | (p >= 0.5))]
    if carried.empty or fresh.empty:
        return rows
    pair = carried[["player_id", "date", "_ts"]].reset_index().merge(
        fresh[["player_id", "date", "_ts"]], on="player_id", suffixes=("", "_news"))
    gone = pair[(pair["date_news"] <= pair["date"]) & (pair["_ts_news"] > pair["_ts"])]["index"].unique()
    return rows.drop(index=gone)


def resolve(con: duckdb.DuckDBPyConnection, start: date, end: date, as_of: datetime | None = None,
            cfg: Settings | None = None, manual_path: Path | None = None) -> pd.DataFrame:
    """One row per player-date: the winning source's play_prob and minutes_cap."""
    cfg = cfg or settings()
    as_of = as_of or store.utcnow()
    parts = [f for f in (from_injuries(con, start, end, as_of, cfg),
                         from_nba_report(con, start, end, as_of, cfg),
                         from_status_events(con, start, end, as_of, cfg),
                         from_manual(con, start, end, cfg, manual_path)) if not f.empty]
    if not parts:
        return pd.DataFrame(columns=COLUMNS)
    allrows = pd.concat(parts, ignore_index=True)
    rank = {a: i for i, a in enumerate(cfg.overrides.authority)}
    allrows["_rank"] = allrows["authority"].map(rank).fillna(len(rank))
    allrows["_ts"] = pd.to_datetime(allrows["ts"], utc=True)
    # Same-day news first (a forecast carried from an earlier day, or BallDontLie's daily list,
    # yields to it), then authority, then the most recent.
    allrows["carried"] = allrows["carried"].fillna(False).astype(bool)
    allrows = _drop_overtaken(allrows)
    best = allrows.sort_values(["player_id", "date", "carried", "_rank", "_ts"],
                               ascending=[True, True, True, True, False])
    return best.drop_duplicates(["player_id", "date"]).drop(columns=["_rank", "_ts"]).reset_index(drop=True)

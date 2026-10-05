"""The nightly pipeline, as testable steps: ingest -> features -> projections -> lineup.

Inputs: BallDontLie (sync_daily), the Yahoo CSV inbox, the preseason pool, overrides, settings.
Outputs: refreshed store tables, `projections` (baseline, mean + sd) through the end of next
fantasy week, today's recommended lineup for my team logged to `decisions_log`, Parquet export.
Tables: writes games, game_logs, advanced_stats, injuries, odds, players, yahoo_*, features,
projections, decisions_log, ingest_runs.

Every step is idempotent and records itself in `ingest_runs`. A step with nothing to do (no
Yahoo roster yet, no games today) says so in the run detail instead of failing the night.
"""

from __future__ import annotations

import json
import time
import uuid
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import duckdb
import pandas as pd

from research_room import calibration, features, lineup, matchup, overrides, schedule, scoreboard, store
from research_room.config import Settings, settings
from research_room.ingest import bdl, kalshi, rundown, yahoo
from research_room.ingest.external_proj import ProjectionFileError, blend_preseason
from research_room.projections.baseline import BaselineModel, project_window, write_projections

ET = ZoneInfo("America/New_York")


def today_et(now: datetime | None = None) -> date:
    return (now or datetime.now(ET)).astimezone(ET).date()


def projection_window(day: date, cfg: Settings) -> tuple[date, date]:
    """Today through the end of next fantasy week (enough for the weekly optimizer)."""
    weeks = schedule.fantasy_weeks(cfg.season)
    after = weeks[weeks["end"] >= day]
    end = after.iloc[min(1, len(after) - 1)]["end"] if not after.empty else day + timedelta(days=13)
    return day, end


def my_roster(con: duckdb.DuckDBPyConnection, cfg: Settings) -> pd.DataFrame:
    """My latest Yahoo roster snapshot with eligibility as lists (empty when none exists yet)."""
    df = con.execute("""
        SELECT player_id, player_name AS name, eligible_positions, status, selected_slot AS current_slot
        FROM yahoo_rosters
        WHERE team_id = ? AND snapshot_at = (SELECT max(snapshot_at) FROM yahoo_rosters WHERE team_id = ?)
    """, [cfg.league.my_team_id, cfg.league.my_team_id]).df()
    df["eligible"] = df["eligible_positions"].fillna("").map(lambda s: [p for p in s.split(",") if p])
    return df


def recommend_lineup(con: duckdb.DuckDBPyConnection, proj: pd.DataFrame, day: date,
                     cfg: Settings) -> dict:
    """Today's lineup for my team from the baseline projections; logged to decisions_log."""
    roster = my_roster(con, cfg)
    if roster.empty:
        return {"status": "skipped", "reason": "no Yahoo roster snapshot yet (make inbox)"}
    unmatched = roster["player_id"].isna().sum()
    roster = roster.dropna(subset=["player_id"]).assign(player_id=lambda d: d["player_id"].astype(int))
    pool_day = lineup.wide_day(proj, day)
    if pool_day.empty:
        return {"status": "skipped", "reason": f"no NBA games projected on {day}"}
    rotation = pool_day[pool_day.get("minutes", 0) >= cfg.features.rotation_minutes]
    weights = lineup.category_weights(rotation if len(rotation) > 20 else pool_day, cfg)
    pct = lineup.league_pct(pool_day, cfg)
    mine = pool_day.reindex(roster["player_id"]).fillna(0.0)
    values = lineup.player_value(mine, weights, pct, cfg)
    has_game = pd.Series(roster["player_id"].isin(pool_day.index).to_numpy(), index=roster["player_id"])
    result = lineup.assign_day(roster, values, has_game, cfg=cfg)
    payload = {"status": result.status, "day": str(day), "starters": result.starters,
               "bench": result.bench, "il": result.il, "value": result.value,
               "changes": result.changes, "reason": result.reason,
               "unmatched_roster_players": int(unmatched)}
    store.upsert(con, "decisions_log", pd.DataFrame([{
        "decision_id": uuid.uuid4().hex, "ts": store.utcnow(), "page": "nightly", "kind": "lineup",
        "recommendation": json.dumps(payload, default=str),
        "inputs": json.dumps({"model": "baseline", "weights": weights, "day": str(day)}),
        "model_version": "baseline-v1"}]))
    return payload


def driver_model(cfg: Settings) -> BaselineModel:
    """The model that writes the nightly projections (settings.models.driver). A challenger is
    switched on only after it beats the baseline on the scoreboard and the backtest."""
    if cfg.models.driver == "lgbm":
        from research_room.projections.lgbm import LgbmModel  # heavy import, only when chosen
        return LgbmModel(cfg)
    return BaselineModel(cfg)


def sync_markets(con: duckdb.DuckDBPyConnection, cfg: Settings, day: date | None = None) -> dict:
    """Archive Kalshi and TheRundown lines. A market outage is recorded in ingest_runs (the Jobs
    health check shows it) and never stops the nightly run: markets are an input, not the core."""
    out = {}
    jobs = (("kalshi", lambda: kalshi.sync(con, cfg)), ("rundown", lambda: rundown.sync(con, cfg, today=day)))
    for name, fn in jobs:
        try:
            with store.ingest_run(con, name, "sync_markets") as run:
                counts = fn()
                run["rows"], run["detail"] = int(sum(counts.values())), json.dumps(counts)
            out[name] = counts
        except Exception as exc:  # noqa: BLE001 - recorded above; the night goes on
            out[name] = {"error": f"{type(exc).__name__}: {exc}"[:300]}
    return out


def _snapshot(con, cfg: Settings) -> dict:
    """This week's P(win) for the chart history; skipped (with the reason) before the season."""
    try:
        return matchup.snapshot(con, cfg)
    except matchup.NoMatchup as exc:
        return {"status": "skipped", "reason": str(exc)}


def run_nightly(con: duckdb.DuckDBPyConnection, cfg: Settings | None = None, day: date | None = None,
                client: bdl.BdlClient | None = None, sync: bool = True,
                echo=print) -> dict:
    """The whole night. `sync=False` skips the BallDontLie pull (offline / tests)."""
    cfg = cfg or settings()
    day = day or today_et()
    timings, report = {}, {"day": str(day)}

    def step(name, fn):
        t0 = time.perf_counter()
        out = fn()
        timings[name] = round(time.perf_counter() - t0, 2)
        echo(f"{name}: {out if not isinstance(out, pd.DataFrame) else f'{len(out)} rows'} ({timings[name]}s)")
        return out

    with store.ingest_run(con, "pipeline", "nightly") as run:
        if sync:
            api = client or bdl.BdlClient.from_env()
            report["bdl"] = step("bdl sync", lambda: bdl.sync_daily(con, api, day))
            report["markets"] = step("markets", lambda: sync_markets(con, cfg, day))
        try:
            report["inbox"] = step("yahoo inbox", lambda: yahoo.ingest_inbox(con))
        except yahoo.YahooCsvError as exc:
            report["inbox"] = {"rejected": str(exc)}
            echo(f"yahoo inbox REJECTED: {exc}")
        seasons = sorted(cfg.bdl.backfill_seasons)
        train = step("features (train)", lambda: features.build(
            features.load_logs(con, seasons), features.team_context(con, seasons), cfg))
        model = driver_model(cfg).fit(train).fit_minutes(train, schedule.season_schedule(con), seasons)
        start, end = projection_window(day, cfg)
        ov = step("overrides", lambda: overrides.resolve(con, start, end, cfg=cfg))
        try:
            prior = blend_preseason(con, cfg)
        except ProjectionFileError:
            prior = None
        proj = step("projections", lambda: project_window(con, start, end, cfg, overrides=ov,
                                                         prior=prior, model=model))
        report["projections"] = step("store projections",
                                     lambda: write_projections(con, proj, model.name))
        report["lineup"] = step("lineup", lambda: recommend_lineup(con, proj, day, cfg))
        if len(seasons) > 1:                                   # needs an earlier season to fit on
            report["scoreboard"] = step("scoreboard", lambda: scoreboard.write_scores(
                con, scoreboard.score_baseline(con, cfg)))
            report["calibration"] = step("calibration", lambda: calibration.write(
                con, calibration.run(con, cfg)))
        report["matchup"] = step("matchup snapshot", lambda: _snapshot(con, cfg))
        report["parquet"] = step("parquet", lambda: len(store.export_parquet(con)))
        report["timings_s"] = timings
        run["rows"] = int(report["projections"])
        run["detail"] = json.dumps({k: v for k, v in report.items() if k != "lineup"}, default=str)[:2000]
    return report

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

from research_room import (
    alerts,
    calibration,
    features,
    lineup,
    live_scores,
    matchup,
    overrides,
    schedule,
    scoreboard,
    scorecard,
    shadow,
    store,
)
from research_room.config import Settings, settings
from research_room.ingest import bdl, kalshi, nba_injury_report, rundown, x_feed, yahoo, yahoo_live
from research_room.ingest.external_proj import ProjectionFileError, blend_preseason
from research_room.projections import market
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


def refresh_projections(con: duckdb.DuckDBPyConnection, cfg: Settings, day: date, step,
                        report: dict, refit_shadow: bool = False) -> pd.DataFrame:
    """Fit the driver model, project the window with today's overrides and the market overlay,
    and store it (one projections run). Shared by the nightly and pre-game runs. Then the shadow
    models (shadow.py) project the same window with the same inputs, stored at the same run time;
    only the nightly run (`refit_shadow`) may fit one."""
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
    proj = step("projections", lambda: project_window(con, start, end, cfg, overrides=ov, prior=prior,
                                                     model=model))
    # Where a liquid prop ladder exists (archived first), the market sets that game's points /
    # rebounds / assists if he plays (projections/market.py; tested in DECISIONS.md), unless every
    # price predates news limiting him.
    proj = market.overlay(con, proj, cfg, news=ov)
    report["market_overlay"] = int(proj["market"].sum())
    report["market_stale"] = int(proj["market_stale"].sum())
    run_at = store.utcnow()
    report["projections"] = step("store projections",
                                 lambda: write_projections(con, proj, model.name, run_at=run_at))
    if cfg.models.shadow:
        report["shadow"] = step("shadow models", lambda: shadow.project(
            con, cfg, train, seasons, start, end, ov, prior, run_at, refit_shadow))
    return proj


def run_pregame(con: duckdb.DuckDBPyConnection, cfg: Settings | None = None, now: datetime | None = None,
                client: bdl.BdlClient | None = None, echo=print) -> dict:
    """Pre-game refresh (game days, every few minutes before tip): X news, the NBA injury report,
    BallDontLie injuries, markets, then today's projections and a matchup snapshot. Each feed
    failing is recorded and the rest goes on."""
    cfg = cfg or settings()
    now = now or datetime.now(ET)
    day = now.astimezone(ET).date()
    timings, report = {}, {"day": str(day)}

    def step(name, fn):
        t0 = time.perf_counter()
        out = fn()
        timings[name] = round(time.perf_counter() - t0, 2)
        echo(f"{name}: {out if not isinstance(out, pd.DataFrame) else f'{len(out)} rows'} ({timings[name]}s)")
        return out

    def guarded(name, source, fn):
        try:
            with store.ingest_run(con, source, "pregame") as run:
                out = fn()
                run["detail"] = json.dumps(out, default=str)[:2000]
            return out
        except Exception as exc:  # noqa: BLE001 - recorded in ingest_runs; the refresh goes on
            return {"error": f"{type(exc).__name__}: {exc}"[:300]}

    with store.ingest_run(con, "pipeline", "pregame") as run:
        # My team, this week's opponent and the matchup, live for this run only (never stored).
        report["yahoo"] = step("yahoo", lambda: guarded("yahoo", "yahoo",
                                                         lambda: _yahoo(con, cfg, yahoo_live.PAGE)))
        report["x_feed"] = step("x feed", lambda: guarded("x feed", "x", lambda: x_feed.poll(con, cfg)))
        report["nba_report"] = step("nba injury report", lambda: guarded(
            "nba injury report", "nba_report", lambda: nba_injury_report.sync(con, cfg)))
        api = client or bdl.BdlClient.from_env()
        report["injuries"] = step("injuries",
                                   lambda: guarded("injuries", "bdl", lambda: bdl.sync_injuries(con, api)))
        report["markets"] = step("markets", lambda: sync_markets(con, cfg, day))
        refresh_projections(con, cfg, day, step, report)
        report["matchup"] = step("matchup snapshot",
                                 lambda: _snapshot(con, cfg, event=("news", "Pre-game refresh")))
        report["alerts"] = step("alerts", lambda: guarded(
            "alerts", "alerts", lambda: alerts.generate(con, cfg, None, "pregame", since=now)))
        report["timings_s"] = timings
        run["rows"] = int(report.get("projections") or 0)
        run["detail"] = json.dumps(report, default=str)[:2000]
    return report


def _yahoo(con: duckdb.DuckDBPyConnection, cfg: Settings, parts=None) -> dict:
    """Yahoo, live for this run only: the API once signed in (read only), else the CSV inbox, into
    this connection's in-memory tables. Nothing Yahoo is stored."""
    return yahoo_live.attach(con, cfg, parts)


def _soft(fn) -> dict:
    """A step that records its own run: its failure is reported, never stops the night."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        return {"error": f"{type(exc).__name__}: {exc}"[:300]}


def _guarded(con: duckdb.DuckDBPyConnection, source: str, fn) -> dict:
    """Run one nightly step, recorded in ingest_runs; a failure never stops the run."""
    try:
        with store.ingest_run(con, source, "nightly") as run:
            out = fn()
            run["detail"] = json.dumps(out, default=str)[:2000]
        return out
    except Exception as exc:  # noqa: BLE001 - recorded above; the night goes on
        return {"error": f"{type(exc).__name__}: {exc}"[:300]}


def _guarded_report(con: duckdb.DuckDBPyConnection, cfg: Settings) -> dict:
    """The NBA injury report; an outage never stops the run."""
    return _guarded(con, "nba_report", lambda: nba_injury_report.sync(con, cfg))


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


def _snapshot(con, cfg: Settings, event: tuple[str, str] = ("nightly", "Nightly run")) -> dict:
    """This week's P(win) for the chart history; skipped (with the reason) before the season."""
    try:
        return matchup.snapshot(con, cfg, event=event)
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
        # Yahoo first, live into this run's memory only (never stored).
        try:
            report["inbox"] = step("yahoo", lambda: _yahoo(con, cfg))
        except yahoo.YahooCsvError as exc:
            report["inbox"] = {"rejected": str(exc)}
            echo(f"yahoo inbox REJECTED: {exc}")
        if sync:
            api = client or bdl.BdlClient.from_env()
            # An outage leaves yesterday's data: projections still run (recorded in ingest_runs).
            report["bdl"] = step("bdl sync", lambda: _soft(lambda: bdl.sync_daily(con, api, day)))
            report["nba_report"] = step("nba injury report", lambda: _guarded_report(con, cfg))
            # Late-evening news about tomorrow's games, read tonight (round-3 audit X03).
            report["x_feed"] = step("x feed", lambda: _guarded(con, "x", lambda: x_feed.poll(con, cfg)))
            report["live_scores"] = step("live scoreboard", lambda: _guarded(
                con, "live_scores", lambda: live_scores.update(con, cfg, day - timedelta(days=1))))
            report["week_outcomes"] = step("week outcomes", lambda: _guarded(
                con, "week_outcomes",
                lambda: live_scores.record_week_outcomes(con, cfg, yahoo_live.final_matchup(cfg))))
            report["scorecard"] = step("scorecard", lambda: _guarded(
                con, "scorecard", lambda: scorecard.run(con, cfg)))
            report["markets"] = step("markets", lambda: sync_markets(con, cfg, day))
        seasons = sorted(cfg.bdl.backfill_seasons)
        proj = refresh_projections(con, cfg, day, step, report, refit_shadow=True)
        report["lineup"] = step("lineup", lambda: recommend_lineup(con, proj, day, cfg))
        if len(seasons) > 1:                                   # needs an earlier season to fit on
            report["scoreboard"] = step("scoreboard", lambda: scoreboard.write_scores(
                con, scoreboard.score_baseline(con, cfg)))
            report["calibration"] = step("calibration", lambda: calibration.write(
                con, calibration.run(con, cfg)))
        report["matchup"] = step("matchup snapshot", lambda: _snapshot(con, cfg))
        report["alerts"] = step("alerts", lambda: _guarded(
            con, "alerts", lambda: alerts.generate(con, cfg, None, "nightly", report)))
        report["parquet"] = step("parquet", lambda: len(store.export_parquet(con)))
        report["timings_s"] = timings
        run["rows"] = int(report["projections"])
        run["detail"] = json.dumps({k: v for k, v in report.items() if k != "lineup"}, default=str)[:2000]
    return report

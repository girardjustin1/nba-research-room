"""System diagnostics for the app's System screens: health checks, model scoreboard, notes.

Inputs: the store (ingest_runs, injuries, odds, projections, yahoo_rosters, external_projections,
unresolved_names, model_scores, ...), the local image cache, config/x_accounts.yaml,
docs/engine-notes.yaml (updates written by Claude), settings.system.
Outputs: dicts for GET /system/health, /system/models, /system/notes.
Tables: reads only.

Each check says what is wrong in plain words and the action that fixes it. Freshness budgets live in
settings.yaml; a stale input is a warning, a failed job or missing core data is an error.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

import duckdb
import pandas as pd
import yaml

from research_room import images, quality, scoreboard, store
from research_room.config import CONFIG_DIR, REPO_ROOT, Settings, settings

NOTES_PATH = REPO_ROOT / "docs" / "engine-notes.yaml"


def _ts(v) -> pd.Timestamp | None:
    if v is None or (isinstance(v, float) and pd.isna(v)) or v is pd.NaT:
        return None
    t = pd.Timestamp(v)
    return t if t.tzinfo else t.tz_localize("UTC")


def _iso(v) -> str | None:
    t = _ts(v)
    return t.isoformat() if t is not None else None


def _fresh(key, label, last, budget_h, now, action, missing_status="warn", missing_detail=None):
    last = _ts(last)
    if last is None:
        return {"key": key, "label": label, "status": missing_status, "last_ok_at": None,
                "freshness_budget_h": budget_h, "detail": missing_detail or "never run",
                "action": None if missing_status == "ok" else action}
    age_h = (now - last).total_seconds() / 3600
    ok = age_h <= budget_h
    return {"key": key, "label": label, "status": "ok" if ok else "warn", "last_ok_at": last.isoformat(),
            "freshness_budget_h": budget_h,
            "detail": f"{age_h:.0f} h old" + ("" if ok else f" (budget {budget_h:.0f} h)"),
            "action": None if ok else action}


def health(con: duckdb.DuckDBPyConnection, cfg: Settings | None = None,
           now: datetime | None = None, db_path: Path | None = None) -> dict:
    cfg = cfg or settings()
    now = pd.Timestamp(now or store.utcnow())
    now = now if now.tzinfo else now.tz_localize("UTC")
    fh = cfg.system.freshness_hours
    one = lambda sql, *p: con.execute(sql, list(p)).fetchone()[0]  # noqa: E731
    checks = []

    last_sync = one("SELECT max(finished_at) FROM ingest_runs WHERE source='bdl' AND status='ok' "
                    "AND job IN ('sync_daily', 'backfill')")
    checks.append(_fresh("bdl_sync", "BallDontLie data", last_sync, fh["bdl_sync"], now, "run make nightly"))
    checks.append(_fresh("injuries", "Injury report", one("SELECT max(fetched_at) FROM injuries"),
                         fh["injuries"], now, "run make nightly"))
    if now.tz_convert("America/New_York").date() >= cfg.season.first_game_date:  # reports start then
        checks.append(_fresh(
            "nba_report", "NBA injury report",
            one("SELECT max(fetched_at) FROM nba_report_teams") if store.has_table(con, "nba_report_teams")
            else None,
            fh.get("nba_report", fh["injuries"]), now, "run make pregame (or make nightly)",
            missing_detail="no official report read yet: 'not listed' players use their play rate"))
    odds_last = one("SELECT max(fetched_at) FROM odds")
    checks.append(_fresh("odds", "Betting-line archive", odds_last, fh["odds"], now,
                         "run make nightly (odds history only exists from the first nightly run)",
                         missing_detail="no lines archived yet; spread/total features stay missing"))
    markets_last = one("SELECT max(fetched_at) FROM props_ladder WHERE source IN ('kalshi', 'rundown')")
    odds_mk = one("SELECT max(fetched_at) FROM odds WHERE source IN ('kalshi', 'rundown')")
    mk = max((t for t in (markets_last, odds_mk) if t is not None), default=None)
    checks.append(_fresh("markets", "Betting markets (Kalshi, TheRundown)", mk, fh["markets"], now,
                         "run make markets (or make nightly); check RUNDOWN_API_KEY in .env",
                         missing_detail="no market snapshot yet: props and sportsbook lines stay missing"))
    checks.append(_fresh("projections", "Projections", one("SELECT max(run_at) FROM projections"),
                         fh["projections"], now, "run make nightly"))
    snap = one("SELECT max(snapshot) FROM external_projections WHERE source='bbm'")
    checks.append(_fresh("preseason", "Basketball Monster projections",
                         pd.Timestamp(snap).tz_localize("UTC") if snap else None,
                         fh["preseason_projections"], now,
                         "download fresh Export to CSV + Export to Excel into reference/, "
                         "run make projections",
                         missing_status="error", missing_detail="no preseason projections loaded"))
    roster_snap = one("SELECT max(snapshot_at) FROM yahoo_rosters WHERE team_id = ?", cfg.league.my_team_id)
    draft_done = now.date() > pd.Timestamp(cfg.draft.starts_at).date()
    checks.append(_fresh("yahoo_roster", "My Yahoo roster", roster_snap, fh["yahoo_roster"], now,
                         "save roster.csv to data/inbox, run make inbox",
                         missing_status="warn" if draft_done else "ok",
                         missing_detail="none yet" + ("" if draft_done else " (expected after the draft)")))

    # A job is failing only while its LATEST run failed; earlier failures that a later run
    # recovered from are reported, but don't turn the check red.
    since = now - timedelta(days=cfg.system.failed_job_lookback_days)
    runs = con.execute("SELECT source, job, status, finished_at, detail FROM ingest_runs "
                       "WHERE finished_at >= ? ORDER BY finished_at", [since]).df()
    latest = runs.groupby(["source", "job"]).tail(1)
    failing = latest[latest["status"] == "error"]
    recovered = int((runs["status"] == "error").sum()) - len(failing)
    if not failing.empty:
        f = failing.iloc[-1]
        detail = f"{len(failing)} job(s) failing; {f['source']} {f['job']}: {f['detail']}"
    else:
        detail = "none failing" + (f" ({recovered} earlier failure(s) recovered)" if recovered else "")
    checks.append({"key": "failed_jobs", "label": "Jobs", "status": "error" if not failing.empty else "ok",
                   "last_ok_at": None, "freshness_budget_h": None, "detail": detail,
                   "action": "see job history below" if not failing.empty else None})

    # Unmatched Yahoo names matter (rostered players); unmatched projection rows are fringe players.
    by_source = dict(con.execute("SELECT source, count(*) FROM unresolved_names GROUP BY 1").fetchall())
    yahoo_bad, other_bad = by_source.get("yahoo", 0), sum(v for k, v in by_source.items() if k != "yahoo")
    checks.append({"key": "names", "label": "Name matching", "status": "warn" if yahoo_bad else "ok",
                   "last_ok_at": None, "freshness_budget_h": None,
                   "detail": (f"{yahoo_bad} Yahoo name(s) unmatched" if yahoo_bad
                              else "all Yahoo names matched")
                   + (f"; {other_bad} fringe projection name(s) unmatched" if other_bad else ""),
                   "action": "add entries to config/aliases.yaml" if yahoo_bad else None})
    q = quality.summary(con)
    bad = int(q["incomplete"].sum()) if not q.empty else 0
    checks.append({"key": "box_scores", "label": "Box-score completeness", "status": "ok",
                   "last_ok_at": None, "freshness_budget_h": None,
                   "detail": (f"{bad} incomplete team-games excluded from features" if bad
                              else "all reconcile"),
                   "action": None})
    pool = one("SELECT count(*) FROM external_projections WHERE source='bbm' AND games > 0 AND snapshot = "
               "(SELECT max(snapshot) FROM external_projections WHERE source='bbm')")
    faces = sum(1 for _ in (images.IMAGE_DIR / "players").glob("*.png")) if images.IMAGE_DIR.exists() else 0
    checks.append({"key": "images", "label": "Headshot cache", "status": "ok" if faces else "warn",
                   "last_ok_at": None, "freshness_budget_h": None,
                   "detail": f"{faces} headshots cached for a {pool}-player pool",
                   "action": None if faces else "run make images"})
    xs = (yaml.safe_load((CONFIG_DIR / "x_accounts.yaml").read_text()) or {}).get("accounts") or []
    verified = sum(1 for a in xs if a.get("verified"))
    failed = [a["handle"] for a in xs if a.get("lookup")]
    unchecked = len(xs) - verified - len(failed)
    checks.append({"key": "x_accounts", "label": "X account list",
                   "status": "ok" if xs and unchecked == 0 else "warn", "last_ok_at": None,
                   "freshness_budget_h": None,
                   "detail": f"{verified} of {len(xs)} handles verified"
                   + (f"; {len(failed)} failed lookup and are skipped" if failed else ""),
                   "action": None if xs and unchecked == 0
                   else "run the X users lookup for the unchecked handles"})

    status_rank = {"ok": 0, "warn": 1, "error": 2}
    overall = max((c["status"] for c in checks), key=status_rank.get, default="ok")
    path = Path(db_path) if db_path else settings().paths.db
    tables = store.table_counts(con)
    jobs = con.execute("SELECT source, job, status, finished_at, rows, detail FROM ingest_runs "
                       "ORDER BY started_at DESC LIMIT 20").df()
    return {"as_of": now.isoformat(), "overall": overall, "checks": checks,
            "store": {"db_bytes": path.stat().st_size if path.exists() else None,
                      "tables": [{"table": r.table, "rows": int(r.rows)} for r in tables.itertuples()]},
            "jobs": [{"source": r.source, "job": r.job, "status": r.status,
                      "finished_at": _iso(r.finished_at),
                      "rows": None if pd.isna(r.rows) else int(r.rows), "detail": r.detail}
                     for r in jobs.itertuples()]}


def models(con: duckdb.DuckDBPyConnection) -> dict:
    df = scoreboard.latest(con)
    out = []
    for r in df.itertuples():
        num = lambda v: None if v is None or pd.isna(v) else float(v)  # noqa: E731
        day = lambda v: pd.Timestamp(v).date().isoformat()  # noqa: E731
        out.append({"model": r.model, "stat": r.stat, "window_start": day(r.window_start),
                    "window_end": day(r.window_end), "mae": num(r.mae), "rmse": num(r.rmse),
                    "coverage_80": float(r.coverage_80), "n": int(r.n),
                    "beats_baseline": None if pd.isna(r.beats_baseline) else bool(r.beats_baseline)})
    as_of = con.execute("SELECT max(run_at) FROM model_scores").fetchone()[0]
    return {"as_of": _iso(as_of), "models": out,
            "note": ("Out of sample: each model is fit on earlier seasons and scored on a later one. "
                     "baseline_team_week is what drives win probabilities: a 10-player team's weekly "
                     "total per category, where coverage_80 should be near 0.80. Per-game coverage of "
                     "small whole-number stats (blocks, steals) reads high by nature and is not the "
                     "target. Only the baseline exists so far; new models must beat it before they "
                     "drive recommendations.")}


LIVE_STATS = ("minutes", "pts", "reb", "ast", "stl", "blk", "fg3m", "tov", "fga", "fgm", "fta", "ftm")


def _live_block(summary: dict) -> dict:
    """One window of live_scores.summary, shaped for the System screen."""
    recs = summary.get("projections") or []
    by = {(r["stat"], r["segment"]): r for r in recs}
    num = lambda v: None if v is None or (isinstance(v, float) and pd.isna(v)) else float(v)  # noqa: E731
    stats = [{"stat": st, "n": int(by[(st, "all")]["n"]), "mae": num(by[(st, "all")]["mae"]),
              "bias": num(by[(st, "all")]["bias"]), "coverage_80": num(by[(st, "all")]["coverage_80"]),
              "played_mae": num(by.get((st, "played"), {}).get("mae"))}
             for st in LIVE_STATS if (st, "all") in by]
    market = [{"stat": st, "n": int(by[(st, "market")]["n"]), "market_mae": num(by[(st, "market")]["mae"]),
               "model_mae": num(by[(st, "market_model")]["mae"])}
              for st in LIVE_STATS if (st, "market") in by and (st, "market_model") in by]
    pp = by.get(("p_play", "brier"))
    return {
        "days": int(summary.get("days") or 0),
        "stats": stats,
        "market": market,
        "p_play": {"n": int(pp["n"]), "brier": num(pp.get("brier")), "bias": num(pp["bias"])} if pp else None,
        "ungraded": int(by.get(("_coverage", "no_box_score"), {}).get("n", 0)),
        "news": [{"source": r["source"], "status": r["status"], "listed": int(r["listed"]),
                  "played": int(r["played"]), "played_rate": num(r["played_rate"]),
                  "assumed": num(r.get("assumed"))}
                 for r in summary.get("news") or []],
        "weekly_odds": summary.get("weekly_odds"),
    }


def live_scoreboard(con: duckdb.DuckDBPyConnection, cfg=None, today=None) -> dict:
    """The live scoreboard (live_scores.py): what the app said before each game against what
    happened, for the season so far and the last 7 days."""
    from datetime import timedelta

    from research_room import live_scores
    from research_room.config import settings

    cfg = cfg or settings()
    today = today or pd.Timestamp.now(tz="America/New_York").date()
    have = store.has_table(con, "live_scores")
    as_of = con.execute("SELECT max(graded_at) FROM live_scores").fetchone()[0] if have else None
    season = live_scores.summary(con, cfg) if have else {}
    week = live_scores.summary(con, cfg, today - timedelta(days=7)) if have else {}
    return {
        "as_of": _iso(as_of),
        "season_start": cfg.season.first_game_date.isoformat(),
        "season": _live_block(season),
        "last_7_days": _live_block(week),
        "note": ("Each finished game is graded against the last projection made before its tip. A game "
                 "he sat counts 0, as projected. Grading runs nightly after the box scores arrive."),
    }


def notes(path: Path | None = None) -> dict:
    p = path or NOTES_PATH
    raw = yaml.safe_load(p.read_text()) if p.exists() else {}
    items = list((raw or {}).get("notes") or [])
    for n in items:
        n["date"] = str(n.get("date"))
        n.setdefault("refs", [])
    return {"notes": sorted(items, key=lambda n: (n["date"], n.get("id", "")), reverse=True)}

"""Draft-night readiness: is everything the draft board needs loaded, fresh and confirmed?

Inputs: the store (external_projections, yahoo_players, unresolved_names), settings (draft slot,
keepers, confirmed league facts, readiness thresholds), the image cache, the local draft API.
Outputs: a dict of checks (key, label, status ok|warn|error, detail, action) for `make doctor` and
GET /system/readiness.
Tables: reads only. The keeper and board checks run against an in-memory copy, never the real log.

An error means the board would be wrong or would not start (no projections, a keeper that doesn't
match). A warning means it works with lower confidence (Basketball Monster positions instead of
Yahoo eligibility, an unconfirmed league fact).
"""

from __future__ import annotations

import time
from datetime import datetime

import duckdb
import pandas as pd
import requests

from research_room import images, schedule, store
from research_room.config import Settings, settings
from research_room.draft import eligibility, tracker
from research_room.ingest.external_proj import blend_preseason


def _check(key, label, status, detail, action=None) -> dict:
    return {"key": key, "label": label, "status": status, "detail": detail,
            "action": None if status == "ok" else action}


def _api_up(url: str) -> bool:
    try:
        return requests.get(f"{url}/health", timeout=1.5).ok
    except requests.RequestException:
        return False


def readiness(con: duckdb.DuckDBPyConnection, cfg: Settings | None = None, now: datetime | None = None,
              check_api: bool = True) -> dict:
    cfg = cfg or settings()
    now = pd.Timestamp(now or store.utcnow())
    now = now if now.tzinfo else now.tz_localize("UTC")
    d, r = cfg.draft, cfg.draft.readiness
    starts = pd.Timestamp(d.starts_at)
    checks = []

    # Projections: the board cannot start without them.
    snap = con.execute("SELECT max(snapshot) FROM external_projections WHERE source='bbm'").fetchone()[0]
    try:
        pool = blend_preseason(con, cfg) if snap else pd.DataFrame()
    except Exception as e:  # noqa: BLE001 - reported, not raised: doctor lists every problem at once
        pool = pd.DataFrame()
        checks.append(_check("pool", "Draft pool", "error", f"blending failed: {e}", "run make projections"))
    if not snap:
        checks.append(_check("projections", "Basketball Monster projections", "error",
                             "none loaded",
                             "export CSV + Excel into reference/<MMDDYY>/, run make projections"))
    else:
        age_d = (starts.date() - pd.Timestamp(snap).date()).days
        fresh = age_d <= cfg.system.freshness_hours["preseason_projections"] / 24
        checks.append(_check("projections", "Basketball Monster projections", "ok" if fresh else "warn",
                             f"snapshot {pd.Timestamp(snap).date()}, {age_d} days before the draft",
                             "export fresh CSV + Excel into reference/<MMDDYY>/ in draft week, "
                             "run make projections"))

    # Eligibility: Yahoo's multi-position list for the players that matter.
    if not pool.empty:
        top = pool.sort_values("ext_rank").head(d.pool_size)
        yahoo = eligibility.load_yahoo(con)
        src = eligibility.resolve(top, yahoo, cfg)["eligibility_source"]
        share = float((src == "yahoo").mean())
        ok = share >= r.yahoo_eligibility_min_share
        checks.append(_check("eligibility", "Yahoo position eligibility", "ok" if ok else "warn",
                             f"{share:.0%} of the top {len(top)} have Yahoo eligibility"
                             + ("" if ok else "; the rest use Basketball Monster's primary position"),
                             "save players.csv (all players, with eligible_positions) to data/inbox, "
                             "run make inbox"))

    unmatched = con.execute("SELECT count(*) FROM unresolved_names WHERE source='yahoo'").fetchone()[0]
    checks.append(_check("names", "Yahoo names", "warn" if unmatched else "ok",
                         f"{unmatched} unmatched" if unmatched else "all matched",
                         "add entries to config/aliases.yaml, run make inbox"))

    # League facts.
    teams = cfg.league.teams
    slot_ok = d.my_slot is not None and 1 <= d.my_slot <= teams
    checks.append(_check("slot", "My draft slot", "ok" if slot_ok else "warn",
                         f"slot {d.my_slot} of {teams}" if slot_ok else "not set",
                         "set draft.my_slot in config/settings.yaml (or pick it on the Draft screen)"))
    checks.append(_check("rounds", "Draft rounds", "ok" if d.confirmed.rounds else "warn",
                         f"{d.rounds} rounds" + ("" if d.confirmed.rounds else " (assumed)"),
                         "check Yahoo draft settings, then set draft.confirmed.rounds: true"))
    keeper_status, keeper_detail, keeper_action = "ok", f"{len(d.keepers)} configured", None
    if d.keepers and not pool.empty:
        scratch = store.connect(":memory:")
        try:
            from research_room.api import apply_configured_keepers  # api imports this module's peers
            apply_configured_keepers(scratch, tracker.new_state("doctor", cfg, d.my_slot), cfg, pool)
        except ValueError as e:
            keeper_status, keeper_detail = "error", str(e)
            keeper_action = "fix draft.keepers in config/settings.yaml"
        finally:
            scratch.close()
    if keeper_status == "ok" and not d.confirmed.keepers:
        keeper_status, keeper_detail = "warn", keeper_detail + " (not confirmed)"
        keeper_action = "confirm keepers with the commissioner, then set draft.confirmed.keepers: true"
    checks.append(_check("keepers", "Keepers", keeper_status, keeper_detail, keeper_action))
    checks.append(_check("weeks", "Fantasy week boundaries", "ok" if cfg.season.week_boundaries_verified
                         else "warn", "verified" if cfg.season.week_boundaries_verified
                         else "weeks 1-19 assumed (affects games-per-week on the board)",
                         "compare with the Yahoo league schedule, then set season.week_boundaries_verified"))
    checks.append(_check("listener", "Pick listener", "ok" if d.confirmed.listener else "warn",
                         "checked in a Yahoo mock draft" if d.confirmed.listener
                         else "only tested against the local mock room",
                         "run a Yahoo mock draft with a throwaway draft id (README), then set "
                         "draft.confirmed.listener: true; manual entry always works"))

    games = schedule.load_games(con, cfg.season.nba_season)
    season = f"{cfg.season.nba_season}-{(cfg.season.nba_season + 1) % 100:02d}"
    checks.append(_check("schedule", "NBA schedule", "ok" if len(games) else "error",
                         f"{len(games)} games for {season}",
                         "run make backfill (it also loads the new season's schedule)"))

    # The board itself: build it once and time a refresh.
    if not pool.empty and len(games):
        from research_room.api import Session  # deferred: api imports the whole engine
        gpw = schedule.games_per_week(games, cfg.season)
        sess = Session("doctor", cfg, pool, gpw, set(), tracker.new_state("doctor", cfg, d.my_slot or 1),
                       yahoo_elig=eligibility.load_yahoo(con))
        t0 = time.perf_counter()
        sess.rebuild()
        sess.board.recommend(sess.state)
        ms = (time.perf_counter() - t0) * 1000
        ok = ms <= r.board_refresh_budget_ms
        checks.append(_check("board", "Board refresh", "ok" if ok else "warn",
                             f"{ms:.0f} ms for {len(sess.valued)} players "
                             f"(budget {r.board_refresh_budget_ms:.0f})",
                             "close other heavy apps; manual entry still works"))

    faces = sum(1 for _ in (images.IMAGE_DIR / "players").glob("*.png")) if images.IMAGE_DIR.exists() else 0
    checks.append(_check("images", "Headshots", "ok" if faces else "warn", f"{faces} cached",
                         "run make images"))
    if check_api:
        up = _api_up(r.api_url)
        checks.append(_check("api", "Draft API", "ok" if up else "warn",
                             f"running at {r.api_url}" if up else f"not running at {r.api_url}",
                             "run make draft-api in its own terminal before the draft"))

    rank = {"ok": 0, "warn": 1, "error": 2}
    overall = max((c["status"] for c in checks), key=rank.get, default="ok")
    hours = (starts - now).total_seconds() / 3600
    return {"as_of": now.isoformat(), "draft_starts_at": starts.isoformat(),
            "hours_to_draft": round(hours, 1), "overall": overall, "checks": checks}

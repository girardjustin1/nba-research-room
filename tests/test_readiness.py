from __future__ import annotations

import pandas as pd
import pytest

from research_room import readiness, store
from tests.test_board import make_pool
from tests.test_eligibility import _yahoo


@pytest.fixture
def cfg():
    from research_room.config import settings
    s = settings()
    return s.model_copy(update={"league": s.league.model_copy(update={"teams": 4}),
                               "draft": s.draft.model_copy(update={"rounds": 5, "pool_size": 10})})


def _with(cfg, **draft):
    return cfg.model_copy(update={"draft": cfg.draft.model_copy(update=draft)})


@pytest.fixture
def loaded(con, monkeypatch):
    """A store with a BBM snapshot row (the pool itself comes from make_pool)."""
    store.upsert(con, "external_projections", pd.DataFrame([{
        "source": "bbm", "snapshot": pd.Timestamp("2026-10-16").date(), "ext_id": "1", "name": "P1",
        "player_id": 1, "games": 70.0, "fetched_at": pd.Timestamp("2026-10-16T00:00:00Z")}]))
    monkeypatch.setattr(readiness, "blend_preseason", lambda con, cfg: make_pool(40))
    monkeypatch.setattr(readiness.schedule, "load_games", lambda con, season: pd.DataFrame({"game_id": [1]}))
    monkeypatch.setattr(readiness.schedule, "games_per_week", lambda games, season: 3.1)
    return con


def by_key(report):
    return {c["key"]: c for c in report["checks"]}


def test_no_projections_is_an_error(con, cfg):
    r = readiness.readiness(con, cfg, now=pd.Timestamp("2026-10-17T12:00:00Z"), check_api=False)
    assert r["overall"] == "error" and by_key(r)["projections"]["status"] == "error"
    assert by_key(r)["schedule"]["status"] == "error"


def test_draft_week_with_everything_confirmed_is_ok(loaded, cfg):
    _yahoo(loaded, [(i, "PG,SG") for i in range(1, 11)])
    good = _with(cfg, my_slot=2, confirmed=cfg.draft.confirmed.model_copy(
        update={"rounds": True, "keepers": True, "listener": True}))
    weeks = good.season.model_copy(update={"week_boundaries_verified": True})
    good = good.model_copy(update={"season": weeks})
    r = readiness.readiness(loaded, good, now=pd.Timestamp("2026-10-17T12:00:00Z"), check_api=False)
    checks = by_key(r)
    assert checks["eligibility"]["status"] == "ok", checks["eligibility"]
    assert {c["status"] for k, c in checks.items() if k != "images"} == {"ok"}, checks
    assert all(c["action"] is None for c in checks.values() if c["status"] == "ok")


def test_gaps_are_warnings_with_actions(loaded, cfg):
    r = readiness.readiness(loaded, cfg, now=pd.Timestamp("2026-10-17T12:00:00Z"), check_api=False)
    checks = by_key(r)
    for key in ("eligibility", "slot", "rounds", "keepers", "listener"):
        assert checks[key]["status"] == "warn" and checks[key]["action"], key
    assert "0% of the top 10" in checks["eligibility"]["detail"]


def test_unmatched_keeper_is_an_error(loaded, cfg):
    bad = _with(cfg, keepers=[{"team_id": 1, "round": 1, "player": "Nobody Here"}])
    r = readiness.readiness(loaded, bad, now=pd.Timestamp("2026-10-17T12:00:00Z"), check_api=False)
    assert by_key(r)["keepers"]["status"] == "error" and r["overall"] == "error"
    assert loaded.execute("SELECT count(*) FROM draft_picks").fetchone()[0] == 0   # real log untouched

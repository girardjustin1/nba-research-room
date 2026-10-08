"""Shadow models: the cached fit, pre-game runs never fitting, failures kept out of the driver's
run, and the game-by-game comparison (invented rows; a cheap stand-in for the ensemble)."""

from __future__ import annotations

from datetime import UTC, date, datetime

import pandas as pd
import pytest

from research_room import shadow
from research_room.config import settings


class Cheap:
    fits = 0

    def __init__(self, cfg, positions):
        self.positions = positions

    def fit(self, train):
        Cheap.fits += 1
        return self

    def fit_minutes(self, *a):
        return self


@pytest.fixture
def cfg(tmp_path, monkeypatch, con):
    c = settings()
    c = c.model_copy(update={"paths": c.paths.model_copy(update={"db": tmp_path / "x.duckdb"}),
                             "models": c.models.model_copy(update={"shadow": ["ensemble"]})})
    monkeypatch.setattr(shadow, "FACTORIES", {"ensemble": Cheap})
    monkeypatch.setattr(shadow.schedule, "season_schedule", lambda con: pd.DataFrame())
    Cheap.fits = 0
    return c


def test_only_the_nightly_run_fits_and_the_fit_is_cached(con, cfg):
    train = pd.DataFrame()
    assert shadow.fitted(con, cfg, "ensemble", train, [2024, 2025], refit=False) is None   # pre-game
    assert isinstance(shadow.fitted(con, cfg, "ensemble", train, [2024, 2025], refit=True), Cheap)
    assert shadow.fitted(con, cfg, "ensemble", train, [2024, 2025], refit=False) is not None
    assert Cheap.fits == 1                                                  # loaded, not refitted
    shadow.fitted(con, cfg, "ensemble", train, [2024, 2025, 2026], refit=True)   # new seasons: refit
    assert Cheap.fits == 2 and len(list((cfg.paths.db.parent / "models").glob("ensemble-*.pkl"))) == 1


def test_a_failing_shadow_is_reported_not_raised(con, cfg, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("no luck")

    monkeypatch.setattr(shadow, "fitted", boom)
    out = shadow.project(con, cfg, pd.DataFrame(), [2025], date(2026, 11, 4), date(2026, 11, 10),
                         pd.DataFrame(), None, datetime(2026, 11, 4, tzinfo=UTC), refit=True)
    assert out == {"ensemble": {"error": "RuntimeError: no luck"}}


def test_the_comparison_pairs_games_and_signs_the_change():
    def rows(means):
        return pd.DataFrame({
            "player_id": [1, 2, 3, 4], "game_id": [10, 11, 12, 13], "stat": "pts",
            "run_at": pd.Timestamp("2026-11-04", tz="UTC"), "no_log": False,
            "game_date": [date(2026, 11, 4), date(2026, 11, 4), date(2026, 11, 5), date(2026, 11, 6)],
            "mean": means, "pts": [10.0, 20.0, 0.0, 5.0]})

    t = shadow.compare(rows([12.0, 16.0, 2.0, 5.0]), rows([11.0, 18.0, 1.0, 5.0]), draws=200)
    r = t.set_index("stat").loc["pts"]
    assert r["n"] == 4 and r["days"] == 3
    assert r["mae_base"] == pytest.approx(2.0) and r["mae_shadow"] == pytest.approx(1.0)
    assert r["mae_change_pct"] == pytest.approx(-50.0)                     # the shadow misses half as much
    lo, hi = r["mae_change_95"]
    assert lo <= hi <= 0                                                    # never worse on any day

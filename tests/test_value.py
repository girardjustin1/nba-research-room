from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from research_room.config import settings
from research_room.draft import value

STATS = ("fgm", "fga", "ftm", "fta", "fg3m", "pts", "reb", "ast", "stl", "blk", "tov")


def player(pid, pos="SF", games=70, **means):
    base = {"fgm": 6, "fga": 13, "ftm": 3, "fta": 4, "fg3m": 1.5, "pts": 16, "reb": 5, "ast": 3,
            "stl": 1, "blk": 0.5, "tov": 1.5}
    base.update(means)
    row = {"player_id": pid, "name": f"P{pid}", "position": pos, "games": games}
    row.update({f"{s}_mean": float(base[s]) for s in STATS})
    row.update({f"{s}_sd": 1.0 for s in STATS})
    return row


@pytest.fixture
def cfg():
    s = settings()
    draft = s.draft.model_copy(update={"rounds": 2, "pool_size": 50, "tiers": 3})
    return s.model_copy(update={"league": s.league.model_copy(update={"teams": 2}), "draft": draft})


def base_pool(n=12):
    rng = np.random.default_rng(0)
    return [player(100 + i, pos=["PG", "SG", "SF", "PF", "C"][i % 5], pts=10 + rng.random() * 10,
                   reb=3 + rng.random() * 5) for i in range(n)]


def test_percentages_are_weighted_by_attempts(cfg):
    rows = base_pool() + [player(1, fgm=10, fga=20), player(2, fgm=1, fga=2)]   # both 50%
    v = value.compute_values(pd.DataFrame(rows), cfg).set_index("player_id")
    assert v.loc[1, "z_fg_pct"] > v.loc[2, "z_fg_pct"] > 0


def test_turnovers_count_against(cfg):
    rows = base_pool() + [player(1, tov=5), player(2, tov=0.5)]
    v = value.compute_values(pd.DataFrame(rows), cfg).set_index("player_id")
    assert v.loc[1, "z_tov"] < 0 < v.loc[2, "z_tov"]


def test_punting_masks_a_category(cfg):
    rows = base_pool() + [player(1, ftm=1, fta=8, pts=30, reb=12), player(2, pts=22, reb=8)]
    plain = value.compute_values(pd.DataFrame(rows), cfg).set_index("player_id")
    punt = value.compute_values(pd.DataFrame(rows), cfg, punts={"ft_pct"}).set_index("player_id")
    assert punt.loc[1, "value_pg"] > plain.loc[1, "value_pg"]          # FT% drag removed
    assert punt.loc[1, "z_ft_pct"] == plain.loc[1, "z_ft_pct"]          # still shown
    with pytest.raises(ValueError, match="unknown punt"):
        value.compute_values(pd.DataFrame(rows), cfg, punts={"bogus"})


def test_scarce_position_has_lower_replacement(cfg):
    # 4 drafted (2 teams x 2 rounds). Many good guards, one good center: the next-best guard
    # left over is still decent, the next-best center is poor.
    rows = [player(i, pos="PG", pts=20 - i * 0.1) for i in range(6)] + \
           [player(10, pos="C", pts=21), player(11, pos="C", pts=5)]
    v = value.compute_values(pd.DataFrame(rows), cfg)
    repl = v.attrs["replacement"]
    assert repl["C"] < repl["PG"]
    c = v.set_index("player_id").loc[10]
    assert c["vorp_pg"] == pytest.approx(c["value_pg"] - repl["C"])


def test_value_scales_with_games(cfg):
    rows = base_pool() + [player(1, pts=28, games=82), player(2, pts=28, games=41)]
    v = value.compute_values(pd.DataFrame(rows), cfg).set_index("player_id")
    assert v.loc[1, "value_pg"] == pytest.approx(v.loc[2, "value_pg"])
    assert v.loc[1, "value"] == pytest.approx(2 * v.loc[2, "value"])


def test_natural_breaks_finds_obvious_clusters():
    labels = value.natural_breaks(np.array([10, 9.9, 9.8, 5, 4.9, 1.0]), 3)
    assert labels.tolist() == [1, 1, 1, 2, 2, 3]
    assert value.natural_breaks(np.array([3.0]), 5).tolist() == [1]


def test_ranks_and_tiers_are_ordered(cfg):
    v = value.compute_values(pd.DataFrame(base_pool(20)), cfg)
    assert v["rank"].tolist() == list(range(1, 21))
    assert v["value"].is_monotonic_decreasing and v["tier"].is_monotonic_increasing


def test_category_balance_sums_roster(cfg):
    v = value.compute_values(pd.DataFrame(base_pool()), cfg)
    bal = value.category_balance(v.head(3), cfg)
    assert list(bal.index) == [c.key for c in cfg.categories]
    assert bal["pts"] == pytest.approx(v.head(3)["z_pts"].sum())

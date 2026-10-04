from __future__ import annotations

import pandas as pd
import pytest

from research_room import api, store
from research_room.config import settings
from research_room.draft import eligibility, tracker
from tests.test_board import make_pool


@pytest.fixture
def cfg():
    s = settings()
    return s.model_copy(update={"league": s.league.model_copy(update={"teams": 4}),
                               "draft": s.draft.model_copy(update={"rounds": 5, "pool_size": 60})})


def _yahoo(con, rows, at="2026-10-15T12:00:00Z"):
    df = pd.DataFrame([{"snapshot_at": pd.Timestamp(at), "yahoo_player_key": f"k{pid}",
                        "player_name": f"P{pid}", "team_abbr": "X", "eligible_positions": pos,
                        "pct_rostered": 50.0, "status": None, "owner_team_id": None, "player_id": pid,
                        "source": "yahoo_csv", "fetched_at": pd.Timestamp(at)}
                       for pid, pos in rows])
    store.upsert(con, "yahoo_players", df)


def test_slots_union_in_roster_order(cfg):
    assert eligibility.slots_for(["SG", "PG"], cfg) == ["PG", "SG", "G", "Util"]
    assert eligibility.slots_for(["PF", "C"], cfg) == ["PF", "F", "C", "Util"]
    assert eligibility.slots_for([], cfg) == ["Util"]


def test_no_yahoo_snapshot_means_all_bbm(con, cfg):
    yahoo = eligibility.load_yahoo(con)
    assert yahoo.empty
    assert set(eligibility.resolve(make_pool(5), yahoo, cfg)["eligibility_source"]) == {"bbm"}


def test_yahoo_wins_and_missing_players_fall_back_to_bbm(con, cfg):
    _yahoo(con, [(1, "PG,SG"), (2, "SF,PF")], at="2026-10-01T00:00:00Z")
    _yahoo(con, [(1, "PG,SG,SF")])                       # newer snapshot only lists player 1
    pool = make_pool(5)
    out = eligibility.resolve(pool, eligibility.load_yahoo(con), cfg)
    assert out.at[0, "eligibility_source"] == "yahoo"
    assert out.at[0, "positions"] == "PG,SG,SF"
    assert out.at[0, "eligible"] == ["PG", "SG", "G", "SF", "F", "Util"]
    assert out.at[1, "eligibility_source"] == "bbm"      # stale snapshot is ignored
    assert out.at[1, "positions"] == pool.at[1, "position"]


def test_session_values_with_yahoo_eligibility(cfg):
    pool = make_pool()
    yahoo = pd.DataFrame({"player_id": [1], "yahoo_positions": [["PG", "C"]]})
    s = api.Session("t", cfg, pool, 3.1, set(), tracker.new_state("t", cfg, 1), yahoo_elig=yahoo)
    s.rebuild()
    row = s.valued.set_index("player_id").loc[1]
    assert row["eligibility_source"] == "yahoo" and "C" in row["eligible"] and "G" in row["eligible"]
    assert (s.valued["eligibility_source"] == "bbm").sum() == len(pool) - 1


def test_configured_keepers_resolve_names_and_fail_loudly(con, cfg):
    pool = make_pool(20)
    keep = cfg.model_copy(update={"draft": cfg.draft.model_copy(update={"keepers": [
        {"team_id": 3, "round": 2, "player": "P7"}, {"team_id": 1, "round": 1, "player_id": 2}]})})
    state = api.apply_configured_keepers(con, tracker.new_state("k", keep, 1), keep, pool)
    picks = state.picks.set_index("player_id")
    assert picks.loc[7, "team_id"] == 3 and picks.loc[7, "round"] == 2 and bool(picks.loc[7, "is_keeper"])
    assert picks.loc[2, "pick_no"] == 1

    bad = cfg.model_copy(update={"draft": cfg.draft.model_copy(update={"keepers": [
        {"team_id": 2, "round": 1, "player": "Nobody Here"}]})})
    with pytest.raises(ValueError, match="not matched"):
        api.apply_configured_keepers(con, tracker.new_state("k2", bad, 1), bad, pool)

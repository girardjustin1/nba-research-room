from __future__ import annotations

from datetime import UTC, date, datetime

import pandas as pd
import pytest

from research_room import store
from research_room.config import settings
from research_room.ingest import external_proj as ep

NOW = datetime(2026, 10, 4, tzinfo=UTC)


def raw_row(ext_id, first, last, games, **totals):
    base = {"player_id": ext_id, "first_name": first, "last_name": last, "games": games,
            "minutes": 30 * games,
            "field_goals": 8 * games, "field_goals_attempted": 16 * games, "free_throws": 4 * games,
            "free_throws_attempted": 5 * games, "threes": 2 * games, "threes_attempted": 6 * games,
            "offensive_rebounds": 1 * games, "defensive_rebounds": 5 * games, "assists": 4 * games,
            "steals": 1 * games, "blocks": 1 * games, "turnovers": 2 * games}
    base.update(totals)
    return base


def table_row(ext_id, name, team="DEN", pos="C", adp=10.0, adv=11.0):
    return {"ID": ext_id, "Name": name, "Team": team, "Pos": pos, "Age": 25.0, "Y!Adp": adp,
            "Adv ADP": adv, "Rank": 5, "Inj Risk": "M", "Role": "ST"}


def test_combine_converts_totals_to_per_game_and_derives_points():
    raw = pd.DataFrame([raw_row(1, "Nikola", "Jokic", 70)])
    out = ep.combine(raw, pd.DataFrame([table_row(1, "Nikola Jokic")])).iloc[0]
    assert (out.games, out.minutes, out.fgm, out.fga, out.reb) == (70, 30, 8, 16, 6)
    assert out.pts == 2 * (8 - 2) + 3 * 2 + 4 == 22


def test_combine_treats_zero_adp_as_missing_and_fa_as_no_team():
    raw = pd.DataFrame([raw_row(1, "A", "B", 60), raw_row(2, "C", "D", 0)])
    table = pd.DataFrame([table_row(1, "A B", adp=0.0), table_row(2, "C D", team="FA", adp=50.0)])
    out = ep.combine(raw, table)
    assert pd.isna(out.loc[0, "yahoo_adp"]) and out.loc[1, "yahoo_adp"] == 50.0
    assert pd.isna(out.loc[1, "team_abbr"])
    assert pd.isna(out.loc[1, "pts"])                 # 0 projected games -> no per-game rate


@pytest.mark.parametrize(("raw_cols", "table_cols", "message"), [
    (["assists"], [], "use 'Export to CSV'"),
    ([], ["Y!Adp"], "Yahoo! ADP checked"),
])
def test_combine_rejects_the_wrong_export(raw_cols, table_cols, message):
    raw = pd.DataFrame([raw_row(1, "A", "B", 60)]).drop(columns=raw_cols)
    table = pd.DataFrame([table_row(1, "A B")]).drop(columns=table_cols)
    with pytest.raises(ep.ProjectionFileError, match=message):
        ep.combine(raw, table)


def test_combine_rejects_files_from_different_exports():
    raw = pd.DataFrame([raw_row(1, "A", "B", 60), raw_row(2, "C", "D", 60)])
    with pytest.raises(ep.ProjectionFileError, match="not in the .xls"):
        ep.combine(raw, pd.DataFrame([table_row(1, "A B")]))


def test_find_latest_tells_raw_csv_from_other_csvs(tmp_path):
    (tmp_path / "a").mkdir()
    (tmp_path / "a" / "Projections.csv").write_text("player_id,field_goals_attempted\n1,2\n")
    (tmp_path / "a" / "roster.csv").write_text("team_id,player_name\n")
    (tmp_path / "a" / "Projections.xls").write_bytes(b"x")
    csv, xls = ep.find_latest(tmp_path)
    assert csv.name == "Projections.csv" and xls.name == "Projections.xls"
    (tmp_path / "a" / "Projections.xls").unlink()
    with pytest.raises(ep.ProjectionFileError, match="Export to Excel"):
        ep.find_latest(tmp_path)


def _seed_history(con, player_id, games, pts_values):
    """One player per team-side; home score = his points and 240 minutes, so the side is complete."""
    first = 1000 * player_id
    pts = [float(pts_values[i % len(pts_values)]) for i in range(games)]
    f = [1.0 if i % 2 else 0.5 for i in range(games)]                # some spread in every stat
    store.upsert(con, "games", pd.DataFrame([{
        "game_id": first + i, "season": 2025, "game_date": date(2026, 1, 1), "status_state": "final",
        "postseason": False, "home_team_id": player_id, "visitor_team_id": 99, "home_score": pts[i],
        "visitor_score": 0, "source": "t", "fetched_at": NOW} for i in range(games)]))
    store.upsert(con, "game_logs", pd.DataFrame([{
        "game_id": first + i, "player_id": player_id, "team_id": player_id, "season": 2025,
        "minutes": 240.0, "did_play": True, "fgm": 8 * f[i], "fga": 16 * f[i], "ftm": 4 * f[i],
        "fta": 5 * f[i], "fg3m": 2 * f[i], "fg3a": 6 * f[i], "reb": 6 * f[i], "ast": 4 * f[i],
        "stl": 2 * f[i], "blk": 2 * f[i], "tov": 2 * f[i], "pts": pts[i],
        "source": "t", "fetched_at": NOW} for i in range(games)]))


def test_blend_weights_last_season_only_with_enough_games(con):
    cfg = settings()
    w = cfg.draft.projection_blend
    _seed_history(con, 7, 40, [10, 30])               # veteran: mean 20 pts, sd ~10
    _seed_history(con, 8, 5, [40])                    # small sample: ignored
    for pid in (7, 8):
        store.upsert(con, "external_projections", pd.DataFrame([{
            "source": "bbm", "snapshot": date(2026, 10, 4), "ext_id": str(pid), "player_id": pid,
            "name": f"P{pid}", "games": 70.0, "minutes": 32.0, "fgm": 8.0, "fga": 16.0, "ftm": 4.0,
            "fta": 5.0, "fg3m": 2.0, "fg3a": 6.0, "reb": 6.0, "ast": 4.0, "stl": 1.0, "blk": 1.0,
            "tov": 2.0, "pts": 24.0, "fetched_at": NOW}]))
    pool = ep.blend_preseason(con, cfg).set_index("player_id")
    assert pool.loc[7, "pts_mean"] == pytest.approx(w.external * 24 + w.last_season * 20)
    assert pool.loc[7, "sources"] == "bbm+last_season"
    assert pool.loc[8, "pts_mean"] == 24 and pool.loc[8, "sources"] == "bbm_only"
    assert (pool.filter(like="_sd") > 0).all().all()
    assert pool.loc[7, "pts_sd"] > 5                  # the veteran's real spread carries through


def test_blend_refuses_without_history(con):
    store.upsert(con, "external_projections", pd.DataFrame([{
        "source": "bbm", "snapshot": date(2026, 10, 4), "ext_id": "1", "player_id": 1, "name": "P",
        "games": 70.0, "minutes": 30.0, "pts": 20.0, "fetched_at": NOW}]))
    with pytest.raises(ep.ProjectionFileError, match="make backfill"):
        ep.blend_preseason(con)

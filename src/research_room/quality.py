"""Data-quality checks on ingested history.

Inputs: games, game_logs. Outputs: per team-game reconciliation of box scores against the
final score. Tables: reads only.

Known issue (found in the 2026-10-04 backfill): ~21 team-games in Feb-Mar 2024 are missing
some player rows in BallDontLie's box scores, so their points do not add up to the final
score. Phase 1 features exclude any team-game where `complete` is false rather than treat a
partial box score as a full one.
"""

from __future__ import annotations

import duckdb
import pandas as pd

# A full team-game is 240 minutes (more with overtime). BDL minutes are whole numbers per
# player, so rounding can lose a few; below this a player row is very likely missing.
MIN_TEAM_MINUTES = 235


def box_score_check(con: duckdb.DuckDBPyConnection, season: int | None = None) -> pd.DataFrame:
    """One row per final team-game: summed box-score points/minutes vs the final score."""
    return con.execute(f"""
        WITH sides AS (
            SELECT game_id, season, game_date, home_team_id AS team_id, home_score AS score
            FROM games WHERE status_state = 'final'
            UNION ALL
            SELECT game_id, season, game_date, visitor_team_id, visitor_score
            FROM games WHERE status_state = 'final'
        ), box AS (
            SELECT game_id, team_id, sum(pts) AS box_pts, sum(minutes) AS box_minutes,
                   count(*) FILTER (WHERE did_play) AS players_played
            FROM game_logs GROUP BY ALL
        )
        SELECT s.game_id, s.team_id, s.season, s.game_date, s.score, b.box_pts, b.box_minutes,
               b.players_played,
               coalesce(b.box_pts = s.score AND b.box_minutes >= {MIN_TEAM_MINUTES}, false) AS complete
        FROM sides s LEFT JOIN box b USING (game_id, team_id)
        WHERE ? IS NULL OR s.season = ?
        ORDER BY s.game_date, s.game_id, s.team_id
    """, [season, season]).df()


def summary(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Per season: team-games, how many reconcile, how many are incomplete."""
    check = box_score_check(con)
    if check.empty:
        return pd.DataFrame(columns=["season", "team_games", "complete", "incomplete"])
    out = check.groupby("season").agg(team_games=("complete", "size"), complete=("complete", "sum"))
    out["incomplete"] = out["team_games"] - out["complete"]
    return out.reset_index()


def incomplete_team_games(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """(game_id, team_id) pairs whose box score is incomplete. Exclude only that side."""
    check = box_score_check(con)
    return check.loc[~check["complete"], ["game_id", "team_id"]].reset_index(drop=True)


def incomplete_games(con: duckdb.DuckDBPyConnection) -> set[int]:
    """game_ids where either side's box score is incomplete."""
    check = box_score_check(con)
    return set(check.loc[~check["complete"], "game_id"].astype(int))

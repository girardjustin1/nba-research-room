"""Fantasy-week schedule maths: games per team per week, back-to-backs, light days,
NBA Cup knockout window, All-Star week, playoff-week game counts.

Inputs: `games` table (one season), settings.season (week layout, windows, light-day cutoff).
Outputs: DataFrames for the Data page, the optimizer and the draft tool.
Tables: reads games, teams. Writes nothing (cheap to recompute).

Dates are NBA game dates (the US Eastern calendar date BDL returns in `games.date`), which is
the calendar Yahoo uses for daily lineups. Fantasy weeks run Monday-Sunday; a week listed in
settings.season.extended_weeks spans several calendar weeks.
"""

from __future__ import annotations

from datetime import date, timedelta

import duckdb
import pandas as pd

from research_room.config import Season


def fantasy_weeks(season: Season) -> pd.DataFrame:
    """One row per fantasy week: week, start, end (inclusive), n_days, is_playoff.

    Week 1 starts on the Monday of the week holding the first game. Raises if the layout in
    settings does not end exactly on `playoffs_end` with the last playoff week.
    """
    start = season.first_game_date - timedelta(days=season.first_game_date.weekday())
    rows, week = [], 1
    while start <= season.playoffs_end:
        span = 7 * season.extended_weeks.get(week, 1)
        end = start + timedelta(days=span - 1)
        rows.append({"week": week, "start": start, "end": end, "n_days": span,
                     "is_playoff": week in season.playoff_weeks})
        start, week = end + timedelta(days=1), week + 1
    df = pd.DataFrame(rows)
    last = df.iloc[-1]
    if last["end"] != season.playoffs_end or last["week"] != max(season.playoff_weeks):
        raise ValueError(
            f"week layout ends with week {last['week']} on {last['end']}, but settings say week "
            f"{max(season.playoff_weeks)} ends {season.playoffs_end}; fix season.extended_weeks")
    return df


def load_games(con: duckdb.DuckDBPyConnection, season: int) -> pd.DataFrame:
    return con.execute("""
        SELECT game_id, game_date, tip_utc, home_team_id, visitor_team_id, postseason,
               season_type, ist_stage, postponed, status_state
        FROM games WHERE season = ?
    """, [season]).df()


def team_games(games: pd.DataFrame) -> pd.DataFrame:
    """Long form: one row per team per regular-season game (home and away)."""
    g = games[~games["postseason"].fillna(False).astype(bool)
              & ~games["postponed"].fillna(False).astype(bool)
              & (games["season_type"].fillna("regular") != "preseason")]
    cols = ["game_id", "game_date", "ist_stage"]
    home = g[cols + ["home_team_id"]].rename(columns={"home_team_id": "team_id"}).assign(home=True)
    away = g[cols + ["visitor_team_id"]].rename(columns={"visitor_team_id": "team_id"}).assign(home=False)
    out = pd.concat([home, away], ignore_index=True).dropna(subset=["team_id"])
    out["team_id"] = out["team_id"].astype(int)
    out["game_date"] = pd.to_datetime(out["game_date"]).dt.date
    return out.sort_values(["team_id", "game_date"], ignore_index=True)


def daily_counts(tg: pd.DataFrame, light_day_max_games: int) -> pd.DataFrame:
    """NBA games per date and whether the date is a light day (<= cutoff games league-wide)."""
    per_day = tg.groupby("game_date")["game_id"].nunique().rename("n_games").reset_index()
    per_day["light_day"] = per_day["n_games"] <= light_day_max_games
    return per_day


def flag_back_to_backs(tg: pd.DataFrame) -> pd.DataFrame:
    """Add `b2b`: the team also plays the day before or the day after."""
    out = tg.sort_values(["team_id", "game_date"]).copy()
    d = pd.to_datetime(out["game_date"])
    prev_gap = d.groupby(out["team_id"]).diff().dt.days
    next_gap = -d.groupby(out["team_id"]).diff(-1).dt.days
    out["b2b"] = (prev_gap == 1) | (next_gap == 1)
    return out


def _assign_week(dates: pd.Series, weeks: pd.DataFrame) -> pd.Series:
    lookup = {}
    for w in weeks.itertuples(index=False):
        day = w.start
        while day <= w.end:
            lookup[day] = w.week
            day += timedelta(days=1)
    return dates.map(lookup).astype("Int64")


def team_week_matrix(games: pd.DataFrame, season: Season) -> pd.DataFrame:
    """Per team per fantasy week: games, b2b_games, light_day_games, cup_window_games, flags."""
    weeks = fantasy_weeks(season)
    tg = flag_back_to_backs(team_games(games))
    light = daily_counts(tg, season.light_day_max_games).set_index("game_date")["light_day"]
    tg["light_day"] = tg["game_date"].map(light).fillna(False).astype(bool)
    cup = season.nba_cup_knockout
    tg["cup_window"] = tg["game_date"].between(cup.start, cup.end)
    tg["week"] = _assign_week(tg["game_date"], weeks)
    tg = tg.dropna(subset=["week"])
    agg = tg.groupby(["team_id", "week"]).agg(
        games=("game_id", "count"), b2b_games=("b2b", "sum"),
        light_day_games=("light_day", "sum"), cup_window_games=("cup_window", "sum"),
    ).reset_index()
    teams = sorted(tg["team_id"].unique())
    grid = pd.MultiIndex.from_product([teams, weeks["week"]], names=["team_id", "week"]).to_frame(index=False)
    out = grid.merge(agg, on=["team_id", "week"], how="left").fillna(0)
    for c in ("games", "b2b_games", "light_day_games", "cup_window_games"):
        out[c] = out[c].astype(int)
    meta = weeks.set_index("week")
    asb = season.all_star_break
    out["is_playoff"] = out["week"].map(meta["is_playoff"])
    out["all_star_week"] = out["week"].map(
        {w.week: (w.start <= asb.end and asb.start <= w.end) for w in weeks.itertuples()})
    out["cup_knockout_week"] = out["week"].map(
        {w.week: (w.start <= cup.end and cup.start <= w.end) for w in weeks.itertuples()})
    return out


def schedule_matrix(con: duckdb.DuckDBPyConnection, season: Season, value: str = "games") -> pd.DataFrame:
    """Wide view for the app: team abbreviation x week -> `value` (games by default)."""
    m = team_week_matrix(load_games(con, season.nba_season), season)
    abbr = dict(con.execute("SELECT team_id, abbreviation FROM teams").fetchall())
    m["team"] = m["team_id"].map(abbr).fillna(m["team_id"].astype(str))
    wide = m.pivot(index="team", columns="week", values=value)
    wide.columns = [f"W{w}" for w in wide.columns]
    playoff_cols = [f"W{w}" for w in season.playoff_weeks]
    wide["total"] = wide.sum(axis=1)
    wide["playoffs"] = wide[playoff_cols].sum(axis=1)
    return wide.sort_values("playoffs", ascending=False)


def week_of(day: date, season: Season) -> int | None:
    """Fantasy week number for a date, or None outside the season."""
    weeks = fantasy_weeks(season)
    hit = weeks[(weeks["start"] <= day) & (weeks["end"] >= day)]
    return int(hit.iloc[0]["week"]) if not hit.empty else None


def games_per_week(games: pd.DataFrame, season: Season, playoffs: bool = False) -> float:
    """Average games per NBA team per calendar week, in regular-season or playoff fantasy weeks."""
    m = team_week_matrix(games, season)
    weeks = fantasy_weeks(season).set_index("week")
    m = m[m["is_playoff"] == playoffs]
    calendar_weeks = m["week"].map(weeks["n_days"] / 7)
    return float(m["games"].sum() / calendar_weeks.sum())


def season_schedule(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Regular-season games, one row per team per game: team_id, game_id, date, season, home."""
    g = con.execute("""SELECT game_id, season, game_date, home_team_id, visitor_team_id FROM games
                       WHERE NOT postseason""").df()
    d = pd.to_datetime(g["game_date"]).dt.date
    return pd.concat(
        [
            pd.DataFrame({"team_id": g[t], "game_id": g["game_id"], "date": d, "season": g["season"],
                          "home": t == "home_team_id"})
            for t in ("home_team_id", "visitor_team_id")
        ],
        ignore_index=True,
    )

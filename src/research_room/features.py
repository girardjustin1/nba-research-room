"""Feature table: per player per game, using only information available before that game's tip.

Inputs: game_logs, games (tip_utc), advanced_stats, settings.features.
Outputs: a DataFrame (and the derived DuckDB table `features`, rebuilt each run) with one row
per player-game: rolling and EWMA minutes, play rate, EWMA per-minute rates for every stat,
usage and FGA trends, days of rest, back-to-back, home/away, opponent pace and defensive rating,
what teammates-out the player is used to, and how many prior games the numbers rest on.
Tables: reads game_logs, games, advanced_stats; writes features (derived, replace-on-build).

No leakage, by construction: every player-level number is first computed as the state *after*
each game, then shifted one game later per player, so a game only sees games that tipped off
before it. Team context (pace, defense) is shifted the same way per team. tests/test_leakage.py
checks this by truncating the data and confirming earlier features do not change.

Not yet in history: Vegas lines and prop lines (BallDontLie keeps no odds history; they are
archived nightly from now on), and injury-based play probability (overrides.py, Phase 1).
Those columns are absent, never filled with neutral defaults.
"""

from __future__ import annotations

import duckdb
import numpy as np
import pandas as pd

from research_room import quality, teammates
from research_room.config import Settings, settings

RATE_STATS = ("pts", "reb", "ast", "stl", "blk", "fg3m", "tov", "fgm", "fga", "ftm", "fta")


def load_logs(con: duckdb.DuckDBPyConnection, seasons: list[int]) -> pd.DataFrame:
    """Regular-season player-game rows (DNPs included), incomplete box-score sides dropped."""
    seasons_sql = ",".join(str(int(s)) for s in seasons)
    logs = con.execute(f"""
        SELECT l.player_id, l.team_id, l.game_id, l.season, g.game_date, g.tip_utc,
               g.home_team_id, g.visitor_team_id, l.minutes, l.did_play,
               {", ".join(f"l.{s}" for s in RATE_STATS)}, a.usage_pct
        FROM game_logs l
        JOIN games g USING (game_id)
        LEFT JOIN advanced_stats a ON a.game_id = l.game_id AND a.player_id = l.player_id
        WHERE l.season IN ({seasons_sql}) AND NOT g.postseason AND g.tip_utc IS NOT NULL
    """).df()
    bad = quality.incomplete_team_games(con).assign(_bad=True)
    logs = logs.merge(bad, on=["game_id", "team_id"], how="left")
    return logs[logs["_bad"].isna()].drop(columns="_bad").reset_index(drop=True)


def team_context(con: duckdb.DuckDBPyConnection, seasons: list[int]) -> pd.DataFrame:
    """Per team-game pace and defensive rating (minutes-weighted over its players)."""
    seasons_sql = ",".join(str(int(s)) for s in seasons)
    return con.execute(f"""
        SELECT a.game_id, a.team_id, g.tip_utc,
               median(a.pace) AS pace,
               sum(a.def_rating * l.minutes) / nullif(sum(l.minutes), 0) AS def_rating
        FROM advanced_stats a
        JOIN game_logs l ON l.game_id = a.game_id AND l.player_id = a.player_id
        JOIN games g ON g.game_id = a.game_id
        WHERE a.season IN ({seasons_sql}) AND NOT g.postseason AND l.did_play
        GROUP BY a.game_id, a.team_id, g.tip_utc
    """).df()


def _prior(df: pd.DataFrame, after: pd.Series, by: str = "player_id") -> pd.Series:
    """State after each game -> value known before the *next* game, per `by`, forward-filled
    across games where the state did not update (e.g. DNPs for played-only states)."""
    return after.groupby(df[by]).transform(lambda s: s.ffill().shift(1))


def build(logs: pd.DataFrame, team_ctx: pd.DataFrame, cfg: Settings | None = None) -> pd.DataFrame:
    """Compute the feature table. Pure: no database access."""
    cfg = cfg or settings()
    f = cfg.features
    df = logs.sort_values(["player_id", "tip_utc"], kind="mergesort").reset_index(drop=True)
    by = df.groupby("player_id")
    played = df["did_play"].astype(bool)
    out = df[["player_id", "team_id", "game_id", "season", "game_date", "tip_utc"]].copy()
    out["home"] = df["team_id"] == df["home_team_id"]
    out["opp_team_id"] = np.where(out["home"], df["visitor_team_id"], df["home_team_id"])

    # Availability and minutes (all team games, DNPs as 0) ...
    for w in f.rolling_windows:
        out[f"min_r{w}"] = by["minutes"].transform(lambda s, w=w: s.shift(1).rolling(w, min_periods=w).mean())
    out["play_rate_ewma"] = by["did_play"].transform(
        lambda s: s.astype(float).shift(1).ewm(halflife=f.ewma_halflife_minutes,
                                               min_periods=f.ewma_min_periods).mean())
    # ... and minutes when playing (played games only, state after each played game).
    pm = df["minutes"].where(played)
    after_min = pm.groupby(df["player_id"]).transform(
        lambda s: s.dropna().ewm(halflife=f.ewma_halflife_minutes).mean().reindex(s.index))
    out["min_played_ewma"] = _prior(df, after_min)

    # Per-minute rates: ratio of EWMA sums (stable for low-volume stats), played games only.
    after_n = played.astype(float).groupby(df["player_id"]).cumsum()
    out["games_prior"] = after_n.groupby(df["player_id"]).shift(1).fillna(0).astype(int)
    ew_min = pm.groupby(df["player_id"]).transform(
        lambda s: s.dropna().ewm(halflife=f.ewma_halflife_rates).mean().reindex(s.index))
    for stat in RATE_STATS:
        x = df[stat].where(played)
        ew_x = x.groupby(df["player_id"]).transform(
            lambda s: s.dropna().ewm(halflife=f.ewma_halflife_rates).mean().reindex(s.index))
        out[f"{stat}_pm_ewma"] = _prior(df, ew_x / ew_min)
    enough = out["games_prior"] >= f.ewma_min_periods
    rate_cols = [c for c in out if c.endswith("_pm_ewma")] + ["min_played_ewma"]
    out.loc[~enough, rate_cols] = np.nan                     # too little history: missing, not guessed

    # Usage and shot volume trends (last 5 played games).
    for col, src in (("usage_r5", df["usage_pct"]), ("fga_r5", df["fga"])):
        after = src.where(played).groupby(df["player_id"]).transform(
            lambda s: s.dropna().rolling(5, min_periods=3).mean().reindex(s.index))
        out[col] = _prior(df, after)

    # Rest and schedule.
    prev_tip = by["tip_utc"].shift(1)
    out["days_rest"] = (pd.to_datetime(df["game_date"]) - pd.to_datetime(
        prev_tip.dt.tz_convert("America/New_York").dt.date)).dt.days
    out["back_to_back"] = out["days_rest"] == 1

    # Opponent context: the opponent's average pace / defense over its previous 10 games.
    tc = team_ctx.sort_values(["team_id", "tip_utc"]).copy()
    for col in ("pace", "def_rating"):
        tc[f"{col}_r10"] = tc.groupby("team_id")[col].transform(
            lambda s: s.shift(1).rolling(10, min_periods=3).mean())
    opp = tc[["game_id", "team_id", "pace_r10", "def_rating_r10"]].rename(
        columns={"team_id": "opp_team_id", "pace_r10": "opp_pace_r10", "def_rating_r10": "opp_drtg_r10"})
    out = out.merge(opp, on=["game_id", "opp_team_id"], how="left")

    # Teammates out: usage share of rotation teammates (by pre-game minutes EWMA) who sat out.
    rot = (out["min_played_ewma"] >= f.rotation_minutes) & ~played.to_numpy()
    out["_out_usage"] = np.where(rot, out["usage_r5"].fillna(0), 0.0)
    team_out = out.groupby(["game_id", "team_id"])["_out_usage"].transform("sum")
    # Same-game (who actually sat), so it's an outcome, named `y_` to keep it out of the features
    # (audit F11); teammates.py builds the pre-game version from P(plays).
    out["y_teammates_out_usage"] = team_out - out["_out_usage"]
    out = out.drop(columns="_out_usage")

    # What each player is used to: teammates missing in his previous games (teammates.py).
    out = pd.concat([out, teammates.prior_states(out, played, cfg)], axis=1)

    # Targets (what happened), kept separate from features by name: `y_` prefix.
    out["y_minutes"] = df["minutes"].to_numpy()
    out["y_did_play"] = played.to_numpy()
    for stat in RATE_STATS:
        out[f"y_{stat}"] = df[stat].to_numpy()
    return out


def feature_columns(df: pd.DataFrame) -> list[str]:
    """Inputs a model may use (everything except identifiers and `y_` targets)."""
    ids = {"player_id", "team_id", "game_id", "season", "game_date", "tip_utc", "opp_team_id"}
    return [c for c in df.columns if c not in ids and not c.startswith("y_")]


def build_and_store(con: duckdb.DuckDBPyConnection, cfg: Settings | None = None,
                    seasons: list[int] | None = None) -> pd.DataFrame:
    """Rebuild the `features` table from the store."""
    cfg = cfg or settings()
    seasons = seasons or sorted({*cfg.bdl.backfill_seasons, cfg.season.nba_season})
    feats = build(load_logs(con, seasons), team_context(con, seasons), cfg)
    con.register("_features", feats)
    try:
        con.execute("CREATE OR REPLACE TABLE features AS SELECT * FROM _features")
    finally:
        con.unregister("_features")
    return feats


# ------------------------------------------------------------------ states as the live system sees them

ET = "America/New_York"

# A player's state as of a given moment: everything a projection model may use that does not
# depend on the next game's opponent (so live, calibration and backtest projections agree).
STATE_COLUMNS = ["min_played_ewma", "play_rate_ewma", "games_prior", "min_r3", "min_r5", "min_r10",
                 "usage_r5", "fga_r5", *[f"{s}_pm_ewma" for s in RATE_STATS], *teammates.PRIOR_COLUMNS]


def monday_states(built: pd.DataFrame, mondays: list[pd.Timestamp]) -> pd.DataFrame:
    """Each player's feature state as of each Monday (00:00 Eastern, given in UTC), from the feature
    table: his first game at or after Monday carries the state after every game before Monday,
    exactly what the live system projects from. His team is the one of his last game before the
    moment. A player with no later game (out for the season) takes his last game's state, one game
    stale (known, small: it only affects players who never appear again). Only players who have
    played before that Monday."""
    keep = ["player_id", "team_id", "tip_utc", *STATE_COLUMNS]
    right = built[keep].sort_values("tip_utc")
    first = right.groupby("player_id")["tip_utc"].min()
    pairs = pd.MultiIndex.from_product([first.index, mondays], names=["player_id", "monday"]).to_frame(
        index=False
    )
    pairs = pairs[pairs["monday"] > pairs["player_id"].map(first)].sort_values("monday")
    fwd = pd.merge_asof(
        pairs, right, left_on="monday", right_on="tip_utc", by="player_id", direction="forward"
    )
    back = pd.merge_asof(                                  # strictly before the moment
        pairs, right, left_on="monday", right_on="tip_utc", by="player_id", direction="backward",
        allow_exact_matches=False,
    )
    use_fwd = np.broadcast_to(fwd["tip_utc"].notna().to_numpy()[:, None], fwd.shape)
    out = fwd.where(use_fwd, back)
    # His team is the one he last played for before the moment, never the next game's (a trade
    # would otherwise show up early; audit F03).
    out["team_id"] = back["team_id"].where(back["tip_utc"].notna(), out["team_id"]).to_numpy()
    return out.drop(columns=["tip_utc"]).dropna(subset=["min_played_ewma"])


def live_rows(built: pd.DataFrame, schedule: pd.DataFrame, season: int) -> pd.DataFrame:
    """Projection inputs made the live way for `season`: each Monday (from the season's second),
    every player's state as of that Monday (monday_states) on every game his team plays that
    Monday-Sunday week, whether or not he played. Carries the actual outcome columns (y_*), 0 for
    a game he missed, and `week` (the Monday). Ready for BaselineModel.predict."""
    b = built[built["season"] == season]
    sched = schedule[schedule["season"] == season] if "season" in schedule else schedule
    if b.empty or sched.empty:
        return pd.DataFrame()
    days = pd.to_datetime(sched["date"])
    first = days.min() - pd.Timedelta(days=days.min().weekday()) + pd.Timedelta(days=7)
    mondays = [
        pd.Timestamp(m).tz_localize(ET).tz_convert("UTC") for m in pd.date_range(first, days.max(), freq="7D")
    ]
    states = monday_states(b, mondays)
    states["week"] = states["monday"].dt.tz_convert(ET).dt.date.astype(str)
    g = sched.assign(
        date=days.dt.date, week=(days - pd.to_timedelta(days.dt.weekday, unit="D")).dt.date.astype(str)
    )
    rows = g.merge(states, on=["team_id", "week"])
    if rows.empty:
        return pd.DataFrame()
    ycols = ["y_minutes", *[f"y_{s}" for s in RATE_STATS]]
    act = b.set_index(["player_id", "game_id"])[ycols]
    y = act.reindex(pd.MultiIndex.from_frame(rows[["player_id", "game_id"]])).fillna(0.0).to_numpy()
    rows[ycols] = y
    return rows.assign(play_prob=rows["play_rate_ewma"], season_games=10_000)


CONTEXT_COLUMNS = ["days_rest", "back_to_back", "opp_pace_r10", "opp_drtg_r10"]


def game_context(rows: pd.DataFrame, schedule: pd.DataFrame, team_ctx: pd.DataFrame,
                 cutoff: pd.Timestamp | pd.Series | None = None) -> pd.DataFrame:
    """Add the next game's context to projection rows (team_id, game_id, date): opp_team_id,
    days_rest and back_to_back from the team's schedule, and the opponent's pace / defense over its
    previous 10 games, counting only games tipped before `cutoff` (when the projection is made;
    without one, before each game, as the feature table does). Nothing after the cutoff is used."""
    if rows.empty:
        empty = {c: pd.Series(dtype=float) for c in ("opp_team_id", *CONTEXT_COLUMNS)}
        return rows.assign(**empty)
    s = schedule[["team_id", "game_id", "date"]].drop_duplicates()
    s = s.assign(date=pd.to_datetime(s["date"])).sort_values(["team_id", "date"])
    s["days_rest"] = s.groupby("team_id")["date"].diff().dt.days
    opp = s[["game_id", "team_id"]].rename(columns={"team_id": "opp_team_id"})
    pairs = s.merge(opp, on="game_id")
    keep_cols = ["team_id", "game_id", "opp_team_id", "days_rest"]
    pairs = pairs.loc[pairs["team_id"] != pairs["opp_team_id"], keep_cols]
    out = rows.drop(columns=[c for c in ("opp_team_id", *CONTEXT_COLUMNS) if c in rows]).merge(
        pairs, on=["team_id", "game_id"], how="left")
    out["back_to_back"] = out["days_rest"] == 1
    tc = team_ctx.sort_values(["team_id", "tip_utc"]).copy()
    for col in ("pace", "def_rating"):                   # rolling mean including each finished game
        tc[f"{col}_r10"] = tc.groupby("team_id")[col].transform(
            lambda x: x.rolling(10, min_periods=3).mean())
    game_tip = pd.to_datetime(out["date"]).dt.tz_localize(ET).dt.tz_convert("UTC")
    if cutoff is None:
        asof = game_tip
    elif isinstance(cutoff, pd.Series):                  # a cutoff per row (e.g. each row's Monday)
        asof = np.minimum(game_tip, pd.to_datetime(cutoff.reindex(rows.index).to_numpy(), utc=True))
    else:
        asof = np.minimum(game_tip, pd.Timestamp(cutoff).tz_convert("UTC"))
    left = out.assign(_asof=asof - pd.Timedelta(seconds=1), _i=np.arange(len(out)))
    left = left.dropna(subset=["opp_team_id"])
    left = left.astype({"opp_team_id": tc["team_id"].dtype}).sort_values("_asof")
    right = tc[["team_id", "tip_utc", "pace_r10", "def_rating_r10"]].rename(
        columns={"team_id": "opp_team_id", "pace_r10": "opp_pace_r10", "def_rating_r10": "opp_drtg_r10"})
    m = pd.merge_asof(left, right.sort_values("tip_utc"), left_on="_asof", right_on="tip_utc",
                      by="opp_team_id", direction="backward")
    for col in ("opp_pace_r10", "opp_drtg_r10"):
        out[col] = pd.Series(m[col].to_numpy(), index=m["_i"].to_numpy()).reindex(range(len(out))).to_numpy()
    return out

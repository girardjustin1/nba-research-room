"""Baseline projection: EWMA per-minute rates x projected minutes x P(plays). Every later model
must beat this out of sample before it drives recommendations.

Inputs: the feature table (features.py), the preseason pool (ingest.external_proj) as a prior,
optional play probability / minutes caps (overrides.py), settings.baseline.
Outputs: long rows [player_id, game_id, date, stat, mean, sd, p_play, minutes_mean, source].
Tables: reads game_logs/games/advanced_stats (via features), players, games; writes projections.

Per game, for stat s with per-minute EWMA rate r_s and minutes-when-playing m:
  if played:  mean_s = r_s x m, variance = phi_s x mean_s   (over-dispersed counts; phi fitted)
  P(plays) = p (play-rate EWMA, or an override)
  unconditional mean = p x mean_s; variance = p (phi_s mean_s + mean_s^2) - (p mean_s)^2
Early season, the in-season line is shrunk toward the preseason projection with weight
n / (n + preseason_prior_games), n = games played this season. With no NBA history the
preseason projection is used alone and `source` says so; with neither, no row is produced.
"""

from __future__ import annotations

from datetime import date, datetime

import duckdb
import numpy as np
import pandas as pd

from research_room import features, store
from research_room.config import Settings, settings
from research_room.draft.value import NBA_REGULAR_SEASON_GAMES

STATS = ("pts", "reb", "ast", "stl", "blk", "fg3m", "tov", "fgm", "fga", "ftm", "fta")
FAR_FUTURE = pd.Timestamp("2100-01-01T00:00:00Z")


class BaselineModel:
    """EWMA baseline. `fit` estimates each stat's over-dispersion; `predict` projects games."""

    name = "baseline"

    def __init__(self, cfg: Settings | None = None) -> None:
        self.cfg = cfg or settings()
        self.phi: dict[str, float] = {}

    def fit(self, train: pd.DataFrame) -> BaselineModel:
        """phi_s = sum((y - pred)^2) / sum(pred) over played games with a prediction (given the
        actual minutes, so phi measures per-minute noise, not minutes error)."""
        played = train[train["y_did_play"].astype(bool) & train["min_played_ewma"].notna()]
        for s in (*STATS, "minutes"):
            if s == "minutes":
                pred, y = played["min_played_ewma"], played["y_minutes"]
            else:
                pred, y = played[f"{s}_pm_ewma"] * played["y_minutes"], played[f"y_{s}"]
            ok = pred.notna() & (pred > 0)
            self.phi[s] = float(((y[ok] - pred[ok]) ** 2).sum() / pred[ok].sum()) if ok.any() else 1.0
        return self

    def predict(self, df: pd.DataFrame) -> pd.DataFrame:
        """`df` rows: player_id, game_id, date, min_played_ewma, <stat>_pm_ewma, play_prob,
        season_games; optional prior columns prior_minutes, prior_<stat>; optional minutes_cap."""
        if not self.phi:
            raise RuntimeError("fit() the baseline before predict()")
        b = self.cfg.baseline
        n = df.get("season_games", pd.Series(0, index=df.index)).fillna(0)
        w = n / (n + b.preseason_prior_games)
        has_ewma = df["min_played_ewma"].notna()
        has_prior = df.get("prior_minutes", pd.Series(np.nan, index=df.index)).notna()
        w = np.where(has_ewma & has_prior, w, np.where(has_ewma, 1.0, 0.0))
        # P(plays): last season's play rate is not this season's (end-of-season rest, injuries
        # healed), so early on it blends toward the preseason games projection. An override, when
        # present (`play_prob_override`), wins outright.
        recent = df["play_prob"]
        prior_p = df.get("prior_games", pd.Series(np.nan, index=df.index)) / NBA_REGULAR_SEASON_GAMES
        blended = np.where(has_prior & recent.notna(), w * recent.fillna(0) + (1 - w) * prior_p,
                           np.where(has_prior, prior_p, recent))
        ov = pd.to_numeric(df.get("play_prob_override", pd.Series(np.nan, index=df.index)),
                           errors="coerce")
        p = pd.Series(np.where(ov.notna(), ov, blended), index=df.index)
        p = p.clip(lower=b.min_play_prob, upper=1.0).fillna(0.0)
        m = np.where(has_ewma, df["min_played_ewma"], 0.0) * w + np.where(
            has_prior, df.get("prior_minutes", 0.0), 0.0) * (1 - w)
        m = np.asarray(m, dtype=float)
        cap = df.get("minutes_cap")
        scale = np.ones(len(df))
        if cap is not None:
            capped = np.minimum(m, pd.to_numeric(cap, errors="coerce").fillna(np.inf).to_numpy(float))
            scale = np.where(m > 0, capped / np.where(m > 0, m, 1), 1.0)
            m = capped
        source = np.where(has_ewma & has_prior, "ewma+preseason", np.where(has_ewma, "ewma", "preseason"))
        rows = []
        usable = (has_ewma | has_prior).to_numpy()
        base = df.loc[usable, ["player_id", "game_id", "date"]].reset_index(drop=True)
        pu, mu_min = p[usable].to_numpy(float), m[usable]
        for s in (*STATS, "minutes"):
            if s == "minutes":
                cond = mu_min
            else:
                ew = (df[f"{s}_pm_ewma"] * df["min_played_ewma"]).to_numpy()
                prior = df.get(f"prior_{s}", pd.Series(np.nan, index=df.index)).to_numpy()
                cond = (np.where(has_ewma, ew, 0.0) * w + np.where(has_prior, prior, 0.0) * (1 - w)) * scale
                cond = np.nan_to_num(cond[usable])
            phi = self.phi.get(s, 1.0)
            mean = pu * cond
            var = pu * (phi * cond + cond ** 2) - mean ** 2
            rows.append(base.assign(stat=s, mean=mean, sd=np.sqrt(np.clip(var, 0, None)), p_play=pu,
                                    minutes_mean=pu * mu_min, source=source[usable]))
        return pd.concat(rows, ignore_index=True)


# ------------------------------------------------------------------ upcoming games
def current_states(con: duckdb.DuckDBPyConnection, cfg: Settings | None = None) -> pd.DataFrame:
    """Each player's feature state after his latest game (one dummy future row per player)."""
    cfg = cfg or settings()
    seasons = sorted({*cfg.bdl.backfill_seasons, cfg.season.nba_season})
    logs = features.load_logs(con, seasons)
    last = logs.sort_values("tip_utc").groupby("player_id").tail(1)
    dummy = last.assign(game_id=-last["player_id"], tip_utc=FAR_FUTURE, minutes=0.0, did_play=False,
                        usage_pct=np.nan, season=cfg.season.nba_season,
                        game_date=FAR_FUTURE.date())
    for s in features.RATE_STATS:
        dummy[s] = 0.0
    built = features.build(pd.concat([logs, dummy], ignore_index=True),
                           features.team_context(con, seasons), cfg)
    state = built[built["game_id"] < 0].copy()
    season_games = logs[(logs["season"] == cfg.season.nba_season) & logs["did_play"]] \
        .groupby("player_id").size().rename("season_games")
    season_last = logs[logs["did_play"]].groupby("player_id")["season"].max().rename("season_last")
    out = state.drop(columns="season").merge(season_games, on="player_id", how="left")
    return out.merge(season_last, on="player_id", how="left").fillna({"season_games": 0})


def upcoming_rows(con: duckdb.DuckDBPyConnection, start: date, end: date,
                  cfg: Settings | None = None) -> pd.DataFrame:
    """One row per (player on a current NBA roster, his team's game) between start and end."""
    cfg = cfg or settings()
    return con.execute("""
        SELECT p.player_id, g.game_id, g.game_date AS date, p.team_id,
               (g.home_team_id = p.team_id) AS home
        FROM games g JOIN players p ON p.team_id IN (g.home_team_id, g.visitor_team_id)
        WHERE g.season = ? AND g.game_date BETWEEN ? AND ? AND NOT g.postseason
          AND coalesce(g.status_state, '') <> 'final'
    """, [cfg.season.nba_season, start, end]).df()


def project_window(con: duckdb.DuckDBPyConnection, start: date, end: date,
                   cfg: Settings | None = None, overrides: pd.DataFrame | None = None,
                   prior: pd.DataFrame | None = None, model: BaselineModel | None = None) -> pd.DataFrame:
    """Baseline projections for every rostered player's games in [start, end].

    `overrides`: player_id, date, play_prob, minutes_cap (from overrides.py) take precedence.
    `prior`: the preseason pool (player_id, minutes_pg, <stat>_mean) for early-season shrinkage.
    """
    cfg = cfg or settings()
    if model is None:
        seasons = sorted(cfg.bdl.backfill_seasons)
        train = features.build(features.load_logs(con, seasons), features.team_context(con, seasons), cfg)
        model = BaselineModel(cfg).fit(train)
    games = upcoming_rows(con, start, end, cfg)
    games["date"] = pd.to_datetime(games["date"]).dt.date          # one date type for every join
    state = current_states(con, cfg)
    keep = ["player_id", "min_played_ewma", "play_rate_ewma", "season_games",
            *[f"{s}_pm_ewma" for s in STATS]]
    # Current players only: played last season or this one, or in the preseason pool.
    recent_ids = set(state.loc[state["season_last"] >= cfg.season.nba_season - 1, "player_id"])
    if prior is not None:
        recent_ids |= set(prior["player_id"])
    df = games[games["player_id"].isin(recent_ids)].merge(state[keep], on="player_id", how="left")
    df["play_prob"] = df["play_rate_ewma"]
    if prior is not None:
        pr = prior[["player_id", "minutes_pg", "games", *[f"{s}_mean" for s in STATS]]].rename(
            columns={"minutes_pg": "prior_minutes", "games": "prior_games",
                     **{f"{s}_mean": f"prior_{s}" for s in STATS}})
        df = df.merge(pr, on="player_id", how="left")
    if overrides is not None and not overrides.empty:
        ov = overrides[["player_id", "date", "play_prob", "minutes_cap"]].rename(
            columns={"play_prob": "play_prob_override"})
        ov = ov.assign(date=pd.to_datetime(ov["date"]).dt.date)
        df = df.merge(ov, on=["player_id", "date"], how="left")
    return model.predict(df)


def write_projections(con: duckdb.DuckDBPyConnection, proj: pd.DataFrame, model_name: str,
                      run_at: datetime | None = None) -> int:
    """Store mean and sd (never a point estimate alone) in `projections`."""
    rows = proj[["player_id", "date", "stat", "mean", "sd"]].assign(
        model=model_name, run_at=run_at or store.utcnow())
    return store.upsert(con, "projections", rows)

"""Team-week variance calibration for the matchup simulator.

Inputs: the feature table (features.py), a projection model with fit/predict (the baseline),
settings.simulation, settings.categories.
Outputs: one variance multiplier per category, so that a team's projected weekly total (10
players, Monday-Sunday) has an 80% band that covers ~80% of real weeks; plus out-of-sample
coverage before and after. Tables: writes sim_calibration, sim_correlation and model_scores (model
"baseline_team_week"); reads nothing directly.

Why: simulate.py treats games and players as independent, and the model's per-game spread is
fitted player by player. Checked on 2025-26 out of sample, team weekly totals came out
overconfident (only 66-76% of real weeks inside the 80% band for PTS, REB, AST, FGM/FGA), so
P(win category) was too sure of itself. The multiplier is fitted on earlier seasons only and
scored on the latest one.

Method: per week, sample random teams of `team_size` from the top `team_pool` players by
projected points; for each category compute z = (actual - projected) / sd with the simulator's
own variance formula (sum of game variances; the binomial term for FG% / FT%); the multiplier k
makes P(|z| <= 1.2816 sqrt(k)) = 0.80 on the training seasons.
"""

from __future__ import annotations

from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from research_room import features, schedule, store
from research_room.config import Settings, settings
from research_room.projections.baseline import STATS, BaselineModel

ET = ZoneInfo("America/New_York")
Z80 = 1.2815515655446004  # half-width of a central 80% normal band, in sd
MODEL = "baseline_team_week"


def player_weeks(model, rows: pd.DataFrame) -> pd.DataFrame:
    """Per player and Monday-Sunday week: projected mean / variance and the actual total, per stat,
    plus the simulator's binomial term for the percentage categories."""
    df = rows.assign(date=rows["game_date"], play_prob=rows["play_rate_ewma"], season_games=10_000)
    p = model.predict(df).pivot_table(index=["player_id", "game_id"], columns="stat", values=["mean", "sd"])
    a = rows.set_index(["player_id", "game_id"]).loc[p.index]
    g = pd.DataFrame(
        {
            "player_id": p.index.get_level_values(0),
            "week": pd.to_datetime(a["game_date"]).dt.to_period("W-SUN").astype(str).to_numpy(),
        }
    )
    for s in STATS:
        g[f"{s}_mu"] = p[("mean", s)].to_numpy()
        g[f"{s}_v"] = p[("sd", s)].to_numpy() ** 2
        g[f"{s}_y"] = a[f"y_{s}"].to_numpy(float)
    for made, att in (("fgm", "fga"), ("ftm", "fta")):
        pct = np.where(g[f"{att}_mu"] > 0, g[f"{made}_mu"] / g[f"{att}_mu"].where(g[f"{att}_mu"] > 0, 1), 0)
        g[f"{made}_bin"] = g[f"{att}_mu"] * pct * (1 - pct)
    return g.groupby(["player_id", "week"]).sum().reset_index()


def live_player_weeks(model, built: pd.DataFrame, schedule: pd.DataFrame, season: int) -> pd.DataFrame:
    """Player-weeks projected the live way for `season` (features.live_rows: Monday state x every
    game his team plays that week); actual totals count 0 for games he missed."""
    rows = features.live_rows(built, schedule, season)
    if rows.empty:
        return pd.DataFrame()
    pred = model.predict(rows)
    p = pred.pivot_table(index=["player_id", "game_id"], columns="stat", values=["mean", "sd"])
    a = rows.drop_duplicates(["player_id", "game_id"]).set_index(["player_id", "game_id"]).reindex(p.index)
    out = pd.DataFrame({"player_id": p.index.get_level_values(0), "week": a["week"].to_numpy()})
    for s in STATS:
        out[f"{s}_mu"] = p[("mean", s)].to_numpy()
        out[f"{s}_v"] = p[("sd", s)].to_numpy() ** 2
        out[f"{s}_y"] = a[f"y_{s}"].to_numpy(float)
    for made, att in (("fgm", "fga"), ("ftm", "fta")):
        pct = np.where(
            out[f"{att}_mu"] > 0, out[f"{made}_mu"] / out[f"{att}_mu"].where(out[f"{att}_mu"] > 0, 1), 0
        )
        out[f"{made}_bin"] = out[f"{att}_mu"] * pct * (1 - pct)
    return out.groupby(["player_id", "week"]).sum().reset_index()


monday_states = features.monday_states  # moved to features (kept for callers)


def team_z(weeks: pd.DataFrame, cfg: Settings, seed: int) -> pd.DataFrame:
    """z per category for random teams (rows), using the simulator's variance formulas."""
    sim = cfg.simulation
    rng = np.random.default_rng(seed)
    pools = [
        g.nlargest(sim.team_pool, "pts_mu")
        for _, g in weeks.groupby("week")
        if len(g) >= sim.min_players_per_week
    ]
    if not pools:
        return pd.DataFrame()
    which = rng.integers(len(pools), size=sim.calibration_teams)
    sums = []
    for i in which:
        pool = pools[i]
        idx = rng.choice(len(pool), size=min(sim.team_size, len(pool)), replace=False)
        sums.append(pool.iloc[idx].drop(columns=["player_id", "week"]).sum())
    t = pd.DataFrame(sums)
    out = {}
    for cat in cfg.categories:
        if cat.kind == "pct":
            mu = t[f"{cat.made}_mu"] / t[f"{cat.attempts}_mu"]
            y = t[f"{cat.made}_y"] / t[f"{cat.attempts}_y"]
            sd = np.sqrt(t[f"{cat.made}_bin"]) / t[f"{cat.attempts}_mu"]
        else:
            mu, y, sd = t[f"{cat.key}_mu"], t[f"{cat.key}_y"], np.sqrt(t[f"{cat.key}_v"])
        out[cat.key] = ((y - mu) / sd).where(sd > 0)
    return pd.DataFrame(out)


def multiplier(z: pd.Series) -> float:
    """k such that P(|z| <= Z80 sqrt(k)) = 0.80."""
    z = z.dropna().abs()
    return float((np.quantile(z, 0.80) / Z80) ** 2) if len(z) else 1.0


def coverage(z: pd.Series, k: float = 1.0) -> float:
    z = z.dropna()
    return float((z.abs() <= Z80 * np.sqrt(k)).mean()) if len(z) else float("nan")


def calibrate(
    built: pd.DataFrame,
    cfg: Settings | None = None,
    test_season: int | None = None,
    model_cls=BaselineModel,
    schedule: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Fit multipliers on the seasons before `test_season`; score raw and calibrated coverage on it.
    With `schedule` (team_id, game_id, date, season) the player-weeks are built the live way
    (live_player_weeks: Monday states onto every scheduled game, missed games count 0), so
    unexpected absences are in the spread; without it, from games played (the older method,
    which leaves them out). Returns one row per category."""
    cfg = cfg or settings()
    built = built[built["min_played_ewma"].notna()] if schedule is None else built
    seasons = sorted(built["season"].unique())
    test_season = test_season or seasons[-1]
    train = built[built["season"] < test_season]
    test = built[built["season"] == test_season]
    model = model_cls(cfg).fit(train[train["min_played_ewma"].notna()])
    if schedule is not None:
        model.fit_minutes(built, schedule, sorted(train["season"].unique()))
    if schedule is None:
        w_train, w_test = player_weeks(model, train), player_weeks(model, test)
    else:
        w_train = pd.concat(
            [live_player_weeks(model, built, schedule, s) for s in sorted(train["season"].unique())],
            ignore_index=True,
        )
        w_test = live_player_weeks(model, built, schedule, test_season)
    z_train = team_z(w_train, cfg, cfg.simulation.seed)
    z_test = team_z(w_test, cfg, cfg.simulation.seed + 1)
    lo, hi = cfg.simulation.multiplier_bounds
    rows = []
    for cat in cfg.categories:
        raw = multiplier(z_train[cat.key])
        k = float(np.clip(raw, lo, hi))
        rows.append(
            {
                "category": cat.key,
                "raw_multiplier": raw,
                "multiplier": k,
                "coverage_raw": coverage(z_test[cat.key]),
                "coverage_80": coverage(z_test[cat.key], k),
                "n_teams": int(z_test[cat.key].notna().sum()),
                "train_seasons": ",".join(str(s) for s in sorted(train["season"].unique())),
                "test_season": int(test_season),
            }
        )
    dates = pd.to_datetime(test["game_date"])
    out = pd.DataFrame(rows).assign(window_start=dates.min().date(), window_end=dates.max().date())
    out.attrs["corr"] = correlation(z_train, cfg)
    return out


def correlation(z: pd.DataFrame, cfg: Settings) -> pd.DataFrame:
    """Correlation of team-week residuals between categories, in the "good for me" direction
    (TO flipped), so the simulator can draw the nine category edges together."""
    zz = z.copy()
    for c in cfg.categories:
        if not c.higher_is_better:
            zz[c.key] = -zz[c.key]
    keys = [c.key for c in cfg.categories]
    return zz[keys].dropna().corr()


def run(con, cfg: Settings | None = None) -> pd.DataFrame:
    cfg = cfg or settings()
    seasons = sorted(cfg.bdl.backfill_seasons)
    built = features.build(features.load_logs(con, seasons), features.team_context(con, seasons), cfg)
    return calibrate(built, cfg, schedule=season_schedule(con))


def season_schedule(con) -> pd.DataFrame:
    return schedule.season_schedule(con)


def write(con, cal: pd.DataFrame) -> int:
    """Store the multipliers (sim_calibration) and the calibrated coverage (model_scores)."""
    now = store.utcnow()
    store.upsert(
        con,
        "sim_calibration",
        cal.assign(model="baseline", fitted_at=now)[
            ["model", "category", "fitted_at", "multiplier", "raw_multiplier", "train_seasons", "n_teams"]
        ],
    )
    corr = cal.attrs.get("corr")
    if corr is not None:
        long = corr.stack().rename("rho").rename_axis(["cat_a", "cat_b"]).reset_index()
        store.upsert(con, "sim_correlation", long.assign(model="baseline", fitted_at=now))
    scores = pd.DataFrame(
        {
            "model": MODEL,
            "stat": cal["category"],
            "window_start": cal["window_start"],
            "window_end": cal["window_end"],
            "run_at": now,
            "mae": np.nan,
            "rmse": np.nan,
            "coverage_80": cal["coverage_80"],
            "n": cal["n_teams"],
            "beats_baseline": None,
        }
    )
    return store.upsert(con, "model_scores", scores)


def load_correlation(con, cfg: Settings | None = None, model: str = "baseline") -> np.ndarray | None:
    """Latest category correlation as a matrix in settings order, or None if not fitted yet."""
    cfg = cfg or settings()
    df = con.execute(
        """
        SELECT cat_a, cat_b, rho FROM sim_correlation
        WHERE model = ? AND fitted_at = (SELECT max(fitted_at) FROM sim_correlation WHERE model = ?)
    """,
        [model, model],
    ).df()
    if df.empty:
        return None
    keys = [c.key for c in cfg.categories]
    m = df.pivot(index="cat_a", columns="cat_b", values="rho").reindex(index=keys, columns=keys)
    return None if m.isna().any().any() else m.to_numpy(float)


def load_multipliers(con, model: str = "baseline") -> dict[str, float]:
    """Latest fitted multiplier per category (empty: none fitted yet -> the simulator uses 1)."""
    rows = con.execute(
        """
        SELECT category, multiplier FROM sim_calibration
        WHERE model = ? AND fitted_at = (SELECT max(fitted_at) FROM sim_calibration WHERE model = ?)
    """,
        [model, model],
    ).fetchall()
    return {c: float(k) for c, k in rows}

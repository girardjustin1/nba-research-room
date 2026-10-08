"""Model bake-off: baseline, LightGBM, Ridge, CatBoost, hierarchical and their ensemble (read only).

Usage: make bakeoff   (about 20-30 minutes; prints the table, saves data/bakeoff/<date>/)

Nested, so the test season is touched once (audit F14):
1. Weights: every member is fitted on the first season and predicts the second; the ensemble's
   per-stat weights come from those errors (projections/ensemble.py).
2. Test: every member is refitted on the first two seasons and predicts the third, the blend uses
   the stage-1 weights, and all are scored against what happened.
Scored like the model scoreboard (scoreboard.evaluate): every game of a player with a pre-game
state, a game he sat counting 0, no game-day news (play rate only). MAE, RMSE and 80% band coverage
per stat; each challenger's MAE and RMSE change against the baseline, the MAE change with a 95%
range from resampling whole game days (games the same night share news and schedules, so they are
not independent); and how many predicted stat lines have makes above attempts (audit A03).
`position` is today's players table, used for every season: a fixed proxy, not a dated history
(audit A07), so a player whose listed position changed is grouped by the current one throughout.
"""

from __future__ import annotations

import json
import sys
import time
from datetime import date

import numpy as np
import pandas as pd

from research_room import features, store
from research_room.config import settings
from research_room.projections import ensemble
from research_room.projections.baseline import BaselineModel
from research_room.projections.catboost_model import CatBoostModel
from research_room.projections.hier import HierModel
from research_room.projections.lgbm import LgbmModel
from research_room.projections.ridge import RidgeModel

Z80 = 1.2815515655446004
MEMBERS = {
    "baseline": BaselineModel,
    "lgbm": LgbmModel,
    "ridge": RidgeModel,
    "catboost": CatBoostModel,
    "hier": HierModel,
}
SHOWN = ["minutes", "pts", "reb", "ast", "stl", "blk", "fg3m", "tov", "fga", "fta"]


def rows_for(df: pd.DataFrame) -> pd.DataFrame:
    return df.assign(date=df["game_date"], play_prob=df["play_rate_ewma"], season_games=10_000)


def fit_predict(cfg, names, train, test, echo):
    preds, fitted = {}, {}
    for n in names:
        t0 = time.perf_counter()
        m = MEMBERS[n](cfg).fit(train)
        preds[n] = m.predict(rows_for(test))
        fitted[n] = m
        echo(f"  {n}: fitted and predicted in {time.perf_counter() - t0:.0f}s")
    return preds, fitted


def score(pred: pd.DataFrame, test: pd.DataFrame) -> pd.DataFrame:
    """Per player-game-stat: error and whether the outcome is inside the 80% band."""
    act = test.set_index(["player_id", "game_id"])
    p = pred.set_index(["player_id", "game_id"])
    out = []
    for s in SHOWN:
        q = p[p["stat"] == s]
        y = act["y_minutes" if s == "minutes" else f"y_{s}"].reindex(q.index)
        ok = y.notna() & q["mean"].notna()
        q, y = q[ok], y[ok]
        out.append(
            pd.DataFrame(
                {
                    "stat": s,
                    "err": (y - q["mean"]).to_numpy(),
                    "inside": ((y - q["mean"]).abs() <= Z80 * q["sd"]).to_numpy(),
                    "date": pd.to_datetime(q["date"]).dt.date.to_numpy(),
                },
                index=q.index,
            )
        )
    return pd.concat(out)


def main() -> int:
    cfg = settings()
    echo = lambda m: print(m, flush=True)  # noqa: E731
    con = store.connect(read_only=True)
    seasons = sorted(cfg.bdl.backfill_seasons)
    if len(seasons) < 3:
        print("needs three backfilled seasons (weights, then test)")
        return 1
    built = features.build(features.load_logs(con, seasons), features.team_context(con, seasons), cfg)
    pos = con.execute("SELECT player_id, position FROM players").df()
    con.close()
    built = built.merge(pos, on="player_id", how="left")
    s0, s1, s2 = seasons[-3:]
    names = [n for n in cfg.models.ensemble.members if n in MEMBERS]
    has = built["min_played_ewma"].notna()

    echo(f"stage 1: fit on {s0}, weights from {s1}")
    val = built[(built["season"] == s1) & has]
    vpreds, _ = fit_predict(cfg, names, built[built["season"] == s0], val, echo)
    weights = ensemble.fit_weights(vpreds, val, cfg)

    echo(f"stage 2: fit on {s0}-{s1}, test on {s2}")
    test = built[(built["season"] == s2) & has]
    tpreds, _ = fit_predict(cfg, names, built[built["season"].isin([s0, s1])], test, echo)
    tpreds["ensemble"] = ensemble.blend(tpreds, weights)

    scored = {n: score(p, test) for n, p in tpreds.items()}
    base = scored["baseline"]
    rng = np.random.default_rng(0)
    table = []
    for n, sc in scored.items():
        for s in SHOWN:
            a, b = sc[sc["stat"] == s], base[base["stat"] == s]
            mae, rmse = float(a["err"].abs().mean()), float(np.sqrt((a["err"] ** 2).mean()))
            row = {
                "model": n,
                "stat": s,
                "mae": mae,
                "rmse": rmse,
                "coverage_80": float(a["inside"].mean()),
                "n": int(len(a)),
            }
            if n != "baseline":
                brmse = float(np.sqrt((b["err"] ** 2).mean()))
                row["rmse_change_pct"] = 100 * (rmse - brmse) / brmse
                d = (a["err"].abs() - b["err"].abs().reindex(a.index)).to_frame("d").assign(date=a["date"])
                by_day = d.groupby("date")["d"].agg(["sum", "size"])
                sums, cnt = by_day["sum"].to_numpy(), by_day["size"].to_numpy()
                boot = [
                    sums[i].sum() / cnt[i].sum()
                    for i in (rng.integers(0, len(sums), len(sums)) for _ in range(1000))
                ]
                bm = float(b["err"].abs().mean())
                row |= {
                    "mae_change_pct": 100 * float(d["d"].mean()) / bm,
                    "change_95": [
                        100 * float(np.percentile(boot, 2.5)) / bm,
                        100 * float(np.percentile(boot, 97.5)) / bm,
                    ],
                }
            table.append(row)
    df = pd.DataFrame(table)
    pd.set_option("display.width", 160)
    piv = df.pivot_table(index="stat", columns="model", values="mae_change_pct").reindex(SHOWN).round(2)
    print("\nMAE change vs the baseline (%), test season, negative is better:")
    print(piv.to_string())
    rpiv = df.pivot_table(index="stat", columns="model", values="rmse_change_pct").reindex(SHOWN).round(2)
    print("\nRMSE change vs the baseline (%), same games, negative is better:")
    print(rpiv.to_string())
    print("\nPredicted makes above attempts (rows), test season:")
    for n, p in tpreds.items():
        w = p.pivot_table(index=["player_id", "game_id"], columns="stat", values="mean")
        pairs = (("fgm", "fga"), ("ftm", "fta"), ("fg3m", "fgm"))
        bad = {m: int((w[m] > w[t] + 1e-9).sum()) for m, t in pairs if m in w and t in w}
        print(f"  {n:<9} " + ", ".join(f"{m} {c}" for m, c in bad.items()))
    print("\n95% ranges (resampling game days), ensemble:")
    for r in df[df["model"] == "ensemble"].itertuples():
        print(
            f"  {r.stat:<8} {r.mae_change_pct:+.2f}%  [{r.change_95[0]:+.2f}, {r.change_95[1]:+.2f}]"
            f"  coverage {r.coverage_80:.3f}"
        )
    print("\nensemble weights (stage 1):")
    for s in SHOWN:
        if s in weights:
            print(f"  {s:<8} " + ", ".join(f"{n} {w:.2f}" for n, w in weights[s].items()))
    out = settings().paths.db.resolve().parent / "bakeoff" / date.today().isoformat()
    out.mkdir(parents=True, exist_ok=True)
    df.to_json(out / "scores.json", orient="records", indent=1)
    (out / "weights.json").write_text(json.dumps(weights, indent=1))
    print(f"\nsaved to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

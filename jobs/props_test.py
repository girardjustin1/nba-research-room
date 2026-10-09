"""The props test: last season's Kalshi pre-tip prices against the baseline, both if he plays.

Usage: make props-test                       (fetches what the cache lacks, then scores)
       make props-test ARGS="--offline"      (the cache only, no network)

The rule, written in DECISIONS.md before the run ("Props test for threes, steals and blocks",
2026-10-09): a seeded sample of 2025-26 regular-season games with Kalshi prop events; per rung,
the last hourly candle before tip, liquid under the live rule; the market's mid against the
baseline's P(stat > line | plays), scored only where he played; Brier per rung with an 80% range
from resampling whole games. The market leads a judged stat only if that range lies entirely below
zero with at least 150 scored rungs. Points, rebounds and assists are scored as a reference.

Network: Kalshi's public, keyless API only (settings.markets.kalshi.base_url), at
settings.props_test.requests_per_second, backing off on 429 and 5xx. Every response is cached as
JSON under --cache (default data/props_test/kalshi_cache), so a re-run reads the cache.
Reads the store only (RESEARCH_ROOM_DB points it at a copy). Writes data/props_test/<date>/
(summary.json, rungs.csv, means.csv, unmatched.csv, listed.csv: every rung). Prints the verdict;
changes nothing.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import date, datetime
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from research_room import features, props_test, schedule, store
from research_room.config import settings
from research_room.ingest import kalshi
from research_room.ingest.market_common import GameIndex, RateLimited
from research_room.ingest.names import resolve_only
from research_room.projections.baseline import BaselineModel

STATS_SHOWN = ("fg3m", "stl", "blk", "pts", "reb", "ast")


class Archive:
    """GET Kalshi's public API through a JSON file cache."""

    def __init__(self, base_url: str, cache: Path, per_second: float, offline: bool = False) -> None:
        self.base, self.cache, self.offline = base_url.rstrip("/"), cache, offline
        self.client = RateLimited(per_second)
        self.fetched = 0

    def get(self, path: str, params: dict) -> dict:
        key = hashlib.sha1((path + json.dumps(params, sort_keys=True)).encode()).hexdigest()
        f = self.cache / key[:2] / f"{key}.json"
        if f.exists():
            return json.loads(f.read_text())
        if self.offline:
            raise RuntimeError(f"not cached (--offline): {path} {params}")
        try:
            body = self.client.get(self.base + path, params)
        except requests.HTTPError as e:
            if e.response is None or e.response.status_code not in (400, 404):
                raise
            body = {"_status": e.response.status_code}
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(body))
        self.fetched += 1
        return body

    def paged(self, path: str, params: dict, key: str) -> list[dict]:
        out, cursor = [], None
        while True:
            p = dict(params, **({"cursor": cursor} if cursor else {}))
            page = self.get(path, p)
            out += page.get(key, [])
            cursor = page.get("cursor")
            if not cursor or not page.get(key):
                return out


def _epoch(ts) -> int:
    return int(pd.Timestamp(ts).timestamp())


def candidate_games(con, arch: Archive, cfg, series: dict[str, str]) -> tuple[pd.DataFrame, dict]:
    """The season's finished regular-season games, and per game the prop event of each series."""
    pt = cfg.props_test
    games = con.execute(
        """SELECT game_id, game_date, tip_utc FROM games
           WHERE season = ? AND NOT postseason AND tip_utc IS NOT NULL AND status_state = 'final'""",
        [pt.season],
    ).df()
    known = set(games["game_id"].astype(int))
    index = GameIndex(con)
    events: dict[int, dict[str, str]] = {}
    for s in series:
        for e in arch.paged("/events", {"series_ticker": s, "status": "settled", "limit": 200}, "events"):
            parsed = kalshi.parse_event_ticker(e.get("event_ticker", ""))
            gid = index.game_id(*parsed) if parsed else None
            if gid in known:
                events.setdefault(int(gid), {})[s] = e["event_ticker"]
    return games.set_index("game_id"), events


def fetch_game(
    arch: Archive, cfg, gid: int, tip, evs: dict[str, str], series: dict[str, str]
) -> pd.DataFrame:
    """Every rung Kalshi listed for one game, with its last pre-tip quote (None if it can't have
    been liquid: under min_volume traded in its whole life, or opened after tip)."""
    tip_ts = _epoch(tip)
    out = []
    for s, ev in evs.items():
        mk = arch.paged("/historical/markets", {"event_ticker": ev, "limit": 200}, "markets")
        rows = kalshi.parse_props(mk, series[s], datetime.fromtimestamp(tip_ts), cfg)
        if rows.empty:
            continue
        by = {m["ticker"]: m for m in mk}
        quotes = []
        for r in rows.itertuples(index=False):
            m = by[r.market_ref]
            opened = _epoch(m["open_time"]) if m.get("open_time") else tip_ts - 7 * 86400
            q = None
            if (r.volume or 0) >= cfg.markets.kalshi.min_volume and opened < tip_ts:
                body = arch.get(
                    f"/historical/markets/{r.market_ref}/candlesticks",
                    {"start_ts": opened, "end_ts": tip_ts, "period_interval": 60},
                )
                q = props_test.pretip_quote(body.get("candlesticks", []), tip_ts)
            quotes.append(
                {
                    "market_ref": r.market_ref,
                    "result": m.get("result"),
                    "bid": None if q is None else q["bid"],
                    "ask": None if q is None else q["ask"],
                    "pretip_volume": None if q is None else q["volume"],
                    "p_market": props_test.liquid_mid(q, cfg),
                }
            )
        rows = rows.drop(columns=["bid", "ask", "price", "prob"])
        out.append(rows.merge(pd.DataFrame(quotes), on="market_ref"))
    if not out:
        return pd.DataFrame()
    return pd.concat(out, ignore_index=True).assign(game_id=gid)


def baseline_lines(con, cfg, game_ids: list[int]) -> pd.DataFrame:
    """The production baseline fitted on the training seasons only, projecting each sampled game
    from its pre-game state (no game-day news, as in the bake-off): its line if he plays."""
    pt = cfg.props_test
    seasons = sorted({*pt.train_seasons, pt.season})
    built = features.build(features.load_logs(con, seasons), features.team_context(con, seasons), cfg)
    train = built[built["season"].isin(pt.train_seasons)]
    model = BaselineModel(cfg).fit(train)
    if cfg.baseline.minutes_recalibration:
        model.fit_minutes(train, schedule.season_schedule(con), sorted(pt.train_seasons))
    keep = (built["season"] == pt.season) & built["min_played_ewma"].notna() & built["game_id"].isin(game_ids)
    test = built[keep]
    pred = model.predict(
        test.assign(date=test["game_date"], play_prob=test["play_rate_ewma"], season_games=10_000)
    )
    pred = pred[pred["stat"].isin(STATS_SHOWN)].copy()
    p = pred["p_play"].to_numpy(float)
    mean, sd = pred["mean"].to_numpy(float), pred["sd"].to_numpy(float)
    ok = p > 0
    mu = np.where(ok, mean / np.where(ok, p, 1.0), 0.0)                 # market.conditional, vectorized
    var_c = np.where(ok, (sd**2 + mean**2) / np.where(ok, p, 1.0) - mu**2, 0.0)
    out = pred.assign(mu=mu, sd=np.sqrt(np.clip(var_c, 0, None)))
    return out[["player_id", "game_id", "stat", "mu", "sd", "p_play"]]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--cache", type=Path, help="Kalshi response cache (default data/props_test/kalshi_cache)")
    ap.add_argument("--out", type=Path, help="results folder (default data/props_test/<today>)")
    ap.add_argument("--offline", action="store_true", help="read the cache only, never the network")
    args = ap.parse_args(argv)
    cfg = settings()
    pt = cfg.props_test
    root = cfg.paths.db.resolve().parent / "props_test"
    arch = Archive(cfg.markets.kalshi.base_url, args.cache or root / "kalshi_cache", pt.requests_per_second,
                   args.offline)
    out = args.out or root / date.today().isoformat()
    echo = lambda m: print(m, flush=True)  # noqa: E731
    stats = [*pt.judged, *pt.reference]
    series = {s: st for s, st in cfg.markets.kalshi.prop_series.items() if st in stats}

    con = store.connect(read_only=True)
    try:
        games, events = candidate_games(con, arch, cfg, series)
        listed = {st: sum(1 for e in events.values() for s in e if series[s] == st) for st in stats}
        echo(f"{len(games)} regular-season games in {pt.season}-{(pt.season + 1) % 100:02d}; "
             f"{len(events)} with a Kalshi prop event. Events per stat: {listed}")
        order = props_test.sample_order(events, pt.seed)
        n, fetched, rungs = pt.first_games, {}, pd.DataFrame()
        resolved: dict[tuple[str, str | None], int | None] = {}
        index = GameIndex(con)
        while True:
            for i, gid in enumerate(order[:n]):
                if gid not in fetched:
                    fetched[gid] = fetch_game(arch, cfg, gid, games.at[gid, "tip_utc"], events[gid], series)
                    if (i + 1) % 10 == 0:
                        echo(f"  {i + 1} games read ({arch.fetched} new requests)")
            rungs = pd.concat([fetched[g] for g in order[:n]], ignore_index=True)
            rungs["team_abbr"] = rungs["team"].map(lambda t: index.team(t) or "")
            todo = rungs[["player_name", "team_abbr"]].drop_duplicates()
            todo = todo[[(a, b) not in resolved for a, b in todo.itertuples(index=False)]]
            if not todo.empty:
                ids, _ = resolve_only(con, todo.rename(columns={"player_name": "raw_name"}))
                resolved |= dict(zip(todo.itertuples(index=False, name=None), ids.tolist(), strict=True))
            rungs["player_id"] = [resolved[(a, b)] for a, b in rungs[["player_name", "team_abbr"]].itertuples(
                index=False, name=None)]
            liquid = rungs[rungs["p_market"].notna() & rungs["player_id"].notna()]
            counts = liquid.groupby("stat").size().to_dict()
            nxt = props_test.next_size(n, counts, pt, len(order))
            echo(f"sample {n} games: liquid matched rungs {counts}")
            if nxt is None:
                break
            n = nxt
        sample = order[:n]

        rungs["player_id"] = rungs["player_id"].astype("Int64")
        unmatched = rungs[rungs["player_id"].isna()][["player_name", "team_abbr"]].drop_duplicates()
        logs = con.execute(
            f"""SELECT game_id, player_id, minutes, {", ".join(STATS_SHOWN)} FROM game_logs
                WHERE game_id IN (SELECT unnest(?))""",
            [sample],
        ).df()
        lines = baseline_lines(con, cfg, sample)
    finally:
        con.close()

    act = logs.melt(["game_id", "player_id", "minutes"], list(STATS_SHOWN), "stat", "actual")
    df = rungs[rungs["p_market"].notna() & rungs["player_id"].notna()].astype({"player_id": "int64"})
    df = df.merge(act, on=["game_id", "player_id", "stat"], how="left")
    funnel = {
        "listed": rungs.groupby("stat").size().to_dict(),
        "liquid": rungs[rungs["p_market"].notna()].groupby("stat").size().to_dict(),
        "liquid_matched": df.groupby("stat").size().to_dict(),
    }
    df = df[df["minutes"].fillna(0) > 0]
    funnel["played"] = df.groupby("stat").size().to_dict()
    df = df.merge(lines, on=["player_id", "game_id", "stat"], how="inner")
    funnel["scored"] = df.groupby("stat").size().to_dict()
    df["y"] = (df["actual"] > df["threshold"]).astype(int)
    settled = df["result"].isin(["yes", "no"])
    disagree = int(((df["result"] == "yes").astype(int) != df["y"])[settled].sum())
    df = props_test.add_baseline(df)

    order_shown = [s for s in STATS_SHOWN if s in set(df["stat"])]
    table = props_test.score(df, pt).set_index("stat").reindex(order_shown)
    calib = pd.concat([props_test.calibration(df, c).assign(source=c) for c in ("p_market", "p_base")])
    means = props_test.implied_means(df, cfg.markets.overlay.sd_bounds)
    rmse = props_test.rmse_table(means, pt).set_index("stat")

    pd.set_option("display.width", 200)
    echo(f"\nsample: {n} games (seed {pt.seed}), {df['game_id'].nunique()} with a scored rung")
    echo("funnel (rungs per stat): " + json.dumps(funnel))
    echo(f"outcome check: box score vs Kalshi's settlement disagree on {disagree} of "
         f"{int(settled.sum())} rungs")
    echo("\nBrier per rung, both if he plays (diff = market - baseline, 80% range by game):")
    cols = ["rungs", "games", "player_games", "base_rate", "brier_market", "brier_base", "diff", "lo", "hi",
            "decision"]
    echo(table[cols].round(4).to_string())
    echo("\nShown, not judged: count-family baseline, log loss, and the old baseline, "
         "P(plays) x P(over) (F17):")
    echo(table[["brier_base_count", "logloss_market", "logloss_base", "logloss_base_count", "brier_base_old",
                "diff_old", "lo_old", "hi_old"]].round(4).to_string())
    echo("\nCalibration (20-point bands):")
    echo(calib.round(3).to_string(index=False))
    echo("\nMarket-implied mean vs actual, games played (mse_diff = market - baseline, 80% range by game):")
    echo(rmse.round(3).to_string())

    out.mkdir(parents=True, exist_ok=True)
    summary = {
        "run_at": datetime.now().isoformat(timespec="seconds"),
        "season": pt.season,
        "seed": pt.seed,
        "games_in_sample": n,
        "games_with_events": len(events),
        "events_per_stat": listed,
        "funnel": funnel,
        "outcome_disagreements": disagree,
        "scores": table.reset_index().to_dict(orient="records"),
        "rmse": rmse.reset_index().to_dict(orient="records"),
        "calibration": calib.to_dict(orient="records"),
        "decisions": {s: table.at[s, "decision"] for s in pt.judged if s in table.index},
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=1, default=float))
    df.to_csv(out / "rungs.csv", index=False)
    means.to_csv(out / "means.csv", index=False)
    unmatched.to_csv(out / "unmatched.csv", index=False)
    rungs.drop(columns=["kalshi_player"], errors="ignore").to_csv(out / "listed.csv", index=False)
    echo("\ndecisions: " + ", ".join(f"{s}: {d}" for s, d in summary["decisions"].items()))
    echo(f"saved to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

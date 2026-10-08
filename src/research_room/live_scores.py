"""Live scoreboard: what the app said before each game, graded against what happened.

Inputs: projections (every stored run), game_logs and games (box scores, tips), status_events
(X), nba_report_rows (the NBA report), injuries (BallDontLie), matchup_snapshots and
yahoo_matchups (weekly odds and results), settings.
Outputs: live_scores (per game day, stat and segment: n, MAE, RMSE, bias, 80% band coverage) and
live_news_scores (per game day, source and status: listed, played), and `summary()` for the
report and the System screen. Tables: writes live_scores, live_news_scores; reads the rest.

Grading, per player-game: the latest projection run stored before that game's tip (a run after
tip is never graded), against the box score (a game he sat is 0, as projected).
- all: the stored projection (P(plays) included), every rostered player with a box-score row.
- played: his line if he plays (mean / P(plays)) on games he played.
- market / market_model: on the games where the betting market set the number, the market's
  projection and our model's own number before it; the market should keep winning
  (DECISIONS.md, market-informed projections).
- p_play: Brier score of P(plays) against whether he played; bias = mean P(plays) - played rate.
News: how often a player each source listed with a status that day actually played. X: the news
behind the last projection before tip, by account tier (x:official ...; carried statuses apart);
the NBA report: its last report before tip; BallDontLie: its last list before tip.
Weekly odds (summary only): each stored P(win week) snapshot against the week's final result
from the latest Yahoo matchup file after the week ended.
"""

from __future__ import annotations

from datetime import date, timedelta

import duckdb
import numpy as np
import pandas as pd

from research_room import schedule, store
from research_room.config import Settings, settings

Z80 = 1.2815515655446004


def graded_rows(
    con: duckdb.DuckDBPyConnection, start: date, end: date, model: str = "baseline"
) -> pd.DataFrame:
    """Per projected player-game-stat in [start, end] whose game is final: the last pre-tip
    projection and the real line. Starts from what was projected (audit F16): a projected player
    with no box-score row is kept, with `no_log`, so he is counted as ungraded, not dropped.
    His game is his current team's game that day (live grading runs nightly on recent days).
    `model`: whose projections (a shadow model's rows pair with the baseline's by run time)."""
    return con.execute(
        """
        WITH pg AS (
            SELECT DISTINCT player_id, date FROM projections
            WHERE model = ? AND date BETWEEN ? AND ?),
        gm AS (
            SELECT pg.player_id, pg.date AS game_date, g.game_id, g.tip_utc
            FROM pg JOIN players pl USING (player_id)
            JOIN games g ON g.game_date = pg.date AND pl.team_id IN (g.home_team_id, g.visitor_team_id)
            WHERE g.tip_utc IS NOT NULL AND coalesce(g.status_state, '') = 'final'),
        runs AS (
            SELECT gm.player_id, gm.game_id, max(p.run_at) AS run_at
            FROM gm JOIN projections p ON p.player_id = gm.player_id AND p.date = gm.game_date
            WHERE p.model = ? AND p.run_at < gm.tip_utc
            GROUP BY 1, 2)
        SELECT gm.player_id, gm.game_id, gm.game_date, gm.tip_utc, l.player_id IS NULL AS no_log,
               coalesce(l.did_play, false) AS did_play, l.minutes,
               l.pts, l.reb, l.ast, l.stl, l.blk, l.fg3m, l.tov, l.fgm, l.fga, l.ftm, l.fta,
               p.stat, p.mean, p.sd, p.p_play, p.model_mean, coalesce(p.market, false) AS market, r.run_at
        FROM gm JOIN runs r USING (player_id, game_id)
        JOIN projections p ON p.model = ? AND p.run_at = r.run_at AND p.player_id = gm.player_id
                          AND p.date = gm.game_date
        LEFT JOIN game_logs l ON l.game_id = gm.game_id AND l.player_id = gm.player_id
    """,
        [model, start, end, model, model],
    ).df()


def _metrics(err: np.ndarray, inside: np.ndarray | None) -> dict:
    return {
        "n": int(len(err)),
        "mae": float(np.abs(err).mean()),
        "rmse": float(np.sqrt((err**2).mean())),
        "bias": float(err.mean()),
        "coverage_80": float(inside.mean()) if inside is not None else None,
    }


def score_days(rows: pd.DataFrame) -> pd.DataFrame:
    """live_scores rows from graded_rows (pure)."""
    out = []
    if rows.empty:
        return pd.DataFrame(columns=["day", "stat", "segment", "n", "mae", "rmse", "bias", "coverage_80"])
    rows = rows.assign(day=pd.to_datetime(rows["game_date"]).dt.date)
    if "no_log" in rows:
        missing = rows[rows["no_log"].astype(bool) & (rows["stat"] == "minutes")]
        for day, g in missing.groupby("day"):
            out.append(
                {
                    "day": day,
                    "stat": "_coverage",
                    "segment": "no_box_score",
                    "n": int(len(g)),
                    "mae": None,
                    "rmse": None,
                    "bias": None,
                    "coverage_80": None,
                }
            )
        rows = rows[~rows["no_log"].astype(bool)]
    for (day, stat), g in rows.groupby(["day", "stat"]):
        col = "minutes" if stat == "minutes" else stat
        if col not in g:
            continue
        y = g[col].fillna(0.0).to_numpy(float)
        mu, sd = g["mean"].to_numpy(float), g["sd"].to_numpy(float)
        segs = {"all": (mu - y, np.abs(y - mu) <= Z80 * sd)}
        played = g["did_play"].astype(bool).to_numpy() & (g["p_play"].fillna(0).to_numpy(float) > 0)
        if played.any():
            cond = mu[played] / g["p_play"].to_numpy(float)[played]
            segs["played"] = (cond - y[played], None)
        mk = g["market"].astype(bool).to_numpy() & g["model_mean"].notna().to_numpy()
        if mk.any():
            segs["market"] = (mu[mk] - y[mk], None)
            segs["market_model"] = (g["model_mean"].to_numpy(float)[mk] - y[mk], None)
        for seg, (err, inside) in segs.items():
            out.append({"day": day, "stat": stat, "segment": seg, **_metrics(err, inside)})
        if stat == "minutes":
            p = g["p_play"].fillna(1.0).to_numpy(float)
            did = g["did_play"].astype(float).to_numpy()
            out.append(
                {
                    "day": day,
                    "stat": "p_play",
                    "segment": "brier",
                    "n": int(len(p)),
                    "mae": float(np.abs(p - did).mean()),
                    "rmse": float(np.sqrt(((p - did) ** 2).mean())),  # sqrt(Brier), pools like RMSE
                    "bias": float(p.mean() - did.mean()),
                    "coverage_80": None,
                }
            )
    return pd.DataFrame(out)


def news_rows(con: duckdb.DuckDBPyConnection, start: date, end: date) -> pd.DataFrame:
    """Per listed player-game: source, status, and whether he played."""
    have = {r[0] for r in con.execute("SELECT table_name FROM information_schema.tables").fetchall()}
    parts = []
    base = """
        SELECT l.player_id, l.game_id, l.game_date, l.did_play, gm.tip_utc
        FROM game_logs l JOIN games gm USING (game_id)
        WHERE l.game_date BETWEEN ? AND ? AND coalesce(gm.status_state, '') = 'final'"""
    proj_cols = {r[0] for r in con.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'projections'").fetchall()}
    if "news_source" in proj_cols:
        # X: the decision actually used (round-3 audit X09): the news behind the last projection
        # before tip, by account tier ("x:official"), a status carried from an earlier report
        # graded apart. Only what was known at that run counts (X10).
        parts.append(
            con.execute(
                f"""
            WITH g AS ({base}),
            r AS (SELECT g.player_id, g.game_id, max(p.run_at) AS run_at FROM g JOIN projections p
                  ON p.player_id = g.player_id AND p.date = g.game_date AND p.model = 'baseline'
                 AND p.stat = 'minutes' AND p.run_at < g.tip_utc GROUP BY 1, 2)
            SELECT p.news_source AS source,
                   CASE WHEN p.news_carried THEN p.news_status || ' (carried)' ELSE p.news_status END
                       AS status,
                   g.game_date, g.player_id, g.did_play
            FROM g JOIN r USING (player_id, game_id)
            JOIN projections p ON p.model = 'baseline' AND p.stat = 'minutes' AND p.run_at = r.run_at
                              AND p.player_id = g.player_id AND p.date = g.game_date
            WHERE p.news_source LIKE 'x:%'
        """,
                [start, end],
            ).df()
        )
    if "nba_report_rows" in have:
        parts.append(
            con.execute(
                f"""
            WITH g AS ({base}),
            pick AS (SELECT g.game_id, max(t.report_ts) AS ts FROM g JOIN nba_report_teams t
                     ON t.game_id = g.game_id AND t.report_ts < g.tip_utc GROUP BY 1)
            SELECT DISTINCT 'nba_report' AS source, r.status, g.game_date, g.player_id, g.did_play
            FROM g JOIN pick USING (game_id)
            JOIN nba_report_rows r ON r.game_id = g.game_id AND r.player_id = g.player_id
                                  AND r.report_ts = pick.ts
        """,
                [start, end],
            ).df()
        )
    parts.append(
        con.execute(
            f"""
        WITH g AS ({base}),
        snap AS (SELECT g.player_id, g.game_id, max(i.fetched_at) AS f FROM g
                 JOIN injuries i ON i.player_id = g.player_id AND i.fetched_at < g.tip_utc
                  AND i.fetched_at > g.tip_utc - INTERVAL 36 HOUR GROUP BY 1, 2)
        SELECT 'bdl' AS source, i.status, g.game_date, g.player_id, g.did_play
        FROM g JOIN snap USING (player_id, game_id)
        JOIN injuries i ON i.player_id = g.player_id AND i.fetched_at = snap.f
    """,
            [start, end],
        ).df()
    )
    parts = [p for p in parts if not p.empty]
    return (
        pd.concat(parts, ignore_index=True)
        if parts
        else pd.DataFrame(columns=["source", "status", "game_date", "player_id", "did_play"])
    )


def score_news(rows: pd.DataFrame) -> pd.DataFrame:
    if rows.empty:
        return pd.DataFrame(columns=["day", "source", "status", "listed", "played"])
    rows = rows.assign(day=pd.to_datetime(rows["game_date"]).dt.date, played=rows["did_play"].astype(int))
    return rows.groupby(["day", "source", "status"], as_index=False).agg(
        listed=("player_id", "size"), played=("played", "sum")
    )


def update(
    con: duckdb.DuckDBPyConnection,
    cfg: Settings | None = None,
    through: date | None = None,
    regrade_days: int = 3,
) -> dict:
    """Grade every finished game day not graded yet, plus the last `regrade_days` (stat fixes)."""
    cfg = cfg or settings()
    through = through or (pd.Timestamp.now(tz="America/New_York").date() - timedelta(days=1))
    last = con.execute("SELECT max(day) FROM live_scores").fetchone()[0]
    start = cfg.season.first_game_date if last is None else min(last - timedelta(days=regrade_days), through)
    if through < start:
        return {"status": "skipped", "reason": "no finished game days to grade"}
    scores = score_days(graded_rows(con, start, through))
    news = score_news(news_rows(con, start, through))
    now = store.utcnow()
    n = store.upsert(con, "live_scores", scores.assign(graded_at=now)) if not scores.empty else 0
    m = store.upsert(con, "live_news_scores", news.assign(graded_at=now)) if not news.empty else 0
    return {"status": "ok", "from": str(start), "through": str(through), "score_rows": n, "news_rows": m}


def week_results(con: duckdb.DuckDBPyConnection, cfg: Settings) -> pd.DataFrame:
    """Per finished fantasy week: my categories won and the opponent's, from the latest Yahoo
    matchup file saved after the week ended (TO: fewer wins; a tie wins for nobody)."""
    weeks = schedule.fantasy_weeks(cfg.season)
    snaps = con.execute("SELECT * FROM yahoo_matchups").df()
    if snaps.empty:
        return pd.DataFrame(columns=["week", "cats_me", "cats_opp"])
    out = []
    me = cfg.league.my_team_id
    for w in weeks.itertuples(index=False):
        end_ts = pd.Timestamp(w.end + timedelta(days=1), tz="America/New_York")
        s = snaps[(snaps["week"] == w.week) & (pd.to_datetime(snaps["snapshot_at"], utc=True) >= end_ts)]
        if s.empty:
            continue
        s = s[s["snapshot_at"] == s["snapshot_at"].max()]
        mine = s[s["team_id"] == me]
        if mine.empty:
            continue
        opp = s[s["team_id"] == int(mine["opponent_team_id"].iloc[0])]
        if opp.empty:
            continue
        a, b, won, lost = mine.iloc[0], opp.iloc[0], 0, 0
        for c in cfg.categories:
            x, y = a.get(c.key), b.get(c.key)
            if pd.isna(x) or pd.isna(y) or x == y:
                continue
            better = (x > y) if c.higher_is_better else (x < y)
            won, lost = won + better, lost + (not better)
        out.append({"week": int(w.week), "cats_me": won, "cats_opp": lost})
    return pd.DataFrame(out, columns=["week", "cats_me", "cats_opp"])


def summary(con: duckdb.DuckDBPyConnection, cfg: Settings | None = None, since: date | None = None) -> dict:
    """Season to date (or since `since`): projections by stat and segment (n-weighted), P(plays)
    Brier, each source's statuses against who played, and the weekly odds' Brier."""
    cfg = cfg or settings()
    have = {r[0] for r in con.execute("SELECT table_name FROM information_schema.tables").fetchall()}
    if "live_scores" not in have:
        return {"status": "empty"}
    since = since or cfg.season.first_game_date
    sc = con.execute("SELECT * FROM live_scores WHERE day >= ?", [since]).df()
    out: dict = {"since": str(since), "days": int(sc["day"].nunique()) if not sc.empty else 0}
    if not sc.empty:
        recs = []
        for (stat, seg), d in sc.groupby(["stat", "segment"]):
            n = int(d["n"].sum())
            rec = {"stat": stat, "segment": seg, "n": n}
            if stat != "_coverage":  # counts only: projected, no box score
                w = d["n"] / n
                rec |= {
                    "mae": float((d["mae"] * w).sum()),
                    "rmse": float(np.sqrt((d["rmse"] ** 2 * w).sum())),
                    "bias": float((d["bias"] * w).sum()),
                    "coverage_80": float((d["coverage_80"] * w).sum())
                    if d["coverage_80"].notna().all()
                    else None,
                }
                if seg == "brier":  # pooled Brier: the n-weighted mean (audit F13)
                    rec["brier"] = rec["rmse"] ** 2
            recs.append(rec)
        out["projections"] = recs
    if "live_news_scores" in have:
        ns = con.execute("SELECT * FROM live_news_scores WHERE day >= ?", [since]).df()
        if not ns.empty:
            t = ns.groupby(["source", "status"], as_index=False)[["listed", "played"]].sum()
            t["played_rate"] = t["played"] / t["listed"]
            probs = {k.lower(): v for k, v in cfg.overrides.status_play_prob.items()}
            t["assumed"] = t["status"].str.lower().map(probs)
            out["news"] = t.to_dict("records")
    res = week_results(con, cfg)
    snaps = (
        con.execute("SELECT week, ts, p_win_week FROM matchup_snapshots").df()
        if "matchup_snapshots" in have
        else pd.DataFrame()
    )
    if not res.empty and not snaps.empty:
        j = snaps.merge(res, on="week")
        j["y"] = (j["cats_me"] > j["cats_opp"]).astype(float) + 0.5 * (j["cats_me"] == j["cats_opp"])
        first = j.sort_values("ts").groupby("week").head(1)
        out["weekly_odds"] = {
            "weeks": int(res["week"].nunique()),
            "brier_all_snapshots": float(((j["p_win_week"] - j["y"]) ** 2).mean()),
            "brier_first_snapshot": float(((first["p_win_week"] - first["y"]) ** 2).mean()),
        }
    return out

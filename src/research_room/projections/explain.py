"""Explain a player's projection: where each number came from, and what it means for my week.

Inputs: the latest projections run (mean, sd and the stored pieces: P(plays), expected minutes, the
model's mean before the market overlay, the market flag), game_logs (his season so far), status
events and injuries (overrides), props_ladder (markets), players / teams, and, when the week's
inputs exist, the matchup engine and the optimizer's plan.
Outputs: a PlayerAnalysisResponse dict (web/src/api/season.ts) for GET /season/players/{id}.
Tables: reads only.

The waterfall is exact, not an approximation: the driving projection is P(plays) x minutes when
playing x per-minute rate, then the market overlay where a liquid ladder exists. Starting from his
average per game this season (last season before he has played), each step's contribution is the
change it makes in that product, in this order: availability, minutes, per-minute production,
market. The steps add up to the stored projection. Only factors the engine actually uses are shown;
opponent, Vegas and teammate factors are left out (tested, not used: DECISIONS.md), not invented.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import duckdb
import numpy as np
import pandas as pd

from research_room import overrides, schedule
from research_room.config import Settings, settings
from research_room.ingest.market_common import ET
from research_room.projections import market as market_mod

COUNT = ("pts", "reb", "ast", "stl", "blk", "fg3m", "tov")
LABEL = {
    "pts": "points",
    "reb": "rebounds",
    "ast": "assists",
    "stl": "steals",
    "blk": "blocks",
    "fg3m": "threes",
    "tov": "turnovers",
    "minutes": "minutes",
}
Z80 = 1.2815515655446004


class NotReady(Exception):
    """The engine lacks an input the response needs; the message says what to do."""


def _est(mean: float, sd: float) -> dict:
    sd = float(max(sd, 0.0))
    return {
        "mean": float(mean),
        "sd": sd,
        "lo": float(max(mean - Z80 * sd, 0.0)),
        "hi": float(mean + Z80 * sd),
        "level": 0.8,
    }


def _conf(level: str, missing: list[dict] | None = None) -> dict:
    return {"level": level, "score": None, "missing": missing or []}


def _prov(module: str, as_of, note: str | None = None) -> list[dict]:
    return [
        {
            "module": module,
            "as_of": None if as_of is None else pd.Timestamp(as_of).isoformat(),
            "run_id": None,
            "note": note,
        }
    ]


def _factor(fid, kind, title, value, fmt, note, reading, detail, conf, prov, push="neutral") -> dict:
    return {
        "id": fid,
        "kind": kind,
        "title": title,
        "value": value,
        "format": fmt,
        "value_note": note,
        "reading": reading,
        "push": push,
        "confidence": conf,
        "provenance": prov,
        "detail": detail,
    }


def season_averages(con: duckdb.DuckDBPyConnection, player_id: int, season: int) -> tuple[dict, int, int]:
    """Per played game this season (falls back to last season). Returns (averages, games, season used)."""
    for s in (season, season - 1):
        row = con.execute(
            """
            SELECT count(*), avg(minutes), avg(pts), avg(reb), avg(ast), avg(stl), avg(blk), avg(fg3m),
                   avg(tov),
                   avg(fgm), avg(fga), avg(ftm), avg(fta)
            FROM game_logs WHERE player_id = ? AND season = ? AND did_play
        """,
            [player_id, s],
        ).fetchone()
        if row and row[0]:
            keys = ["minutes", "pts", "reb", "ast", "stl", "blk", "fg3m", "tov", "fgm", "fga", "ftm", "fta"]
            return (
                dict(zip(keys, [float(x) if x is not None else None for x in row[1:]], strict=True)),
                int(row[0]),
                s,
            )
    return {}, 0, season


def waterfall(
    stat: str,
    avg: dict,
    p_play: float,
    minutes_cond: float,
    model_mean: float,
    final_mean: float,
    market: bool,
) -> dict | None:
    """drivers detail: exact step contributions from his average to the stored projection."""
    a, a_min = avg.get(stat), avg.get("minutes")
    if not a or not a_min:
        return None
    after_avail = a * p_play
    after_min = after_avail * (minutes_cond / a_min) if a_min else after_avail
    steps = [
        ("availability", "Chance of playing", f"{p_play:.0%}", after_avail - a),
        ("minutes", "Minutes when playing", f"{minutes_cond:.1f} (avg {a_min:.1f})", after_min - after_avail),
        (
            "rate",
            f"{LABEL[stat].capitalize()} per minute",
            f"{(model_mean / max(p_play * minutes_cond, 1e-9)):.3f} (avg {a / a_min:.3f})",
            model_mean - after_min,
        ),
    ]
    if market:
        steps.append(
            (
                "market",
                "Betting market",
                f"{final_mean:.1f} vs model {model_mean:.1f}",
                final_mean - model_mean,
            )
        )
    return {
        "kind": "drivers",
        "model": "baseline" + (" + market" if market else ""),
        "target": stat,
        "base_value": float(a),
        "drivers": [
            {"feature": f, "label": lab, "value_label": v, "contribution": float(c)} for f, lab, v, c in steps
        ],
    }


def player_analysis(
    con: duckdb.DuckDBPyConnection,
    player_id: int,
    cfg: Settings | None = None,
    now: datetime | None = None,
    week: dict | None = None,
    ref: dict | None = None,
    recommendation: dict | None = None,
    schedule_factor: dict | None = None,
) -> dict:
    """PlayerAnalysisResponse for one player. `week`, `ref`, `recommendation` and `schedule_factor` come
    from the season API (they need the week's inputs); without them the analysis still explains the
    projection."""
    cfg = cfg or settings()
    now = pd.Timestamp(now or datetime.now(ET))
    now = now if now.tzinfo else now.tz_localize(ET)
    run = con.execute("SELECT max(run_at) FROM projections WHERE model = 'baseline'").fetchone()[0]
    if run is None:
        raise NotReady("No projections yet: run `make nightly`.")
    proj = con.execute(
        """SELECT date, stat, mean, sd, p_play, minutes_mean, model_mean, market FROM projections
                          WHERE model = 'baseline' AND run_at = ? AND player_id = ? AND date >= ?
                          ORDER BY date""",
        [run, player_id, now.tz_convert(ET).date()],
    ).df()
    if proj.empty:
        raise NotReady("No upcoming projected games for this player in the current window.")
    proj["date"] = pd.to_datetime(proj["date"]).dt.date
    first = proj["date"].min()
    nxt = proj[proj["date"] == first].set_index("stat")
    weeks = schedule.fantasy_weeks(cfg.season)
    wk = weeks[(weeks["start"] <= first) & (weeks["end"] >= first)]
    wk_end = wk["end"].iloc[0] if not wk.empty else first + timedelta(days=6)
    this_week = proj[proj["date"] <= wk_end]
    games = this_week["date"].nunique()
    avg, n_avg, avg_season = season_averages(con, player_id, cfg.season.nba_season)
    cats = cfg.categories
    run_as_of = pd.Timestamp(run)

    # ---- projection: next game and the rest of this fantasy week
    def cat_est(frame: pd.DataFrame, total: bool) -> list[dict]:
        g = frame.groupby("stat").agg(
            mean=("mean", "sum" if total else "first"),
            var=("sd", lambda s: float((s**2).sum()) if total else float(s.iloc[0] ** 2)),
        )
        out = []
        for c in cats:
            if c.kind == "pct":
                if c.made in g.index and c.attempts in g.index and g.at[c.attempts, "mean"] > 0:
                    att, made = g.at[c.attempts, "mean"], g.at[c.made, "mean"]
                    pct = made / att
                    out.append({"key": c.key, **_est(pct, np.sqrt(max(pct * (1 - pct) / att, 0)))})
            elif c.key in g.index:
                out.append({"key": c.key, **_est(g.at[c.key, "mean"], np.sqrt(g.at[c.key, "var"]))})
        return out

    pts = nxt.loc["pts"] if "pts" in nxt.index else None
    factors = [
        _factor(
            "projection",
            "projection",
            "Projection",
            None if pts is None else float(pts["mean"]),
            "decimal",
            "points next game",
            (
                f"{float(pts['mean']):.1f} points next game ({first:%a %b %-d}); {games} game"
                f"{'s' if games != 1 else ''} left this week."
                if pts is not None
                else "No points projection."
            ),
            {
                "kind": "projection",
                "games": int(games),
                "per_game": cat_est(proj[proj["date"] == first], False),
                "week": cat_est(this_week, True),
            },
            _conf("medium"),
            _prov(
                "projections",
                run_as_of,
                "baseline: EWMA rates x minutes x P(plays)"
                + (
                    "; market sets points/rebounds/assists where liquid"
                    if bool(nxt.get("market", pd.Series(False)).fillna(False).any())
                    else ""
                ),
            ),
        )
    ]

    # ---- minutes
    logs = (
        con.execute(
            """SELECT l.game_date, l.minutes, l.did_play, t.abbreviation AS opp
                          FROM game_logs l JOIN games g USING (game_id)
                          JOIN teams t ON t.team_id = CASE WHEN g.home_team_id = l.team_id
                                                           THEN g.visitor_team_id
                                                           ELSE g.home_team_id END
                          WHERE l.player_id = ? AND NOT g.postseason ORDER BY l.game_date DESC LIMIT 10""",
            [player_id],
        )
        .df()
        .iloc[::-1]
    )
    played = logs.loc[logs["did_play"].astype(bool), "minutes"].astype(float)
    m_row = nxt.loc["minutes"] if "minutes" in nxt.index else None
    p_play = float(m_row["p_play"]) if m_row is not None and pd.notna(m_row["p_play"]) else None
    m_cond = (float(m_row["minutes_mean"]) / p_play) if m_row is not None and p_play else None
    roll = lambda n: float(played.tail(n).mean()) if len(played) >= min(n, 3) else None  # noqa: E731
    factors.append(
        _factor(
            "minutes",
            "minutes",
            "Minutes",
            m_cond,
            "minutes",
            "when playing",
            (
                f"Projected {m_cond:.1f} minutes when he plays ({p_play:.0%} chance of playing); "
                f"{'last 5 games ' + format(roll(5), '.1f') if roll(5) is not None else 'no recent games'}"
                f"{', season ' + format(avg['minutes'], '.1f') if avg.get('minutes') else ''}."
                if m_cond
                else "No minutes projection."
            ),
            {
                "kind": "minutes",
                "games": [
                    {
                        "date": str(pd.Timestamp(r.game_date).date()),
                        "opp_abbr": r.opp,
                        "value": float(r.minutes) if r.did_play else None,
                    }
                    for r in logs.itertuples()
                ],
                "rolling3": roll(3),
                "rolling5": roll(5),
                "rolling10": roll(10),
                "ewma": None,
                "season": avg.get("minutes"),
                "projected": _est(m_cond, float(m_row["sd"])) if m_cond else None,
                "unit": "min",
            },
            _conf(
                "medium" if n_avg >= 10 else "low",
                []
                if n_avg >= 10
                else [
                    {
                        "key": "history",
                        "label": f"Only {n_avg} games played in {avg_season}-{(avg_season + 1) % 100:02d}",
                        "effect": "Minutes lean on a short history",
                    }
                ],
            ),
            _prov("features", run_as_of, "minutes EWMA (half-life 3 games) x P(plays)"),
        )
    )

    # ---- news (overrides: X posts, the NBA injury report and BallDontLie's list)
    start = now.tz_convert(ET).date()
    ov = overrides.resolve(con, start, start + timedelta(days=7), as_of=now.to_pydatetime(), cfg=cfg)
    ov = ov[(ov["player_id"] == player_id) & (ov["status"] != overrides.NOT_LISTED)].sort_values(
        "ts", ascending=False)
    tier = {"official": "official", "insider": "insider", "beat": "beat", "aggregator": "aggregator"}
    events = []
    for r in ov.drop_duplicates(["source", "status"]).head(5).itertuples(index=False):
        code = str(r.status or "").lower().replace(" ", "_").replace("-", "_") or None
        code = (
            code
            if code in {"out", "doubtful", "questionable", "probable", "day_to_day"}
            else ("healthy" if code == "available" else None)
        )
        kind = (
            "x" if str(r.source).startswith("X @")
            else {"manual": "manual", "nba_report": "nba_report"}.get(r.authority, "bdl")
        )
        summary = f"{r.status}" + (f", minutes limit {r.minutes_cap:.0f}" if pd.notna(r.minutes_cap) else "")
        events.append(
            {
                "at": pd.Timestamp(r.ts).isoformat(),
                "status": code,
                "minutes_cap": None if pd.isna(r.minutes_cap) else float(r.minutes_cap),
                "starting": None,
                "summary": summary,
                "parse_confidence": 1.0,
                "source": {
                    "kind": kind,
                    "handle": str(r.source)[2:] if kind == "x" else None,
                    "display_name": str(r.source),
                    "tier": tier.get(r.authority),
                },
            }
        )
    if events:
        top = events[0]
        factors.append(
            _factor(
                "news",
                "news",
                "News",
                None,
                "count",
                None,
                f"Latest: {top['summary']} ({top['source']['display_name']}).",
                {"kind": "news", "events": events},
                _conf("high" if top["source"]["tier"] == "official" else "medium"),
                _prov("overrides", top["at"], "X posts, the injury report and manual overrides"),
                push="against" if top["status"] in ("out", "doubtful") else "neutral",
            )
        )

    # ---- market (the lines behind any overlay, or the lines we didn't trust)
    gids = [
        r[0]
        for r in con.execute(
            """SELECT g.game_id FROM games g
               JOIN players p ON p.team_id IN (g.home_team_id, g.visitor_team_id)
                                         WHERE p.player_id = ? AND g.game_date = ?""",
            [player_id, first],
        ).fetchall()
    ]
    lad = market_mod.ladder_points(
        con, gids, list(COUNT), now.to_pydatetime(), cfg.markets.overlay.max_age_hours
    )
    lad = lad[lad["player_id"] == player_id]
    lines = []
    for stat, g in lad.groupby("stat"):
        if stat not in nxt.index:
            continue
        ours = nxt.loc[stat]
        # Props are lines if he plays (market.py), so both sides are compared if he plays.
        p = float(ours["p_play"]) if pd.notna(ours.get("p_play")) else 1.0
        model_mu = float(ours["model_mean"]) if pd.notna(ours.get("model_mean")) else float(ours["mean"])
        mu_c, sd_c = market_mod.conditional(model_mu, float(ours["sd"]), p) if p > 0 else (model_mu, 0.0)
        fit = market_mod.fit(
            g["threshold"].to_numpy(),
            g["p_over"].to_numpy(),
            sd_c,
            cfg.markets.overlay.sd_bounds,
        ) if sd_c > 0 else None
        model_mu = mu_c
        gap = None if fit is None else (fit[0] - model_mu) / max(sd_c, 1e-9)
        line = float(g.iloc[(g["p_over"] - 0.5).abs().argmin()]["threshold"])
        lines.append(
            {
                "stat": stat,
                "venue": "kalshi",
                "book": None,
                "game": None,
                "line": line,
                "implied_mean": None if fit is None else float(fit[0]),
                "ours": _est(model_mu, sd_c),
                "gap_sd": None if gap is None else float(gap),
                "agreement": "no_market"
                if gap is None
                else ("agrees" if abs(gap) < 0.25 else "market_higher" if gap > 0 else "market_lower"),
                "liquid": True,
                "volume": None,
            }
        )
    if lines:
        big = max(lines, key=lambda x: abs(x["gap_sd"] or 0))
        factors.append(
            _factor(
                "market",
                "market",
                "Betting market",
                big["implied_mean"],
                "decimal",
                f"{LABEL[big['stat']]}, market",
                (
                    f"If he plays, the market expects {big['implied_mean']:.1f} {LABEL[big['stat']]} vs "
                    f"our model's {big['ours']['mean']:.1f}"
                    + (
                        "; the projection uses the market's line times his chance of playing."
                        if bool(nxt.loc[big["stat"]].get("market", False))
                        else "; he isn't expected to play, so the projection is zero."
                        if float(nxt.loc[big["stat"]].get("p_play", 1.0) or 0.0) <= 0
                        else "; it was priced before the latest news about him, so our number stands."
                        if big["stat"] in cfg.markets.overlay.stats
                        else "."
                    )
                    if big["implied_mean"] is not None
                    else "A market exists but its ladder can't be trusted."
                ),
                {"kind": "market", "lines": lines},
                _conf("high"),
                _prov("kalshi", now, "liquid ladders: Kalshi mid-prices and de-vigged sportsbook lines"),
            )
        )

    # ---- drivers: the exact waterfall for points
    if pts is not None and p_play and m_cond:
        wf = waterfall(
            "pts",
            avg,
            p_play,
            m_cond,
            float(pts["model_mean"]) if pd.notna(pts.get("model_mean")) else float(pts["mean"]),
            float(pts["mean"]),
            bool(pts.get("market") or False),
        )
        if wf:
            biggest = max(wf["drivers"], key=lambda d: abs(d["contribution"]))
            factors.append(
                _factor(
                    "drivers",
                    "drivers",
                    "Why this number",
                    float(pts["mean"]),
                    "decimal",
                    "points",
                    (
                        f"From his {wf['base_value']:.1f}-point average to {float(pts['mean']):.1f}: "
                        "the biggest "
                        f"change is {biggest['label'].lower()} ({biggest['contribution']:+.1f})."
                    ),
                    wf,
                    _conf("high"),
                    _prov("projections", run_as_of, "exact decomposition, adds up"),
                )
            )
    if schedule_factor:
        factors.insert(1, schedule_factor)

    missing = (
        []
        if avg
        else [
            {"key": "history", "label": "No games played yet", "effect": "Projection from the preseason only"}
        ]
    )
    rec = recommendation or {
        "action": "hold",
        "headline": "No move needed from the projection alone",
        "slot": None,
        "plan": [],
        "delta_p_win": None,
        "versus": None,
        "confidence": _conf(
            "low",
            [
                {
                    "key": "week",
                    "label": "No matchup this week yet",
                    "effect": "Start/sit and add/drop advice needs the week's rosters",
                }
            ],
        ),
        "move_id": None,
    }
    return {
        "as_of": run_as_of.isoformat(),
        "stale": False,
        "stale_reason": None,
        "provenance": _prov("projections", run_as_of, "baseline + market overlay"),
        "week": week,
        "player": ref,
        "recommendation": rec,
        "factors": factors,
        "confidence": {
            **_conf("medium", missing),
            "summary": (
                f"Built from {n_avg} games in {avg_season}-{(avg_season + 1) % 100:02d}"
                + (
                    ", news and the betting market."
                    if events and lines
                    else ", plus the latest news."
                    if events
                    else ", plus the betting market."
                    if lines
                    else "."
                )
            ),
        },
    }

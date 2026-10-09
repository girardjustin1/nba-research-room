"""TheRundown (RUNDOWN_API_KEY): sportsbook game lines and player props for NBA events.

Inputs: GET {base_url}/sports/{sport_id}/events/{YYYY-MM-DD}?market_ids=... (settings.markets.rundown),
the store's games / players.
Outputs: odds rows (vendor "rundown:<book id>": moneyline, spread, total; main lines only) and
props_ladder rows (source "rundown": every line, so alternate lines form a ladder).
Tables: writes odds, props_ladder, player_xref, unresolved_names; reads games, teams, players.

Checked against the live API (2026-10-05): an event has teams [{team_id, abbreviation, is_home}]
and markets [{market_id, name, participants}]. Moneyline: TYPE_TEAM participants, lines without a
value. Spread ("handicap"): TYPE_TEAM, value "+2.5". Total: TYPE_RESULT "Over"/"Under", value
"230.5". Player props: TYPE_PLAYER, value "Over 14.5". Prices are American odds per sportsbook
(affiliate id) with an is_main_line flag. Free tier: 500M data points a month, 10 requests/s.

Probabilities are de-vigged within each two-way pair (same book, same line); a side without its
pair keeps its price but no probability.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

import duckdb
import numpy as np
import pandas as pd

from research_room import store
from research_room.config import Secrets, Settings, settings
from research_room.ingest.market_common import ET, GameIndex, RateLimited, american_to_prob, devig_pair
from research_room.ingest.names import resolve_and_record

SOURCE = "rundown"


def _num(v) -> float | None:
    try:
        return float(str(v).replace("+", ""))
    except (TypeError, ValueError):
        return None


def parse_event(event: dict, cfg: Settings, fetched_at: datetime) -> tuple[pd.DataFrame, pd.DataFrame]:
    """One event -> (game line rows, player prop rows), before game and player matching."""
    rd = cfg.markets.rundown
    teams = {t.get("team_id"): t for t in event.get("teams", [])}
    home = next((t["abbreviation"] for t in event.get("teams", []) if t.get("is_home")), None)
    away = next((t["abbreviation"] for t in event.get("teams", []) if not t.get("is_home")), None)
    day = pd.Timestamp(event["event_date"]).tz_convert(ET).date()
    base = {"day": day, "home": home, "away": away, "event_id": event.get("event_id")}
    lines, props = [], []
    for m in event.get("markets", []):
        mid = m.get("market_id")
        for p in m.get("participants", []):
            for ln in p.get("lines", []):
                for book, pr in (ln.get("prices") or {}).items():
                    price = _num(pr.get("price"))
                    ts = pd.Timestamp(pr.get("updated_at") or fetched_at)
                    if mid in rd.game_markets and pr.get("is_main_line"):
                        kind = rd.game_markets[mid]
                        if kind == "total":
                            side, line = str(p.get("name", "")).lower(), _num(ln.get("value"))
                        else:
                            t = teams.get(p.get("id"))
                            side = None if t is None else ("home" if t.get("is_home") else "away")
                            line = _num(ln.get("value")) if kind == "spread" else np.nan
                        if side in ("home", "away", "over", "under"):
                            lines.append(
                                {
                                    **base,
                                    "market": kind,
                                    "side": side,
                                    "line": line,
                                    "price": price,
                                    "book": str(book),
                                    "ts": ts,
                                }
                            )
                    elif mid in rd.prop_markets and p.get("type") == "TYPE_PLAYER":
                        side, _, thr = str(ln.get("value", "")).partition(" ")
                        if side.lower() in ("over", "under") and _num(thr) is not None:
                            props.append(
                                {
                                    **base,
                                    "stat": rd.prop_markets[mid],
                                    "player_name": p.get("name"),
                                    "rundown_player": p.get("id"),
                                    "side": side.lower(),
                                    "threshold": _num(thr),
                                    "price": price,
                                    "book": str(book),
                                    "market_ref": ln.get("id"),
                                    "ts": ts,
                                }
                            )
    return pd.DataFrame(lines), pd.DataFrame(props)


def _devig(df: pd.DataFrame, keys: list[str], a: str, b: str) -> pd.Series:
    """De-vigged probability per row within (keys) pairs of sides a / b; NaN without a pair."""
    raw = df["price"].map(american_to_prob)
    out = pd.Series(np.nan, index=df.index)
    for _, g in df.assign(_raw=raw).groupby(keys, dropna=False):
        sa, sb = g[g["side"] == a], g[g["side"] == b]
        if len(sa) == 1 and len(sb) == 1:
            pa, pb = devig_pair(sa["_raw"].iloc[0], sb["_raw"].iloc[0])
            out[sa.index[0]], out[sb.index[0]] = pa, pb
    return out


def sync(
    con: duckdb.DuckDBPyConnection,
    cfg: Settings | None = None,
    client: RateLimited | None = None,
    today: date | None = None,
    now: datetime | None = None,
    days_ahead: int | None = None,
) -> dict[str, int]:
    """Archive game lines and player props for today and the next `days_ahead` days (default
    settings.markets.rundown.days_ahead; pre-game runs pass pregame_days_ahead)."""
    cfg = cfg or settings()
    rd = cfg.markets.rundown
    if client is None:  # the key is only needed for the real API (tests pass their own client)
        key = Secrets().require("rundown_api_key")
        client = RateLimited(rd.requests_per_second, headers={"X-TheRundown-Key": key})
    now = now or store.utcnow()
    today = today or datetime.now(ET).date()
    ids = ",".join(str(i) for i in [*rd.game_markets, *rd.prop_markets])
    lines, props = [], []
    ahead = rd.days_ahead if days_ahead is None else days_ahead
    for i in range(ahead + 1):
        d = today + timedelta(days=i)
        for ev in client.get(
            f"{rd.base_url}/sports/{rd.sport_id}/events/{d.isoformat()}", {"market_ids": ids}
        ).get("events", []):
            gl, pp = parse_event(ev, cfg, now)
            lines.append(gl), props.append(pp)
    games = GameIndex(con)
    counts = {"game_lines": 0, "prop_lines": 0, "unmatched_props": 0}
    gl = pd.concat(lines, ignore_index=True) if lines else pd.DataFrame()
    if not gl.empty:
        gl["game_id"] = [games.game_id(r.day, r.home, r.away) for r in gl.itertuples()]
        gl = gl[gl["game_id"].notna()].copy()
        prob = pd.Series(np.nan, index=gl.index)
        for market, (a, b) in (
            ("moneyline", ("home", "away")),
            ("spread", ("home", "away")),
            ("total", ("over", "under")),
        ):
            sub = gl[gl["market"] == market]
            prob[sub.index] = _devig(sub, ["game_id", "book"] + (["line"] if market == "total" else []), a, b)
        counts["game_lines"] = store.upsert(
            con,
            "odds",
            gl.assign(
                game_id=gl["game_id"].astype(int),
                vendor="rundown:" + gl["book"],
                is_opening=False,
                price_american=gl["price"],
                prob=prob,
                source=SOURCE,
                fetched_at=now,
            )[
                [
                    "game_id",
                    "vendor",
                    "market",
                    "side",
                    "is_opening",
                    "line",
                    "price_american",
                    "prob",
                    "ts",
                    "source",
                    "fetched_at",
                ]
            ],
        )
    pp = pd.concat(props, ignore_index=True) if props else pd.DataFrame()
    if not pp.empty:
        pp["game_id"] = [games.game_id(r.day, r.home, r.away) for r in pp.itertuples()]
        keys = pp.drop_duplicates(["rundown_player"])
        names = pd.DataFrame(
            {
                "source_key": keys["rundown_player"].astype(str),
                "raw_name": keys["player_name"],
                "team_abbr": None,
            }
        ).reset_index(drop=True)
        pid = dict(zip(names["source_key"], resolve_and_record(con, SOURCE, names), strict=True))
        pp["player_id"] = pp["rundown_player"].astype(str).map(pid)
        ok = pp["player_id"].notna() & pp["game_id"].notna()
        counts["unmatched_props"] = int((~ok).sum())
        pp = pp[ok].copy()
        pp["prob"] = _devig(pp, ["game_id", "player_id", "stat", "threshold", "book"], "over", "under")
        counts["prop_lines"] = store.upsert(
            con,
            "props_ladder",
            pp.assign(
                source=SOURCE,
                vendor="rundown:" + pp["book"],
                game_id=pp["game_id"].astype(int),
                player_id=pp["player_id"].astype(int),
                volume=np.nan,
                bid=np.nan,
                ask=np.nan,
                open_interest=np.nan,
                fetched_at=now,
            )[
                [
                    "source",
                    "game_id",
                    "player_id",
                    "stat",
                    "threshold",
                    "side",
                    "prob",
                    "price",
                    "volume",
                    "vendor",
                    "ts",
                    "bid",
                    "ask",
                    "open_interest",
                    "market_ref",
                    "fetched_at",
                ]
            ],
        )
    return counts

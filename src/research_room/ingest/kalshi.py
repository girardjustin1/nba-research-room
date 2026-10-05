"""Kalshi (public market data, no key): NBA player-prop ladders and game-winner markets.

Inputs: Kalshi's public trade API (settings.markets.kalshi), the store's games / players.
Outputs: props_ladder rows (source "kalshi": one per threshold rung per snapshot, with bid, ask,
mid probability, last price, volume, open interest) and odds rows (vendor "kalshi", moneyline).
`implied_ladder` reads a player's latest liquid ladder back as P(stat >= threshold).
Tables: writes props_ladder, odds, player_xref, unresolved_names; reads games, teams, players.

Checked against the live API (2026-10-05): open markets via GET /markets?series_ticker=&status=open
(cursor paging); prices are strings in dollars (yes_bid_dollars, yes_ask_dollars,
last_price_dollars), volume_fp and open_interest_fp are strings; settled markets move to
GET /historical/markets and hourly prices to /historical/markets/{ticker}/candlesticks. A prop
market is one rung: title "Jalen Brunson: 30+ points", floor_strike 29.5. Event tickers read
SERIES-YYMONDD + away + home team codes (e.g. KXNBAPTS-26JUN13NYKSAS).

Rules (build prompt): mid-price, and a rung thinner than min_volume or wider than max_spread keeps
its quotes but no probability (missing, not guessed). Names go through the shared resolver;
unmatched players are quarantined and their rows skipped.
"""

from __future__ import annotations

import re
from datetime import date, datetime

import duckdb
import numpy as np
import pandas as pd

from research_room import store
from research_room.config import Settings, settings
from research_room.ingest.market_common import GameIndex, RateLimited
from research_room.ingest.names import resolve_and_record

SOURCE = "kalshi"
MONTHS = {
    m: i + 1
    for i, m in enumerate(
        ("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC")
    )
}
_EVENT = re.compile(r"^[A-Z0-9]+-(\d{2})([A-Z]{3})(\d{2})([A-Z]{6})$")


def _f(v) -> float | None:
    try:
        return float(v) if v is not None and v != "" else None
    except (TypeError, ValueError):
        return None


def parse_event_ticker(ticker: str) -> tuple[date, str, str] | None:
    """'KXNBAPTS-26JUN13NYKSAS' -> (2026-06-13, 'NYK', 'SAS') (away, home); None if unreadable."""
    m = _EVENT.match(ticker or "")
    if not m or m.group(2) not in MONTHS:
        return None
    yy, mon, dd, teams = m.groups()
    return date(2000 + int(yy), MONTHS[mon], int(dd)), teams[:3], teams[3:]


def _mid(bid: float | None, ask: float | None, volume: float | None, cfg: Settings) -> float | None:
    k = cfg.markets.kalshi
    if bid is None or ask is None or bid <= 0 or ask <= 0 or ask < bid:
        return None
    if (volume or 0) < k.min_volume or ask - bid > k.max_spread:
        return None  # illiquid: quotes kept, probability missing
    return (bid + ask) / 2


def parse_props(markets: list[dict], stat: str, fetched_at: datetime, cfg: Settings) -> pd.DataFrame:
    rows = []
    for m in markets:
        ev = parse_event_ticker(m.get("event_ticker", ""))
        title, strike = m.get("title") or "", _f(m.get("floor_strike"))
        if ev is None or ":" not in title or strike is None:
            continue
        day, away, home = ev
        seg = m["ticker"].split("-")[-2] if m.get("ticker", "").count("-") >= 3 else ""
        team = seg[:3] if seg[:3] in (away, home) else None
        bid, ask, vol = _f(m.get("yes_bid_dollars")), _f(m.get("yes_ask_dollars")), _f(m.get("volume_fp"))
        player = (m.get("custom_strike") or {}).get("basketball_player")
        rows.append(
            {
                "market_ref": m["ticker"],
                "stat": stat,
                "day": day,
                "away": away,
                "home": home,
                "team": team,
                "player_name": title.split(":")[0].strip(),
                "kalshi_player": player,
                "threshold": strike,
                "bid": bid,
                "ask": ask,
                "price": _f(m.get("last_price_dollars")),
                "volume": vol,
                "open_interest": _f(m.get("open_interest_fp")),
                "prob": _mid(bid, ask, vol, cfg),
                "ts": pd.Timestamp(m.get("updated_time") or fetched_at),
            }
        )
    return pd.DataFrame(rows)


def parse_games(markets: list[dict], fetched_at: datetime, cfg: Settings) -> pd.DataFrame:
    """Game-winner markets -> one row per team side (home / away)."""
    rows = []
    for m in markets:
        ev = parse_event_ticker(m.get("event_ticker", ""))
        if ev is None:
            continue
        day, away, home = ev
        code = m["ticker"].split("-")[-1]
        side = "home" if code == home else "away" if code == away else None
        if side is None:
            continue
        bid, ask, vol = _f(m.get("yes_bid_dollars")), _f(m.get("yes_ask_dollars")), _f(m.get("volume_fp"))
        rows.append(
            {
                "day": day,
                "away": away,
                "home": home,
                "side": side,
                "prob": _mid(bid, ask, vol, cfg),
                "ts": pd.Timestamp(m.get("updated_time") or fetched_at),
            }
        )
    return pd.DataFrame(rows)


def fetch_open(client: RateLimited, cfg: Settings, series: str) -> list[dict]:
    out, cursor = [], None
    while True:
        params = {"series_ticker": series, "status": "open", "limit": 1000}
        if cursor:
            params["cursor"] = cursor
        page = client.get(f"{cfg.markets.kalshi.base_url}/markets", params)
        out += page.get("markets", [])
        cursor = page.get("cursor")
        if not cursor:
            return out


def sync(
    con: duckdb.DuckDBPyConnection,
    cfg: Settings | None = None,
    client: RateLimited | None = None,
    now: datetime | None = None,
) -> dict[str, int]:
    """Archive every open NBA prop rung and game market (one snapshot)."""
    cfg = cfg or settings()
    client = client or RateLimited(cfg.markets.kalshi.requests_per_second)
    now = now or store.utcnow()
    games = GameIndex(con)
    props = pd.concat(
        [
            parse_props(fetch_open(client, cfg, s), stat, now, cfg)
            for s, stat in cfg.markets.kalshi.prop_series.items()
        ],
        ignore_index=True,
    )
    counts = {"prop_rungs": 0, "game_sides": 0, "unmatched_rungs": 0}
    if not props.empty:
        props["game_id"] = [games.game_id(r.day, r.away, r.home) for r in props.itertuples()]
        props["team_abbr"] = props["team"].map(games.team)
        keys = props.drop_duplicates("market_ref")
        names = pd.DataFrame(
            {
                "source_key": keys["kalshi_player"].fillna(
                    keys["player_name"] + "|" + keys["team"].fillna("")
                ),
                "raw_name": keys["player_name"],
                "team_abbr": keys["team_abbr"],
            }
        ).drop_duplicates()
        ids = resolve_and_record(con, SOURCE, names.reset_index(drop=True))
        pid = dict(zip(names["raw_name"] + "|" + names["team_abbr"].fillna(""), ids, strict=True))
        props["player_id"] = (props["player_name"] + "|" + props["team_abbr"].fillna("")).map(pid)
        ok = props["player_id"].notna() & props["game_id"].notna()
        counts["unmatched_rungs"] = int((~ok).sum())
        rows = props[ok].assign(source=SOURCE, vendor=SOURCE, side="over", fetched_at=now)
        counts["prop_rungs"] = store.upsert(
            con,
            "props_ladder",
            rows[
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
            ].astype({"game_id": int, "player_id": int}),
        )
    gm = parse_games(fetch_open(client, cfg, cfg.markets.kalshi.game_series), now, cfg)
    if not gm.empty:
        gm["game_id"] = [games.game_id(r.day, r.away, r.home) for r in gm.itertuples()]
        gm = gm[gm["game_id"].notna()]
        counts["game_sides"] = store.upsert(
            con,
            "odds",
            gm.assign(
                game_id=gm["game_id"].astype(int),
                vendor=SOURCE,
                market="moneyline",
                is_opening=False,
                line=np.nan,
                price_american=np.nan,
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
    return counts


def implied_ladder(con: duckdb.DuckDBPyConnection, player_id: int, stat: str, game_id: int) -> pd.DataFrame:
    """The latest liquid Kalshi ladder for one player-game: threshold, p_over = P(stat > threshold),
    forced non-increasing (a higher bar is never likelier). Empty when nothing is liquid: missing,
    and the simulator falls back to normal(mean, sd)."""
    df = con.execute(
        """
        SELECT threshold, prob FROM props_ladder
        WHERE source = 'kalshi' AND player_id = ? AND stat = ? AND game_id = ? AND prob IS NOT NULL
          AND fetched_at = (SELECT max(fetched_at) FROM props_ladder WHERE source = 'kalshi'
                            AND player_id = ? AND stat = ? AND game_id = ?)
        ORDER BY threshold
    """,
        [player_id, stat, game_id, player_id, stat, game_id],
    ).df()
    if df.empty:
        return pd.DataFrame(columns=["threshold", "p_over"])
    return pd.DataFrame(
        {
            "threshold": df["threshold"].to_numpy(float),
            "p_over": np.minimum.accumulate(df["prob"].to_numpy(float)),
        }
    )

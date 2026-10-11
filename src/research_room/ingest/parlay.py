"""ParlayAPI (PARLAY_API_KEY): live sportsbook player props, and closing lines for the props test.

Live (`sync`, in the nightly and pre-game market pulls): GET {base_url}/v1/sports/{sport_key}/props
(3 credits a call): each book's current over/under for the tracked stats, de-vigged within the
book's pair and archived to props_ladder (source "parlay", vendor "parlay:<book>"), beside
TheRundown's; the overlay counts each book once across both (projections/market.py).

Inputs: GET {base_url}/v1/historical/closing-lines.json?date=YYYY-MM-DD&sport_key=... (one UTC day
per request, 1 credit per 1,000 rows delivered; the Enterprise plan reads one year back) and the
free GET /v1/meta/api-key-check; settings.markets.parlay; the store's games and teams.
Outputs: closing rows (one per book, player, stat, line: American over/under prices) and rungs:
per (game, player, stat, line) the books' consensus P(over), de-vigged within each book's pair.
Tables: `sync` writes props_ladder, player_xref, unresolved_names; reads games, teams, players.

Checked against ParlayAPI's published contract (openapi.json, 2026-10-11): a closing-lines.json
body is {as_of, date, filters, row_count, rows: [{game_date, sport_key, commence_time, home_team,
away_team, source, player_name, market_key, market_label, line, over_price, under_price,
over_implied_prob, under_implied_prob, snapshot_time}]}; X-Export-Rows / X-Export-Credits headers
carry the cost. Team names are full or short ("Boston Celtics", "ATL Hawks"); the player's own
team is not given; commence_time is often empty, so the game is found by its listed date and the
tip time comes from the store. NBA props start 2026-04-08, two-way book prices 2026-04-25 (the
playoffs): last regular season has none (checked 2026-10-11, DECISIONS.md).

A sportsbook voids a player prop when he doesn't play, so its price is P(over | plays): the same
basis as the props test's market side. Only two-way book prices count: DFS apps, exchanges and
prediction markets are skipped (settings), as are opening-line sources ("_open"). A side without
its pair, or a quote taken at or after tip, is dropped (missing, not guessed). The key is sent as a
header and never printed or logged.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

import duckdb
import numpy as np
import pandas as pd

from research_room import store
from research_room.config import ParlayConfig, Secrets, Settings, settings
from research_room.ingest.market_common import ET, GameIndex, RateLimited, american_to_prob, devig_pair
from research_room.ingest.names import resolve_and_record

SOURCE = "parlay"
CLOSING = "/v1/historical/closing-lines.json"
PROPS = "/v1/sports/{sport_key}/props"
ROW_LIMIT = 50_000
LIVE_PAGE = 10_000                                    # the props endpoint's largest page
COLUMNS = ["source", "player_name", "stat", "threshold", "over_price", "under_price", "home_team",
           "away_team", "game_date", "commence_time", "snapshot_time"]


class OverBudget(RuntimeError):
    """A run would spend more than settings.markets.parlay.max_credits_per_run."""


class Client:
    """ParlayAPI over HTTPS with the key in a header, counting the credits each call reports."""

    def __init__(self, cfg: ParlayConfig, key: str | None = None) -> None:
        key = (key if key is not None else Secrets().require("parlay_api_key")).strip()
        self.cfg, self.base = cfg, cfg.base_url.rstrip("/")
        self.http = RateLimited(cfg.requests_per_second, headers={"X-API-Key": key}, timeout=60)
        self.credits = 0

    def get(self, path: str, params: dict | None = None) -> dict:
        if self.credits >= self.cfg.max_credits_per_run:
            raise OverBudget(f"stopped at {self.credits} credits (max_credits_per_run)")
        r = self.http._send(self.base + path, params)
        self.credits += int(float(r.headers.get("X-Export-Credits") or r.headers.get("x-requests-last") or 0))
        if r.status_code in (401, 403):
            try:
                why = r.json().get("detail") or r.json()
            except ValueError:
                why = r.text[:200]
            raise PermissionError(f"ParlayAPI refused {path} (HTTP {r.status_code}): {str(why)[:300]}")
        r.raise_for_status()
        return r.json()

    def key_check(self) -> dict:
        """The free key check: valid, tier and credit headroom only (no account or billing ids)."""
        d = self.get("/v1/meta/api-key-check")
        keep = ("valid", "reason", "message", "tier", "credits_used", "credits_remaining")
        out = {k: d[k] for k in keep if k in d}
        if isinstance(d.get("subscription"), dict):
            out["subscription"] = d["subscription"].get("state")
        return out

    def live_props(self) -> list[dict]:
        """Every book's current line for the tracked stats (paged when a page comes back full)."""
        out, offset = [], 0
        while True:
            params = {"markets": ",".join(self.cfg.prop_markets), "limit": LIVE_PAGE, "offset": offset}
            page = self.get(PROPS.format(sport_key=self.cfg.sport_key), params)
            rows = page if isinstance(page, list) else []
            out += rows
            if len(rows) < LIVE_PAGE:
                return out
            offset += LIVE_PAGE

    def closing_day(self, day: str) -> dict:
        """One UTC day of NBA prop closing lines (the raw body)."""
        return self.get(CLOSING, {"date": day, "sport_key": self.cfg.sport_key, "limit": ROW_LIMIT})


def parse_closing(body: dict, cfg: ParlayConfig) -> pd.DataFrame:
    """A closing-lines body -> the rows we use: a tracked stat with both sides priced, from a
    sportsbook (not a skipped source or an opening line). Whether it was quoted before tip is
    checked in `rungs`, against the store's tip time."""
    df = pd.DataFrame((body or {}).get("rows") or [])
    if df.empty or "market_key" not in df:
        return pd.DataFrame(columns=COLUMNS)
    df = df[df["market_key"].isin(cfg.prop_markets)]
    src = df["source"].astype(str).str.lower()
    skip = {s.lower() for s in cfg.skip_sources}
    df = df[~src.isin(skip) & ~src.str.endswith("_open")].copy()
    if df.empty:
        return pd.DataFrame(columns=COLUMNS)
    df["source"] = df["source"].astype(str).str.lower()
    df["stat"] = df["market_key"].map(cfg.prop_markets)
    df["threshold"] = pd.to_numeric(df["line"], errors="coerce")
    for c in ("over_price", "under_price"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    for c in ("commence_time", "snapshot_time"):          # commence_time is often "" (2026-10-11)
        df[c] = pd.to_datetime(df[c].replace("", None), utc=True, errors="coerce", format="ISO8601")
    df["game_date"] = pd.to_datetime(df["game_date"], errors="coerce").dt.date
    ok = df["threshold"].notna() & df["over_price"].notna() & df["under_price"].notna()
    ok &= ~_junk(df["player_name"])
    return df.loc[ok, COLUMNS].reset_index(drop=True)


def _junk(names: pd.Series) -> pd.Series:
    """Rows listed as players that aren't: template text ("{optionTypeAbbr}{value} Pts") and game
    titles ("Atlanta Hawks @ Orlando Magic")."""
    n = names.astype(str)
    return n.str.contains("{", regex=False) | n.str.contains(" @ ", regex=False) | n.isin(["", "None", "nan"])


def team_codes(con) -> dict[str, str]:
    """Lower-cased full name and nickname -> BallDontLie abbreviation (NBA teams only)."""
    t = con.execute(
        "SELECT abbreviation, full_name, name FROM teams WHERE conference IS NOT NULL AND conference <> ''"
    ).df()
    out: dict[str, str] = {}
    for r in t.itertuples(index=False):
        out[str(r.full_name).lower()] = r.abbreviation
        out[str(r.name).lower()] = r.abbreviation
    return out


def team_code(name: str | None, codes: dict[str, str]) -> str | None:
    """'LA Clippers', 'Los Angeles Clippers', 'Clippers' -> 'LAC' (by full name, then nickname)."""
    if not name:
        return None
    n = str(name).strip().lower()
    if n in codes:
        return codes[n]
    found = {v for k, v in codes.items() if n.endswith(" " + k)}
    return found.pop() if len(found) == 1 else None


def _game(index: GameIndex, start, listed: date | None, home: str | None, away: str | None) -> int | None:
    """The store's game: by the league date of the start time when given, else the row's listed
    date or the day before it (a late tip falls on the next UTC day)."""
    days = [start.tz_convert(ET).date()] if pd.notna(start) else []
    if listed is not None and pd.notna(listed):
        days += [listed, listed - timedelta(days=1)]
    for d in days:
        gid = index.game_id(d, home, away)
        if gid is not None:
            return gid
    return None


def rungs(
    rows: pd.DataFrame, index: GameIndex, codes: dict[str, str], tips: dict[int, pd.Timestamp],
    max_age_hours: float = 12,
) -> pd.DataFrame:
    """Closing rows -> one rung per (game, player name, stat, line): `p_market` = the mean over
    books of each book's de-vigged P(over); `n_books`, and the books' lowest and highest. Dropped:
    rows whose game isn't in the store, and quotes without a time, taken at or after the store's
    tip (`tips`: game_id -> tip UTC: in play) or more than `max_age_hours` before it (stale)."""
    keys = ["game_id", "player_name", "home", "away", "stat", "threshold"]
    cols = [*keys, "p_market", "n_books", "p_lo", "p_hi"]
    if rows.empty:
        return pd.DataFrame(columns=cols)
    df = rows.copy()
    for c in ("commence_time", "snapshot_time"):           # an empty day concatenated in leaves object dtype
        df[c] = pd.to_datetime(df[c], utc=True, errors="coerce")
    p_over = [devig_pair(american_to_prob(o), american_to_prob(u))[0]
              for o, u in zip(df["over_price"], df["under_price"], strict=True)]
    df["p_book"] = pd.array(p_over, dtype="Float64")
    df["home"] = df["home_team"].map(lambda n: team_code(n, codes))
    df["away"] = df["away_team"].map(lambda n: team_code(n, codes))
    df["game_id"] = [_game(index, t, d, h, a) for t, d, h, a in
                     zip(df["commence_time"], df["game_date"], df["home"], df["away"], strict=True)]
    df = df[df["game_id"].notna() & df["p_book"].notna()].astype({"game_id": "int64", "p_book": float})
    tip = pd.to_datetime(df["game_id"].map(tips), utc=True)
    age = (tip - df["snapshot_time"]).dt.total_seconds() / 3600
    df = df[df["snapshot_time"].notna() & tip.notna() & (age > 0) & (age <= max_age_hours)]
    if df.empty:
        return pd.DataFrame(columns=cols)
    # A day can be listed in two files (UTC days): one quote per book, line and player-game.
    df = df.sort_values("snapshot_time").drop_duplicates(["source", *keys], keep="last")
    g = df.groupby(keys, as_index=False)
    out = g.agg(p_market=("p_book", "mean"), n_books=("source", "nunique"), p_lo=("p_book", "min"),
                p_hi=("p_book", "max"))
    return out[cols]


# ------------------------------------------------------------------ live props
LIVE_COLUMNS = ["day", "home", "away", "player_name", "stat", "threshold", "book", "over_price",
                "under_price", "ts", "market_ref"]


def parse_live(rows: list[dict], cfg: ParlayConfig, codes: dict[str, str], now: datetime) -> pd.DataFrame:
    """Live /props rows -> the quotes we keep: a tracked stat, full game, both sides priced by a
    sportsbook (no DFS flat payout, skipped source or opening line), an x.5 line, a game not yet
    started."""
    df = pd.DataFrame(rows)
    if df.empty or "market_key" not in df:
        return pd.DataFrame(columns=LIVE_COLUMNS)
    book = df["bookmaker"].astype(str).str.lower()
    skip = {s.lower() for s in cfg.skip_sources}
    keep = df["market_key"].isin(cfg.prop_markets) & ~book.isin(skip) & ~book.str.endswith("_open")
    if "is_dfs_flat_payout" in df:
        keep &= ~df["is_dfs_flat_payout"].fillna(False).astype(bool)
    if "period" in df:
        keep &= df["period"].fillna("FULL").astype(str).str.upper().eq("FULL")
    df = df[keep].assign(book=book[keep])
    if df.empty:
        return pd.DataFrame(columns=LIVE_COLUMNS)
    df["threshold"] = pd.to_numeric(df["line"], errors="coerce")
    for c in ("over_price", "under_price"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    start = pd.to_datetime(df["commence_time"].replace("", None), utc=True, errors="coerce",
                           format="ISO8601")
    listed = pd.to_datetime(df["game_date"], errors="coerce").dt.date
    df["day"] = [s.tz_convert(ET).date() if pd.notna(s) else d for s, d in zip(start, listed, strict=True)]
    df["home"] = df["home_team"].map(lambda n: team_code(n, codes))
    df["away"] = df["away_team"].map(lambda n: team_code(n, codes))
    df["player_name"] = df["player"].astype(str)
    df["stat"] = df["market_key"].map(cfg.prop_markets)
    quoted = pd.to_datetime(df["last_update"], utc=True, errors="coerce", format="ISO8601")
    df["ts"] = quoted.fillna(pd.Timestamp(now))
    df["market_ref"] = df.get("event_id")
    ok = (df["threshold"].notna() & (df["threshold"] % 1 != 0)
          & df["over_price"].notna() & df["under_price"].notna()
          & df["home"].notna() & df["away"].notna() & (start.isna() | (start > pd.Timestamp(now)))
          & ~_junk(df["player_name"]))
    return df.loc[ok, LIVE_COLUMNS].reset_index(drop=True)


def sync(
    con: duckdb.DuckDBPyConnection,
    cfg: Settings | None = None,
    client: Client | None = None,
    now: datetime | None = None,
) -> dict[str, int]:
    """Archive the books' current player props for upcoming games (one /props read)."""
    cfg = cfg or settings()
    pc = cfg.markets.parlay
    client = client or Client(pc)
    now = now or store.utcnow()
    q = parse_live(client.live_props(), pc, team_codes(con), now)
    counts = {"prop_lines": 0, "unmatched_props": 0}
    if q.empty:
        return counts
    games = GameIndex(con)
    q["game_id"] = [games.game_id(r.day, r.home, r.away) for r in q.itertuples()]
    names = q.drop_duplicates("player_name")
    names = pd.DataFrame({"source_key": names["player_name"], "raw_name": names["player_name"],
                          "team_abbr": None}).reset_index(drop=True)
    pid = dict(zip(names["source_key"], resolve_and_record(con, SOURCE, names), strict=True))
    q["player_id"] = q["player_name"].map(pid)
    ok = q["player_id"].notna() & q["game_id"].notna()
    counts["unmatched_props"] = int((~ok).sum())
    q = q[ok].drop_duplicates(["game_id", "player_id", "stat", "threshold", "book"], keep="last")
    pairs = [devig_pair(american_to_prob(o), american_to_prob(u))
             for o, u in zip(q["over_price"], q["under_price"], strict=True)]
    base = q.assign(game_id=q["game_id"].astype(int), player_id=q["player_id"].astype(int), source=SOURCE,
                    vendor="parlay:" + q["book"], volume=np.nan, bid=np.nan, ask=np.nan, open_interest=np.nan,
                    fetched_at=now)
    rows = pd.concat([
        base.assign(side="over", price=q["over_price"], prob=[a for a, _ in pairs]),
        base.assign(side="under", price=q["under_price"], prob=[b for _, b in pairs]),
    ], ignore_index=True)
    counts["prop_lines"] = store.upsert(con, "props_ladder", rows[[
        "source", "game_id", "player_id", "stat", "threshold", "side", "prob", "price", "volume", "vendor",
        "ts", "bid", "ask", "open_interest", "market_ref", "fetched_at"]])
    return counts

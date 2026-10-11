"""ParlayAPI (PARLAY_API_KEY): sportsbook player-prop closing lines, for the props test.

Inputs: GET {base_url}/v1/historical/closing-lines.json?date=YYYY-MM-DD&sport_key=... (one UTC day
per request, 1 credit per 1,000 rows delivered; the Enterprise plan reads one year back) and the
free GET /v1/meta/api-key-check; settings.markets.parlay; the store's games and teams.
Outputs: closing rows (one per book, player, stat, line: American over/under prices) and rungs:
per (game, player, stat, line) the books' consensus P(over), de-vigged within each book's pair.
Tables: none written; reads games, teams.

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

from datetime import date, timedelta

import pandas as pd

from research_room.config import ParlayConfig, Secrets
from research_room.ingest.market_common import ET, GameIndex, RateLimited, american_to_prob, devig_pair

SOURCE = "parlay"
CLOSING = "/v1/historical/closing-lines.json"
ROW_LIMIT = 50_000
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
    name = df["player_name"].astype(str)
    # template text and game titles listed as players
    junk = name.str.contains("{", regex=False) | name.str.contains(" @ ", regex=False)
    ok = df["threshold"].notna() & df["over_price"].notna() & df["under_price"].notna() & ~junk
    return df.loc[ok, COLUMNS].reset_index(drop=True)


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

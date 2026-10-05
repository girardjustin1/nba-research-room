"""The NBA's official injury report: every listed player's status for today's games.

Inputs: the league's public PDF reports (settings.nba_report.base_url), games, teams, players.
Outputs: nba_report_rows (one row per listed player per report: status and reason) and
nba_report_teams (one row per team-game per report: whether the team has submitted), so
overrides.py can read both who is listed and who is not. Tables: writes nba_report_rows,
nba_report_teams, player_xref, unresolved_names; reads games, teams, players.

The report (checked 2026-10-05 against 2024-25 and 2025-26): a PDF published through each game
day, named `Injury-Report_<YYYY-MM-DD>_<HH>_<MM>{AM,PM}.pdf` since late December 2025 and
`..._<HH>{AM,PM}.pdf` before. Its text reads, line by line: game date, tip time, matchup
(AWY@HOM), team, "Last, First", status (Out, Doubtful, Questionable, Probable, Available) and
reason, each carried down from the line above when blank; a team that hasn't filed yet reads
"NOT YET SUBMITTED". The text must be read with a tight character gap (x_tolerance 1.5), or
names lose their spaces ("ButlerIII,Jimmy").

Why it matters (DECISIONS.md, teammates out): the league requires every injured or resting
player to be listed, so for a team that has filed, a rotation player who isn't listed is very
likely to play. Read that way, the report took the teammates-out gain from -2.0% to -4.4% in
minutes error on 2025-26. Statuses calibrate P(plays) (settings.overrides.status_play_prob).
Unmatched names are quarantined, never guessed.
"""

from __future__ import annotations

import io
import re
from datetime import datetime, timedelta

import duckdb
import pandas as pd

from research_room import store
from research_room.config import Settings, settings
from research_room.ingest.market_common import ET, RateLimited
from research_room.ingest.names import normalize_name, resolve_and_record

SOURCE = "nba_report"
STATUSES = ("Out", "Doubtful", "Questionable", "Probable", "Available")
_HEADER = re.compile(r"Injury Report:\s*(\d{2}/\d{2}/\d{2})\s+(\d{1,2}:\d{2})\s*(AM|PM)")
_DATE = re.compile(r"^(\d{2}/\d{2}/\d{4})\s+")
_TIME = re.compile(r"^\d{1,2}:\d{2}\s*\(ET\)\s+")
_MATCHUP = re.compile(r"^([A-Z]{2,3})@([A-Z]{2,3})\s+")
_PLAYER = re.compile(
    r"^(?P<last>[^,]+),\s*(?P<first>.+?)\s+(?P<status>" + "|".join(STATUSES) + r")\b\s*(?P<reason>.*)$"
)
NOT_SUBMITTED = "NOT YET SUBMITTED"


def report_names(when: datetime) -> list[str]:
    """File names to try for the report published at `when` (Eastern): the current format, then
    the older hourly one."""
    t = when.astimezone(ET)
    hh, ap = t.strftime("%I"), t.strftime("%p")
    names = [f"Injury-Report_{t:%Y-%m-%d}_{hh}_{t:%M}{ap}.pdf"]
    if t.minute == 0:
        names.append(f"Injury-Report_{t:%Y-%m-%d}_{hh}{ap}.pdf")
    return names


def candidates(now: datetime, cfg: Settings) -> list[str]:
    """Newest first: every publishing slot from now back `lookback_minutes`."""
    nr = cfg.nba_report
    t = now.astimezone(ET)
    t = t.replace(minute=t.minute - t.minute % nr.step_minutes, second=0, microsecond=0)
    out = []
    for k in range(nr.lookback_minutes // nr.step_minutes + 1):
        out += report_names(t - timedelta(minutes=k * nr.step_minutes))
    return out


def team_names(con: duckdb.DuckDBPyConnection) -> dict[str, int]:
    """Normalized full team name -> team_id (the report spells teams out)."""
    t = con.execute("SELECT team_id, full_name FROM teams WHERE full_name IS NOT NULL").df()
    out = {normalize_name(n): int(i) for i, n in zip(t["team_id"], t["full_name"], strict=True)}
    for alt, canon in (("los angeles clippers", "la clippers"), ("la clippers", "los angeles clippers")):
        if canon in out and alt not in out:
            out[alt] = out[canon]
    return out


def parse_text(text: str, teams: dict[str, int]) -> tuple[datetime | None, pd.DataFrame, pd.DataFrame]:
    """(report time, listed players, team-games seen) from the report's text. Pure.

    Players: game_date, away, home, team_id, raw_name ("First Last"), status, reason.
    Team-games: game_date, away, home, team_id, submitted (False when "NOT YET SUBMITTED")."""
    ts = None
    m = _HEADER.search(text)
    if m:
        ts = pd.Timestamp(datetime.strptime(" ".join(m.groups()), "%m/%d/%y %I:%M %p"), tz=ET).to_pydatetime()
    by_len = sorted(teams, key=len, reverse=True)
    rows, seen = [], {}
    day = matchup = team = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith(("Injury Report:", "Game Date", "Page ")):
            continue
        if (d := _DATE.match(line)):
            day, line = datetime.strptime(d.group(1), "%m/%d/%Y").date(), line[d.end():]
        if (t := _TIME.match(line)):
            line = line[t.end():]
        if (mu := _MATCHUP.match(line)):
            matchup, team, line = (mu.group(1), mu.group(2)), None, line[mu.end():]
        low = normalize_name(line)
        for name in by_len:
            if low.startswith(name + " ") or low == name:
                team = teams[name]
                n_words = len(name.split())
                line = " ".join(line.split()[n_words:])          # drop the team's words
                break
        if day is None or matchup is None or team is None:
            continue
        key = (day, matchup[0], matchup[1], team)
        if line.startswith(NOT_SUBMITTED):
            seen[key] = False
            continue
        seen.setdefault(key, True)
        if (p := _PLAYER.match(line)):
            rows.append({"game_date": day, "away": matchup[0], "home": matchup[1], "team_id": team,
                         "raw_name": f"{p.group('first').strip()} {p.group('last').strip()}",
                         "status": p.group("status"), "reason": p.group("reason").strip()[:200]})
    players = pd.DataFrame(
        rows, columns=["game_date", "away", "home", "team_id", "raw_name", "status", "reason"]
    )
    team_games = pd.DataFrame(
        [{"game_date": k[0], "away": k[1], "home": k[2], "team_id": k[3], "submitted": v}
         for k, v in seen.items()],
        columns=["game_date", "away", "home", "team_id", "submitted"],
    )
    return ts, players, team_games


def pdf_text(content: bytes) -> str:
    import pdfplumber  # only the report job needs it

    with pdfplumber.open(io.BytesIO(content)) as pdf:
        return "\n".join(page.extract_text(x_tolerance=1.5) or "" for page in pdf.pages)


def fetch_latest(client: RateLimited, now: datetime, cfg: Settings) -> tuple[str, bytes] | None:
    """The newest published report within the lookback, or None."""
    for name in candidates(now, cfg):
        content = client.get_bytes(cfg.nba_report.base_url + name)
        if content is not None and content[:4] == b"%PDF":
            return name, content
    return None


def _game_ids(con: duckdb.DuckDBPyConnection, frame: pd.DataFrame) -> pd.Series:
    """(game_date, team_id) -> that team's game that day."""
    g = con.execute("""
        SELECT game_id, game_date, home_team_id, visitor_team_id FROM games
        WHERE NOT coalesce(postseason, false)
    """).df()
    lookup = {}
    for r in g.itertuples(index=False):
        d = pd.Timestamp(r.game_date).date()
        lookup[(d, int(r.home_team_id))] = int(r.game_id)
        lookup[(d, int(r.visitor_team_id))] = int(r.game_id)
    keys = zip(frame["game_date"], frame["team_id"], strict=True)
    return pd.Series([lookup.get((d, int(t))) for d, t in keys], index=frame.index, dtype="Int64")


def sync(
    con: duckdb.DuckDBPyConnection,
    cfg: Settings | None = None,
    client: RateLimited | None = None,
    now: datetime | None = None,
) -> dict:
    """Read the newest report and store it (once per report). Returns counts."""
    cfg = cfg or settings()
    now = now or store.utcnow()
    client = client or RateLimited(cfg.nba_report.requests_per_second, headers={"User-Agent": "Mozilla/5.0"})
    got = fetch_latest(client, now, cfg)
    if got is None:
        minutes = cfg.nba_report.lookback_minutes
        return {"status": "skipped", "reason": f"no report in the last {minutes} minutes"}
    name, content = got
    ts, players, team_games = parse_text(pdf_text(content), team_names(con))
    if ts is None:
        return {"status": "error", "reason": f"{name}: no report time in the text"}
    have = con.execute("SELECT count(*) FROM nba_report_teams WHERE report_ts = ?", [ts]).fetchone()[0]
    if have:
        return {"status": "unchanged", "report": name}
    fetched = store.utcnow()
    team_games["game_id"] = _game_ids(con, team_games)
    team_games = team_games[team_games["game_id"].notna()]
    store.upsert(con, "nba_report_teams", team_games.assign(
        report_ts=ts, game_id=team_games["game_id"].astype(int), source=SOURCE, fetched_at=fetched,
    )[["report_ts", "game_id", "team_id", "submitted", "source", "fetched_at"]])
    written = unmatched = 0
    if not players.empty:
        abbr = dict(con.execute("SELECT team_id, abbreviation FROM teams").fetchall())
        players["game_id"] = _game_ids(con, players)
        names = pd.DataFrame({
            "source_key": players["raw_name"] + "|" + players["team_id"].map(abbr).fillna(""),
            "raw_name": players["raw_name"],
            "team_abbr": players["team_id"].map(abbr),
        }).drop_duplicates("source_key").reset_index(drop=True)
        ids = dict(zip(names["source_key"], resolve_and_record(con, SOURCE, names), strict=True))
        players["player_id"] = (players["raw_name"] + "|" + players["team_id"].map(abbr).fillna("")).map(ids)
        ok = players["player_id"].notna() & players["game_id"].notna()
        unmatched = int((~ok).sum())
        rows = players[ok].drop_duplicates(["game_id", "player_id"])
        written = store.upsert(con, "nba_report_rows", rows.assign(
            report_ts=ts, game_id=rows["game_id"].astype(int), player_id=rows["player_id"].astype(int),
            source=SOURCE, fetched_at=fetched,
        )[["report_ts", "game_id", "team_id", "player_id", "status", "reason", "source", "fetched_at"]])
    return {"status": "ok", "report": name, "report_ts": str(ts), "players": written,
            "unmatched": unmatched, "teams": int(len(team_games)),
            "not_submitted": int((~team_games["submitted"]).sum())}


def latest_report_ts(con: duckdb.DuckDBPyConnection, as_of: datetime) -> datetime | None:
    if not store.has_table(con, "nba_report_teams"):
        return None
    row = con.execute("SELECT max(report_ts) FROM nba_report_teams WHERE report_ts <= ?", [as_of]).fetchone()
    return row[0] if row and row[0] is not None else None

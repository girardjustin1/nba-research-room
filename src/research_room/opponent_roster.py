"""This week's opponent, entered by hand: who is on the team I play this week.

Inputs: what the owner types on the Teams → This week's opponent screen (the opponent's team,
the week, and players picked from the NBA list or pasted by name); players and teams (NBA data,
BallDontLie); settings.league, settings.season.
Outputs: OpponentRoster responses (web/src/api/season.ts); the in-memory Yahoo tables of one
connection get the opponent's roster and the week's pairing when Yahoo itself didn't supply them
(`apply`, called by ingest/yahoo_live.attach). Tables: none; the entry is one small file,
data/inbox/opponent.json.

Kept to the Yahoo data policy (ingest/yahoo_live.py): one opponent at a time, replaced by the
next week's entry (never an archive of past opponents or a log of every team), read live, never
written to the store, deleted by `make yahoo-purge`. Names and positions come from the NBA data.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path

import duckdb
import pandas as pd

from research_room import schedule, store
from research_room.config import Settings, settings
from research_room.ingest.names import NameResolver, load_aliases, load_team_aliases, player_universe

FILE = "opponent.json"
POLICY = (
    "One opponent at a time, replaced each week. Kept on this computer only and never in the "
    "database; names and positions come from the NBA data."
)


def _path(cfg: Settings) -> Path:
    return Path(cfg.paths.inbox_dir) / FILE


def _week(cfg: Settings, now: datetime | None) -> dict | None:
    when = pd.Timestamp(now or store.utcnow())
    when = when if when.tzinfo else when.tz_localize("UTC")
    day = when.tz_convert("America/New_York").date()
    weeks = schedule.fantasy_weeks(cfg.season).set_index("week")
    w = schedule.week_of(day, cfg.season)
    if w is None:  # before the season: the first week
        future = weeks[weeks["start"] > day]
        if future.empty:
            return None
        w = int(future.index[0])
    return {"week": int(w), "start": str(weeks.at[w, "start"]), "end": str(weeks.at[w, "end"])}


def read(cfg: Settings | None = None) -> dict | None:
    """The saved entry, or None."""
    cfg = cfg or settings()
    try:
        return json.loads(_path(cfg).read_text())
    except (OSError, ValueError):
        return None


def _cards(con: duckdb.DuckDBPyConnection, ids: list[int]) -> list[dict]:
    from research_room.backtest import eligibility

    if not ids:
        return []
    rows = con.execute(
        f"""SELECT p.player_id, p.full_name, p.position, t.abbreviation FROM players p
            LEFT JOIN teams t ON t.team_id = p.team_id WHERE p.player_id IN ({",".join("?" * len(ids))})""",
        ids,
    ).fetchall()
    by = {int(r[0]): r for r in rows}
    out = []
    for pid in ids:
        r = by.get(int(pid))
        if r is None:
            continue
        out.append(
            {
                "player_id": int(r[0]),
                "name": r[1],
                "team_abbr": r[3],
                "eligible": list(dict.fromkeys([*eligibility(r[2]), "Util"])),
                "headshot_url": f"/images/players/{int(r[0])}.png",
                "team_logo_url": f"/images/teams/{r[3]}.svg" if r[3] else None,
                "owner": "opponent",
                "status": {
                    "code": "healthy",
                    "label": "",
                    "play_prob": None,
                    "minutes_cap": None,
                    "note": None,
                    "source": None,
                    "as_of": pd.Timestamp(store.utcnow()).isoformat(),
                },
                "pct_rostered": None,
            }
        )
    return out


def response(
    con: duckdb.DuckDBPyConnection,
    cfg: Settings | None = None,
    now: datetime | None = None,
    unmatched: list[dict] | None = None,
) -> dict:
    """OpponentRoster: this week's entry (an entry for another week is not shown: it is replaced)."""
    cfg = cfg or settings()
    wk = _week(cfg, now)
    e = read(cfg)
    current = e if e and wk and e.get("week") == wk["week"] else None
    return {
        "week": wk,
        "teams": [
            {"team_id": t, "label": f"Team {t}"}
            for t in range(1, cfg.league.teams + 1)
            if t != cfg.league.my_team_id
        ],
        "opponent_team_id": current["team_id"] if current else None,
        "players": _cards(con, current["player_ids"]) if current else [],
        "unmatched": unmatched or [],
        "saved_at": current["saved_at"] if current else None,
        "policy": POLICY,
    }


def save(
    con: duckdb.DuckDBPyConnection,
    team_id: int,
    player_ids: list[int],
    names: list[str],
    cfg: Settings | None = None,
    now: datetime | None = None,
) -> dict:
    """Replace the entry with this week's opponent: picked players plus pasted names matched to NBA
    players (names that don't match come back with suggestions, and aren't kept)."""
    cfg = cfg or settings()
    if not 1 <= int(team_id) <= cfg.league.teams or int(team_id) == cfg.league.my_team_id:
        raise ValueError(f"the opponent is a team 1..{cfg.league.teams} other than yours")
    wk = _week(cfg, now)
    if wk is None:
        raise ValueError("no fantasy week to enter an opponent for")
    resolver = NameResolver(player_universe(con), load_aliases(), load_team_aliases())
    ids = [int(p) for p in player_ids]
    unmatched = []
    for raw in names:
        name = raw.strip()
        if not name:
            continue
        res = resolver.resolve(name, None)
        if res.player_id is not None:
            ids.append(int(res.player_id))
        else:
            unmatched.append({"name": name, "suggestions": list(res.candidates)[:3]})
    ids = list(dict.fromkeys(ids))
    most = len(cfg.roster.slots)
    if len(ids) > most:
        raise ValueError(f"a roster has at most {most} players")
    entry = {
        "week": wk["week"],
        "team_id": int(team_id),
        "player_ids": ids,
        "saved_at": pd.Timestamp(now or store.utcnow()).isoformat(),
    }
    p = _path(cfg)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(entry))
    os.replace(tmp, p)
    return response(con, cfg, now, unmatched)


def apply(con: duckdb.DuckDBPyConnection, cfg: Settings | None = None, now: datetime | None = None) -> dict:
    """Put this week's entry into the connection's in-memory Yahoo tables when Yahoo didn't supply
    the opponent: his roster, and the week's pairing if there is none (its totals unknown)."""
    cfg = cfg or settings()
    e, wk = read(cfg), _week(cfg, now)
    if not e or not wk or e.get("week") != wk["week"] or not e.get("player_ids"):
        return {"applied": False}
    me, opp, week = cfg.league.my_team_id, int(e["team_id"]), wk["week"]
    has = con.execute("SELECT count(*) FROM yahoo_rosters WHERE team_id = ?", [opp]).fetchone()[0]
    at = pd.Timestamp(e["saved_at"])
    out = {"applied": True, "roster": False, "pairing": False}
    if not has:
        cards = _cards(con, e["player_ids"])
        store.upsert(
            con,
            "yahoo_rosters",
            pd.DataFrame(
                [
                    {
                        "snapshot_at": at,
                        "team_id": opp,
                        "yahoo_player_key": f"manual:{c['player_id']}",
                        "player_name": c["name"],
                        "player_id": c["player_id"],
                        "selected_slot": None,
                        "eligible_positions": ",".join(x for x in c["eligible"] if x != "Util"),
                        "status": None,
                        "source": "manual",
                        "fetched_at": at,
                    }
                    for c in cards
                ]
            ),
        )
        out["roster"] = True
    paired = con.execute(
        "SELECT count(*) FROM yahoo_matchups WHERE week = ? AND team_id = ?", [week, me]
    ).fetchone()[0]
    if not paired:
        start = pd.Timestamp(wk["start"]).tz_localize("America/New_York").tz_convert("UTC")
        store.upsert(
            con,
            "yahoo_matchups",
            pd.DataFrame(
                [
                    {
                        "snapshot_at": start,
                        "week": week,
                        "team_id": a,
                        "opponent_team_id": b,
                        "source": "manual",
                        "fetched_at": at,
                    }
                    for a, b in ((me, opp), (opp, me))
                ]
            ),
        )
        out["pairing"] = True
    return out


def is_manual_pairing(rows: pd.DataFrame) -> bool:
    return "source" in rows and (rows["source"] == "manual").any()


def search(con: duckdb.DuckDBPyConnection, q: str, limit: int = 10) -> list[dict]:
    """NBA players on a team whose name contains `q`, as player cards (for picking an opponent's)."""
    from research_room.ingest.names import normalize_name

    key = normalize_name(q)
    if len(key) < 2:
        return []
    names = {
        int(pid): name
        for pid, name in con.execute(
            "SELECT player_id, full_name FROM players WHERE team_id IS NOT NULL"
        ).fetchall()
    }
    hits = [pid for pid, name in names.items() if key in normalize_name(name)]
    hits.sort(key=lambda pid: (not normalize_name(names[pid]).startswith(key), names[pid]))
    return _cards(con, hits[:limit])

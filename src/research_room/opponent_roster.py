"""This week's opponent, entered by hand: who is on the team I play this week.

Inputs: what the owner types on the Teams → This week's opponent screen (the opponent's team,
the week, and players picked from the NBA list or pasted by name); players and teams (NBA data,
BallDontLie); settings.league, settings.season.
Outputs: OpponentRoster responses (web/src/api/season.ts); the in-memory Yahoo tables of one
connection get the opponent's roster and the week's pairing when Yahoo itself didn't supply them
(`apply`, called by ingest/yahoo_live.attach). Tables: none; the entry is one small file,
data/inbox/opponent.json.

Kept to the Yahoo data policy (ingest/yahoo_live.py): team names (league_teams.json), and one
opponent's roster at a time, replaced by the next week's entry (never an archive of past opponents,
never every team's roster), read live, never written to the store, deleted by `make yahoo-purge`.
Players' names and positions come from the NBA data.
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
NAMES_FILE = "league_teams.json"
POLICY = (
    "Team names, and one opponent's roster at a time, replaced each week. Kept on this computer "
    "only and never in the database; players' names and positions come from the NBA data."
)
MAX_NAME = 40


def _path(cfg: Settings) -> Path:
    return Path(cfg.paths.inbox_dir) / FILE


def _names_path(cfg: Settings) -> Path:
    return Path(cfg.paths.inbox_dir) / NAMES_FILE


def _write(p: Path, obj: dict) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj))
    os.replace(tmp, p)


def team_names(cfg: Settings | None = None) -> dict[int, str]:
    """team_id -> the name I gave it (league teams other than mine; unnamed ones absent)."""
    cfg = cfg or settings()
    try:
        raw = json.loads(_names_path(cfg).read_text())
    except (OSError, ValueError):
        return {}
    return {int(k): str(v) for k, v in (raw.get("teams") or {}).items() if str(v).strip()}


def _clean(name: str | None) -> str | None:
    n = " ".join(str(name or "").split())[:MAX_NAME]
    return n or None


def set_team_names(names: dict[int, str | None], cfg: Settings | None = None) -> dict[int, str]:
    """Register or rename league teams (a blank name removes it). Returns all names."""
    cfg = cfg or settings()
    out = team_names(cfg)
    for t, n in names.items():
        t = int(t)
        if not 1 <= t <= cfg.league.teams or t == cfg.league.my_team_id:
            raise ValueError(f"a league team is 1..{cfg.league.teams} other than yours")
        if _clean(n):
            out[t] = _clean(n)
        else:
            out.pop(t, None)
    _write(_names_path(cfg), {"teams": {str(k): v for k, v in sorted(out.items())}})
    return out


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
    names = team_names(cfg)
    return {
        "week": wk,
        "teams": [
            {"team_id": t, "label": names.get(t) or f"Team {t}", "name": names.get(t)}
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
    team_name: str | None = None,
) -> dict:
    """Replace the entry with this week's opponent: picked players plus pasted names matched to NBA
    players (names that don't match come back with suggestions, and aren't kept). `team_name`
    registers or renames that team."""
    cfg = cfg or settings()
    if not 1 <= int(team_id) <= cfg.league.teams or int(team_id) == cfg.league.my_team_id:
        raise ValueError(f"the opponent is a team 1..{cfg.league.teams} other than yours")
    wk = _week(cfg, now)
    if wk is None:
        raise ValueError("no fantasy week to enter an opponent for")
    ids, unmatched = _resolve(con, player_ids, names, cfg)
    entry = {
        "week": wk["week"],
        "team_id": int(team_id),
        "player_ids": ids,
        "saved_at": pd.Timestamp(now or store.utcnow()).isoformat(),
    }
    _write(_path(cfg), entry)
    if team_name is not None:
        set_team_names({int(team_id): team_name}, cfg)
    return response(con, cfg, now, unmatched)


def _resolve(
    con: duckdb.DuckDBPyConnection, player_ids: list[int], names: list[str], cfg: Settings
) -> tuple[list[int], list[dict]]:
    """Picked players plus pasted names matched to NBA players; misses come back with suggestions."""
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
    return ids, unmatched


# -------------------------------------------------------------------- my roster, entered by hand
MINE_FILE = "my_roster.json"
MINE_POLICY = (
    "Your roster, kept on this computer only and never in the database; replaced each time you save. "
    "When Yahoo supplies your roster, Yahoo's is used instead."
)


def _mine_path(cfg: Settings) -> Path:
    return Path(cfg.paths.inbox_dir) / MINE_FILE


def read_mine(cfg: Settings | None = None) -> dict | None:
    cfg = cfg or settings()
    try:
        return json.loads(_mine_path(cfg).read_text())
    except (OSError, ValueError):
        return None


def my_response(
    con: duckdb.DuckDBPyConnection, cfg: Settings | None = None, unmatched: list[dict] | None = None
) -> dict:
    """MyRoster: my team as entered (players, who is on IL), or empty."""
    cfg = cfg or settings()
    e = read_mine(cfg) or {}
    cards = [{**c, "owner": "mine"} for c in _cards(con, e.get("player_ids", []))]
    return {
        "players": cards,
        "il_ids": [int(i) for i in e.get("il_ids", []) if int(i) in {c["player_id"] for c in cards}],
        "max_players": len(cfg.roster.slots),
        "teams": cfg.league.teams,
        "unmatched": unmatched or [],
        "saved_at": e.get("saved_at"),
        "policy": MINE_POLICY,
    }


def save_mine(
    con: duckdb.DuckDBPyConnection,
    player_ids: list[int],
    names: list[str],
    il_ids: list[int],
    cfg: Settings | None = None,
    now: datetime | None = None,
) -> dict:
    """Replace my roster with these players (pasted names matched to NBA players)."""
    cfg = cfg or settings()
    ids, unmatched = _resolve(con, player_ids, names, cfg)
    entry = {
        "player_ids": ids,
        "il_ids": [int(i) for i in il_ids if int(i) in ids],
        "saved_at": pd.Timestamp(now or store.utcnow()).isoformat(),
    }
    _write(_mine_path(cfg), entry)
    return my_response(con, cfg, unmatched)


def mine_from_draft(
    con: duckdb.DuckDBPyConnection,
    draft_id: str,
    slot: int,
    cfg: Settings | None = None,
    now: datetime | None = None,
) -> dict:
    """Replace my roster with my picks in this draft (slot `slot`), from the draft room's own log.
    Raises ValueError when the draft has no picks for that slot."""
    from research_room.draft import tracker

    cfg = cfg or settings()
    if not 1 <= slot <= cfg.league.teams:
        raise ValueError(f"draft slot must be 1..{cfg.league.teams}")
    picks = tracker._read_picks(con, draft_id)
    ids = [int(p) for p in picks.loc[picks["team_id"] == slot, "player_id"]]
    if not ids:
        raise ValueError(f"no picks for slot {slot} in draft {draft_id}")
    return save_mine(con, ids, [], [], cfg, now)


def apply_mine(con: duckdb.DuckDBPyConnection, cfg: Settings | None = None) -> dict:
    """My entered roster into the connection's in-memory Yahoo tables when Yahoo didn't supply it.
    My current lineup isn't known, so every slot is open except the IL."""
    cfg = cfg or settings()
    e, me = read_mine(cfg), cfg.league.my_team_id
    if not e or not e.get("player_ids"):
        return {"applied": False}
    if con.execute("SELECT count(*) FROM yahoo_rosters WHERE team_id = ?", [me]).fetchone()[0]:
        return {"applied": False, "reason": "Yahoo supplied my roster"}
    at = pd.Timestamp(e["saved_at"])
    il = {int(i) for i in e.get("il_ids", [])}
    store.upsert(
        con,
        "yahoo_rosters",
        pd.DataFrame(
            [
                {
                    "snapshot_at": at,
                    "team_id": me,
                    "yahoo_player_key": f"manual:{c['player_id']}",
                    "player_name": c["name"],
                    "player_id": c["player_id"],
                    "selected_slot": "IL" if c["player_id"] in il else None,
                    "eligible_positions": ",".join(x for x in c["eligible"] if x != "Util"),
                    "status": None,
                    "source": "manual",
                    "fetched_at": at,
                }
                for c in _cards(con, e["player_ids"])
            ]
        ),
    )
    return {"applied": True, "players": len(e["player_ids"])}


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

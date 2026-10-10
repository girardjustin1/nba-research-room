"""Free agents, pasted by hand from Yahoo's Players page: who I could add, when the app can't read
Yahoo.

Inputs: the text the owner pastes on League → Team → Free agents (copied straight from Yahoo's
Players page: names among positions, stats and notes); players and teams (NBA data, BallDontLie);
config/aliases.yaml.
Outputs: FreeAgents responses (web/src/api/season.ts); the in-memory Yahoo tables of one connection
get the list as `yahoo_players` rows when Yahoo itself didn't supply them (`apply`, called by
ingest/yahoo_live.attach), which is what the moves page and the saved plan read. Tables: none; the
entry is one small file, data/inbox/free_agents.json (NBA player ids and a time, no Yahoo text).

Kept to the Yahoo data policy (ingest/yahoo_live.py): one list at a time, replaced by the next
paste, never in the store, deleted by `make yahoo-purge`. The pasted text is scanned and dropped;
only the NBA ids found in it are kept. Names and positions come from the NBA data, so positions
are the NBA's, not Yahoo's (the draft board's Yahoo eligibility never reads these rows).

Reading the paste: every run of 2-4 words is looked up against the NBA players' names (accents,
case, punctuation and Jr./III ignored; aliases.yaml nicknames included). A name shared by two
players is skipped and reported, never guessed. Players on my roster or this week's opponent's are
left out. The list goes stale as other teams add and drop: the page shows its age.
"""

from __future__ import annotations

import json
import re
import unicodedata
from datetime import datetime
from pathlib import Path

import duckdb
import pandas as pd

from research_room import store
from research_room.config import Settings, settings
from research_room.ingest.names import load_aliases, player_universe

FILE = "free_agents.json"
POLICY = (
    "The free agents you pasted, kept on this computer only and never in the database: only the "
    "players found are kept, not the text. Replaced each time you paste; when Yahoo supplies the "
    "list, Yahoo's is used instead. Check a player is still free in Yahoo before adding him."
)
MAX_TEXT = 300_000      # characters: a long Players page, several times over
MAX_PLAYERS = 600       # more than every unrostered NBA player
_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}
_SPANS = (4, 3, 2)      # longest first, so "Jaren Jackson Jr." wins over "Jaren Jackson"


def _path(cfg: Settings) -> Path:
    return Path(cfg.paths.inbox_dir) / FILE


def _tokens(text: str) -> list[str]:
    """Words for matching: accents, case and punctuation dropped, suffixes removed anywhere."""
    t = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode().lower()
    t = re.sub(r"[.'’`]", "", t.replace("-", " "))
    return [w for w in re.sub(r"[^a-z0-9 ]", " ", t).split() if w not in _SUFFIXES]


def _name_index(con: duckdb.DuckDBPyConnection) -> dict[str, set[int]]:
    """Name key -> player ids, for current NBA players (on a team) and their aliases."""
    uni = player_universe(con)
    uni = uni[uni["team_abbr"].notna()]
    idx: dict[str, set[int]] = {}
    for pid, name in zip(uni["player_id"], uni["full_name"], strict=True):
        key = " ".join(_tokens(name))
        if len(key.split()) >= 2:
            idx.setdefault(key, set()).add(int(pid))
    known = set(int(p) for p in uni["player_id"])
    for a in load_aliases():
        pid = a.get("player_id")
        if pid is None or int(pid) not in known:
            continue
        for v in a.get("variants") or []:
            idx.setdefault(" ".join(_tokens(v)), set()).add(int(pid))
    return idx


def find_players(con: duckdb.DuckDBPyConnection, text: str) -> tuple[list[int], list[str]]:
    """(player ids in the order they appear, names shared by more than one player)."""
    idx = _name_index(con)
    found: list[int] = []
    ambiguous: list[str] = []
    for line in str(text).splitlines():
        words = _tokens(line)
        i = 0
        while i < len(words):
            for n in _SPANS:
                key = " ".join(words[i : i + n])
                if len(words) - i >= n and key in idx:
                    ids = idx[key]
                    if len(ids) == 1:
                        found.append(next(iter(ids)))
                    elif key not in ambiguous:
                        ambiguous.append(key)
                    i += n
                    break
            else:
                i += 1
    return list(dict.fromkeys(found)), ambiguous


def read(cfg: Settings | None = None) -> dict | None:
    cfg = cfg or settings()
    try:
        return json.loads(_path(cfg).read_text())
    except (OSError, ValueError):
        return None


def response(
    con: duckdb.DuckDBPyConnection,
    cfg: Settings | None = None,
    now: datetime | None = None,
    ambiguous: list[str] | None = None,
) -> dict:
    """FreeAgents: the pasted list (NBA names and positions), its age, and the policy."""
    from research_room.opponent_roster import _cards

    cfg = cfg or settings()
    e = read(cfg) or {}
    cards = [{**c, "owner": "free_agent"} for c in _cards(con, e.get("player_ids", []))]
    saved = e.get("saved_at")
    when = pd.Timestamp(now or store.utcnow())
    when = when if when.tzinfo else when.tz_localize("UTC")
    age = round((when - pd.Timestamp(saved)).total_seconds() / 3600, 1) if saved else None
    return {
        "players": cards,
        "saved_at": saved,
        "age_hours": age,
        "ambiguous": ambiguous or [],
        "policy": POLICY,
    }


def save(
    con: duckdb.DuckDBPyConnection, text: str, cfg: Settings | None = None, now: datetime | None = None
) -> dict:
    """Replace the list with the players found in `text` (the text itself isn't kept)."""
    from research_room.opponent_roster import _write

    cfg = cfg or settings()
    if len(text) > MAX_TEXT:
        raise ValueError(f"that paste is too long (over {MAX_TEXT:,} characters)")
    ids, ambiguous = find_players(con, text)
    if not ids:
        raise ValueError("no NBA player names found in that text")
    _write(_path(cfg), {"player_ids": ids[:MAX_PLAYERS],
                        "saved_at": pd.Timestamp(now or store.utcnow()).isoformat()})
    return response(con, cfg, now, ambiguous)


def apply(con: duckdb.DuckDBPyConnection, cfg: Settings | None = None) -> dict:
    """The pasted list into the connection's in-memory Yahoo tables when Yahoo didn't supply free
    agents, minus anyone on a roster loaded here (mine, this week's opponent)."""
    from research_room.opponent_roster import _cards

    cfg = cfg or settings()
    e = read(cfg)
    if not e or not e.get("player_ids"):
        return {"applied": False}
    if con.execute("SELECT count(*) FROM yahoo_players WHERE source <> 'manual'").fetchone()[0]:
        return {"applied": False, "reason": "Yahoo supplied the free agents"}
    rostered = {r[0] for r in con.execute(
        "SELECT player_id FROM yahoo_rosters WHERE player_id IS NOT NULL").fetchall()}
    at = pd.Timestamp(e["saved_at"])
    rows = [
        {
            "snapshot_at": at,
            "yahoo_player_key": f"manual:{c['player_id']}",
            "player_name": c["name"],
            "team_abbr": c["team_abbr"],
            "eligible_positions": ",".join(x for x in c["eligible"] if x != "Util"),
            "pct_rostered": None,
            "status": None,
            "owner_team_id": None,
            "player_id": c["player_id"],
            "source": "manual",
            "fetched_at": at,
        }
        for c in _cards(con, e["player_ids"])
        if c["player_id"] not in rostered
    ]
    if rows:
        store.upsert(con, "yahoo_players", pd.DataFrame(rows))
    return {"applied": bool(rows), "players": len(rows), "saved_at": e["saved_at"]}

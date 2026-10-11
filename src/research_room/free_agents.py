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

Waivers: Yahoo marks a player on waivers "W (Oct 22)" (or "W (Wed)", "W (10/22)") in his row,
after his name; a free agent reads "FA". Each W mark goes to the last player found before it, and
its date is when his waivers clear: he can be claimed now and plays from that day. A date that can't
be read is today + settings.transactions.waiver_days. Kept beside the ids as `waivers` (id -> date).
"""

from __future__ import annotations

import json
import re
import unicodedata
from datetime import date, datetime, timedelta
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
_WAIVER = re.compile(r"\bW\s*\(\s*([^()]{1,24}?)\s*\)")
_DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


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


def _names_in(words: list[str], idx: dict[str, set[int]]) -> list[tuple[str, object]]:
    """("player", id) / ("ambiguous", name) events for the names in a run of words, in order."""
    out: list[tuple[str, object]] = []
    i = 0
    while i < len(words):
        for n in _SPANS:
            key = " ".join(words[i : i + n])
            if len(words) - i >= n and key in idx:
                ids = idx[key]
                out.append(("player", next(iter(ids))) if len(ids) == 1 else ("ambiguous", key))
                i += n
                break
        else:
            i += 1
    return out


def _scan(con: duckdb.DuckDBPyConnection, text: str) -> list[tuple[str, object]]:
    """The paste as events in reading order: players, ambiguous names, and waiver marks
    ("waiver", the text in the parentheses)."""
    idx = _name_index(con)
    events: list[tuple[str, object]] = []
    for line in str(text).splitlines():
        at = 0
        for m in _WAIVER.finditer(line):
            events += _names_in(_tokens(line[at : m.start()]), idx)
            events.append(("waiver", m.group(1)))
            at = m.end()
        events += _names_in(_tokens(line[at:]), idx)
    return events


def clear_date(mark: str, today: date, waiver_days: int) -> date:
    """When a "W (...)" mark's waivers clear: "Oct 22" / "10/22" (this season's next such date),
    "Wed" (the next Wednesday, today included), else today + waiver_days."""
    m = mark.strip().lower()
    for fmt in ("%b %d", "%B %d", "%m/%d"):
        try:
            d = datetime.strptime(f"{today.year} {m.split(',')[0].strip()}", f"%Y {fmt}").date()
        except ValueError:
            continue
        return d if d >= today - timedelta(days=180) else d.replace(year=today.year + 1)
    if m[:3] in _DAYS:
        return today + timedelta(days=(_DAYS.index(m[:3]) - today.weekday()) % 7)
    return today + timedelta(days=waiver_days)


def find_players(con: duckdb.DuckDBPyConnection, text: str) -> tuple[list[int], list[str]]:
    """(player ids in the order they appear, names shared by more than one player)."""
    events = _scan(con, text)
    found = [int(v) for k, v in events if k == "player"]
    ambiguous = list(dict.fromkeys(str(v) for k, v in events if k == "ambiguous"))
    return list(dict.fromkeys(found)), ambiguous


def find_waivers(con: duckdb.DuckDBPyConnection, text: str, today: date, waiver_days: int) -> dict[int, date]:
    """Player id -> the day his waivers clear, for the players marked "W (...)" in the paste."""
    out: dict[int, date] = {}
    last: int | None = None
    for kind, v in _scan(con, text):
        if kind == "player":
            last = int(v)
        elif kind == "ambiguous":
            last = None
        elif kind == "waiver" and last is not None and last not in out:
            out[last] = clear_date(str(v), today, waiver_days)
    return out


def waivers(e: dict | None, today: date) -> dict[int, date]:
    """The saved entry's waiver dates still ahead (a cleared player is a free agent)."""
    out = {}
    for pid, d in ((e or {}).get("waivers") or {}).items():
        when = date.fromisoformat(d)
        if when > today:
            out[int(pid)] = when
    return out


def _today(ts: pd.Timestamp) -> date:
    """The league's day (Eastern) of a UTC time."""
    from research_room.ingest.market_common import ET

    return ts.tz_convert(ET).date()


def _iso(d: date | None) -> str | None:
    return None if d is None else d.isoformat()


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
    when = pd.Timestamp(now or store.utcnow())
    when = when if when.tzinfo else when.tz_localize("UTC")
    held = waivers(e, _today(when))
    cards = [{**c, "owner": "waivers" if c["player_id"] in held else "free_agent",
              "waiver_until": _iso(held.get(c["player_id"]))} for c in _cards(con, e.get("player_ids", []))]
    saved = e.get("saved_at")
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
    at = pd.Timestamp(now or store.utcnow())
    at = at if at.tzinfo else at.tz_localize("UTC")
    held = find_waivers(con, text, _today(at), cfg.transactions.waiver_days)
    kept = ids[:MAX_PLAYERS]
    _write(_path(cfg), {"player_ids": kept, "saved_at": at.isoformat(),
                        "waivers": {str(p): held[p].isoformat() for p in kept if p in held}})
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
    held = waivers(e, _today(pd.Timestamp(store.utcnow())))
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
            "waiver_until": held.get(c["player_id"]),
            "source": "manual",
            "fetched_at": at,
        }
        for c in _cards(con, e["player_ids"])
        if c["player_id"] not in rostered
    ]
    if rows:
        store.upsert(con, "yahoo_players", pd.DataFrame(rows))
    return {"applied": bool(rows), "players": len(rows), "saved_at": e["saved_at"]}

"""Yahoo position eligibility from what the owner pastes, when the app can't read Yahoo.

Inputs: Yahoo's own rows as pasted (the Players page: "Stephen Curry  GS - PG,SG"), from the
free-agent paste (free_agents.save), the names pasted for a roster (opponent_roster._resolve), and
the draft room's Yahoo positions paste (Players page, all players); NBA players (BallDontLie).
Outputs: player id -> Yahoo positions (base positions PG, SG, SF, PF, C), read by the draft board's
eligibility (draft/eligibility.load_yahoo) and the roster cards (opponent_roster._cards).
Tables: none; one small file, data/inbox/yahoo_positions.json (ids, positions, a time).

Kept to the Yahoo data policy (ingest/yahoo_live.py) like the other entries: a file on this Mac,
never in the store, deleted by `make yahoo-purge`; the pasted text is scanned and dropped. Each
paste adds to the list (a player's latest positions win), since one paste rarely holds everyone.
Reading: Yahoo writes the team and positions right after the name ("BOS - PG,SG"); each tag goes to
the last player found before it, never across a name shared by two players. "G" and "F" alone mean
both guard or both forward spots.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path

import pandas as pd

from research_room import store
from research_room.config import Settings, settings

FILE = "yahoo_positions.json"
BASE = ("PG", "SG", "SF", "PF", "C")
_WIDE = {"G": ("PG", "SG"), "F": ("SF", "PF")}
_POS = r"(?:PG|SG|SF|PF|C|G|F)"
TAG = re.compile(rf"\b[A-Z]{{2,4}}\s+-\s+({_POS}(?:\s*,\s*{_POS})*)\b")
POLICY = (
    "Yahoo positions read from your pastes, kept on this computer only and never in the database: "
    "player ids and positions, not the text. Each paste adds to the list."
)


def _path(cfg: Settings) -> Path:
    return Path(cfg.paths.inbox_dir) / FILE


def parse(tag: str) -> list[str]:
    """'PG,SG' -> ['PG', 'SG']; 'G' -> ['PG', 'SG']; base positions in roster order."""
    got: set[str] = set()
    for p in (x.strip() for x in tag.split(",")):
        got |= set(_WIDE.get(p, (p,)))
    return [p for p in BASE if p in got]


def read(cfg: Settings | None = None) -> dict:
    cfg = cfg or settings()
    try:
        return json.loads(_path(cfg).read_text())
    except (OSError, ValueError):
        return {}


def positions(cfg: Settings | None = None) -> dict[int, list[str]]:
    """Player id -> his Yahoo positions, from every paste so far."""
    return {int(k): list(v) for k, v in (read(cfg).get("positions") or {}).items() if v}


def merge(found: dict[int, list[str]], cfg: Settings | None = None, now: datetime | None = None) -> int:
    """Add these players' positions to the list (theirs replace older ones). Returns how many."""
    from research_room.opponent_roster import _write

    found = {int(p): v for p, v in found.items() if v}
    if not found:
        return 0
    cfg = cfg or settings()
    e = read(cfg)
    held = {**(e.get("positions") or {}), **{str(p): v for p, v in found.items()}}
    _write(_path(cfg), {"positions": held, "saved_at": pd.Timestamp(now or store.utcnow()).isoformat()})
    return len(found)


def response(
    cfg: Settings | None = None, found: int | None = None, ambiguous: list[str] | None = None
) -> dict:
    """YahooPositions: how many players have Yahoo positions, when last added to, the policy."""
    e = read(cfg)
    return {"players": len(e.get("positions") or {}), "saved_at": e.get("saved_at"), "found": found,
            "ambiguous": ambiguous or [], "policy": POLICY}

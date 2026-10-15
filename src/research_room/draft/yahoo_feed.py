"""Yahoo's own draft results as a second pick feed for the live draft: the listener's backup.

Inputs: Yahoo's draft results for the league (yahoo_fantasy_api League.draft_results: pick number,
round, team key, Yahoo player id), Yahoo's player details for ids not seen yet (name, NBA team),
settings.draft.yahoo_feed, the running draft session's pick log and name resolver.
Outputs: picks recorded in the session's log with entry_source "yahoo" (tracker.record_pick, the
same path the listener's picks take), and a status for the Draft screen.
Tables: writes draft_picks through the API's writer; nothing else.

The listener reads the Yahoo draft-room page and has not been checked against the real room; the
manual entry always works. This feed reads the same picks from Yahoo's API every few seconds while
the draft can be on (`minutes_before` the start to `hours_after` it). A pick the log already has is
left alone. One the log has with a different player is reported as a conflict and never
overwritten (a misread, a manual fix or a commissioner edit: the owner decides). A name that
doesn't resolve is reported for manual entry. Read only, like every Yahoo call: nothing is
clicked or written in Yahoo, and the Yahoo names and ids stay in this process's memory.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta

import pandas as pd

from research_room import store
from research_room.config import Settings


@dataclass
class YahooPick:
    pick_no: int
    yahoo_id: int
    name: str | None
    team_abbr: str | None


@dataclass
class FeedStatus:
    """What the Draft screen shows about this feed (no Yahoo data beyond the names it couldn't
    match, which the owner needs to enter those picks)."""
    state: str = "off"                 # off | waiting | live | error
    detail: str = ""
    checked_at: str | None = None
    yahoo_picks: int = 0               # picks Yahoo lists so far
    added: int = 0                     # recorded by this feed this session
    unmatched: list[str] = field(default_factory=list)
    conflicts: list[int] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"state": self.state, "detail": self.detail, "checked_at": self.checked_at,
                "yahoo_picks": self.yahoo_picks, "added": self.added,
                "unmatched": list(self.unmatched), "conflicts": list(self.conflicts)}


def in_window(now: datetime, cfg: Settings) -> bool:
    """Whether the draft can be on: from `minutes_before` its start to `hours_after` it."""
    f, start = cfg.draft.yahoo_feed, pd.Timestamp(cfg.draft.starts_at)
    t = pd.Timestamp(now)
    return start - timedelta(minutes=f.minutes_before) <= t <= start + timedelta(hours=f.hours_after)


class YahooFeed:
    """Reads Yahoo's draft results. `connect` and the league are swappable for tests."""

    def __init__(self, connect: Callable | None = None) -> None:
        self._connect = connect
        self._league = None
        self._names: dict[int, tuple[str | None, str | None]] = {}   # Yahoo id -> (name, team)
        self.status = FeedStatus()
        self.lock = threading.Lock()                                 # one read at a time

    def reset(self) -> None:
        """A new session: forget the counts, keep the name cache (same league, same players)."""
        self.status = FeedStatus()

    def league(self, cfg: Settings):
        if self._league is None:
            if self._connect is None:
                from research_room.ingest import yahoo_api

                self._league, _game = yahoo_api.connect(cfg)
            else:
                self._league = self._connect(cfg)
        return self._league

    def read(self, cfg: Settings) -> list[YahooPick]:
        """Every pick Yahoo lists with a player, in pick order (names looked up once per player)."""
        from research_room.ingest.yahoo_api import DETAIL_BATCH, _abbr, _name

        lg = self.league(cfg)
        raw = [p for p in (lg.draft_results() or []) if p.get("player_id") and p.get("pick")]
        new = sorted({int(p["player_id"]) for p in raw} - set(self._names))
        for i in range(0, len(new), DETAIL_BATCH):
            for d in lg.player_details(new[i : i + DETAIL_BATCH]) or []:
                self._names[int(d.get("player_id"))] = (_name(d), _abbr(d))
        out = []
        for p in raw:
            name, abbr = self._names.get(int(p["player_id"]), (None, None))
            out.append(YahooPick(int(p["pick"]), int(p["player_id"]), name, abbr))
        return sorted(out, key=lambda x: x.pick_no)


def apply(picks: list[YahooPick], recorded: dict[int, int], resolve: Callable[[str, str | None], int | None],
          record: Callable[[int, int, str], None], status: FeedStatus) -> int:
    """Record Yahoo's picks the log lacks. `recorded`: pick_no -> player_id already in the log;
    `resolve(name, team_abbr)` -> player_id or None; `record(pick_no, player_id, name)` writes one
    pick (and may raise, which is reported). Returns how many were added. The unmatched names and
    conflicts are this read's: a pick entered by hand since drops off."""
    added, unmatched, conflicts, problem = 0, [], [], ""
    for p in picks:
        pid = resolve(p.name, p.team_abbr) if p.name else None
        if p.pick_no in recorded:
            if pid is not None and recorded[p.pick_no] != pid:
                conflicts.append(p.pick_no)
            continue
        if pid is None:
            unmatched.append(p.name or f"Yahoo player {p.yahoo_id}")
            continue
        try:
            record(p.pick_no, pid, p.name or "")
        except Exception as exc:  # noqa: BLE001 - one bad pick never stops the rest
            problem = f"pick {p.pick_no}: {exc}"[:200]
            continue
        recorded[p.pick_no] = pid
        added += 1
    status.added += added
    status.yahoo_picks = len(picks)
    status.unmatched, status.conflicts, status.detail = unmatched, conflicts, problem
    status.checked_at = pd.Timestamp(store.utcnow()).isoformat()
    return added

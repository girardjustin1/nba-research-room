"""Draft pick log: record, undo, keepers, rosters per team, export.

Inputs: picks entered on the Draft page or posted by the Tampermonkey listener (via
jobs/draft_api.py), settings.league.teams / draft.rounds / draft.keepers.
Outputs: the current `DraftState`; data/inbox/draft_results.csv on export.
Tables: reads/writes draft_picks.

Teams are identified by draft slot (1..teams) during the draft. Undo marks the latest pick
`undone` rather than deleting it, so the log keeps everything that happened.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import duckdb
import pandas as pd

from research_room import store
from research_room.config import Settings, settings
from research_room.draft.availability import pick_number, round_of, slot_of


class PickError(ValueError):
    """A pick that cannot be recorded (wrong turn, already drafted, out of range)."""


@dataclass
class DraftState:
    draft_id: str
    teams: int
    rounds: int
    my_slot: int | None
    picks: pd.DataFrame = field(default_factory=lambda: pd.DataFrame(
        columns=["pick_no", "round", "team_id", "player_id", "player_name", "is_keeper"]))

    @property
    def total_picks(self) -> int:
        return self.teams * self.rounds

    @property
    def drafted(self) -> set[int]:
        return set(self.picks["player_id"].dropna().astype(int))

    @property
    def current_pick(self) -> int | None:
        """The next pick to be made (keepers occupy their own pick numbers)."""
        taken = set(self.picks["pick_no"].astype(int))
        return next((p for p in range(1, self.total_picks + 1) if p not in taken), None)

    @property
    def on_the_clock(self) -> int | None:
        p = self.current_pick
        return slot_of(p, self.teams) if p else None

    def roster(self, team_id: int) -> pd.DataFrame:
        return self.picks[self.picks["team_id"] == team_id].sort_values("pick_no")


def new_state(draft_id: str, cfg: Settings | None = None, my_slot: int | None = None) -> DraftState:
    cfg = cfg or settings()
    return DraftState(draft_id, cfg.league.teams, cfg.draft.rounds,
                      my_slot if my_slot is not None else cfg.draft.my_slot)


def load_state(con: duckdb.DuckDBPyConnection, draft_id: str, cfg: Settings | None = None,
               my_slot: int | None = None) -> DraftState:
    state = new_state(draft_id, cfg, my_slot)
    state.picks = _read_picks(con, draft_id)
    return state


def record_pick(con: duckdb.DuckDBPyConnection, state: DraftState, player_id: int, player_name: str,
                team_id: int | None = None, pick_no: int | None = None, entry_source: str = "manual",
                is_keeper: bool = False) -> DraftState:
    """Record a pick. `team_id` defaults to the team on the clock; `pick_no` to the current pick."""
    pick_no = pick_no or state.current_pick
    if pick_no is None:
        raise PickError("the draft is complete")
    if not 1 <= pick_no <= state.total_picks:
        raise PickError(f"pick {pick_no} is outside 1..{state.total_picks}")
    expected_team = slot_of(pick_no, state.teams)
    team_id = team_id or expected_team
    if team_id != expected_team and not is_keeper:
        raise PickError(f"pick {pick_no} belongs to slot {expected_team}, not {team_id}")
    if pick_no in set(state.picks["pick_no"].astype(int)):
        raise PickError(f"pick {pick_no} is already recorded")
    if int(player_id) in state.drafted:
        raise PickError(f"{player_name} is already drafted")
    row = {"draft_id": state.draft_id, "pick_no": pick_no, "round": round_of(pick_no, state.teams),
           "team_id": team_id, "player_id": int(player_id), "player_name": player_name,
           "is_keeper": is_keeper, "entry_source": entry_source, "picked_at": store.utcnow(),
           "undone": False}
    store.upsert(con, "draft_picks", pd.DataFrame([row]))
    return _reload(con, state)


def undo_last(con: duckdb.DuckDBPyConnection, state: DraftState) -> DraftState:
    """Undo the most recent non-keeper pick."""
    live = state.picks[~state.picks["is_keeper"].astype(bool)]
    if live.empty:
        raise PickError("nothing to undo")
    last = int(live["pick_no"].max())
    con.execute("UPDATE draft_picks SET undone = true WHERE draft_id = ? AND pick_no = ?",
                [state.draft_id, last])
    return _reload(con, state)


def remove_pick(con: duckdb.DuckDBPyConnection, state: DraftState, pick_no: int) -> DraftState:
    """Remove one recorded pick (to correct it). Flags it `undone`, like undo."""
    if pick_no not in set(state.picks["pick_no"].astype(int)):
        raise PickError(f"pick {pick_no} is not recorded")
    con.execute("UPDATE draft_picks SET undone = true WHERE draft_id = ? AND pick_no = ? AND NOT undone",
                [state.draft_id, pick_no])
    return _reload(con, state)


def team_names(con: duckdb.DuckDBPyConnection, state: DraftState) -> dict[int, str]:
    """Saved names for this draft's teams; unnamed slots read "Team N" ("You" for my slot)."""
    saved = dict(con.execute("SELECT team_id, name FROM draft_teams WHERE draft_id = ?",
                             [state.draft_id]).fetchall())
    return {t: saved.get(t) or ("You" if t == state.my_slot else f"Team {t}")
            for t in range(1, state.teams + 1)}


def league_team_names(con: duckdb.DuckDBPyConnection) -> dict[int, str]:
    """Yahoo team id -> team name from the latest teams.csv snapshot (empty if none)."""
    return dict(con.execute("""
        SELECT team_id, team_name FROM yahoo_teams
        WHERE snapshot_at = (SELECT max(snapshot_at) FROM yahoo_teams)
    """).fetchall())


def slot_names_from_order(order: list[int], league_names: dict[int, str]) -> dict[int, str]:
    """Draft slot (1-based) -> team name, for slots whose Yahoo team has a name."""
    return {slot: league_names[tid] for slot, tid in enumerate(order, start=1) if tid in league_names}


def slot_from_order(order: list[int], my_team_id: int) -> int | None:
    return order.index(my_team_id) + 1 if my_team_id in order else None


def save_team_names(con: duckdb.DuckDBPyConnection, state: DraftState, names: dict[int, str]) -> None:
    bad = [t for t in names if not 1 <= int(t) <= state.teams]
    if bad:
        raise PickError(f"team ids out of range 1..{state.teams}: {bad}")
    rows = [{"draft_id": state.draft_id, "team_id": int(t), "name": str(n).strip()[:40],
             "updated_at": store.utcnow()} for t, n in names.items() if str(n).strip()]
    store.upsert(con, "draft_teams", pd.DataFrame(rows))


def apply_keepers(con: duckdb.DuckDBPyConnection, state: DraftState, keepers: list[dict],
                  names: dict[int, str]) -> DraftState:
    """Place keepers ({team_id, player_id, round}) at their team's pick in that round."""
    for k in keepers:
        pick = pick_number(int(k["round"]), int(k["team_id"]), state.teams)
        if pick in set(state.picks["pick_no"].astype(int)):
            continue
        state = record_pick(con, state, int(k["player_id"]), names.get(int(k["player_id"]), "?"),
                            team_id=int(k["team_id"]), pick_no=pick, entry_source="keeper",
                            is_keeper=True)
    return state


def export_results(state: DraftState, path: Path | None = None) -> Path:
    """Write draft_results.csv in the inbox schema (team_id = draft slot)."""
    path = path or settings().paths.inbox_dir / "draft_results.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    state.picks[["pick_no", "round", "team_id", "player_name"]].to_csv(path, index=False)
    return path


def _reload(con: duckdb.DuckDBPyConnection, state: DraftState) -> DraftState:
    """Re-read the log for this draft, keeping its team count, rounds and slot."""
    fresh = DraftState(state.draft_id, state.teams, state.rounds, state.my_slot)
    fresh.picks = _read_picks(con, state.draft_id)
    return fresh


def _read_picks(con: duckdb.DuckDBPyConnection, draft_id: str) -> pd.DataFrame:
    return con.execute("""
        SELECT pick_no, round, team_id, player_id, player_name, is_keeper
        FROM draft_picks WHERE draft_id = ? AND NOT undone ORDER BY pick_no
    """, [draft_id]).df()

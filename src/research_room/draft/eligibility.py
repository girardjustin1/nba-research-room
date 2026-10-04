"""Roster-slot eligibility for the draft pool: Yahoo's multi-position eligibility when we have it,
Basketball Monster's single primary position otherwise.

Inputs: the latest `yahoo_players` snapshot (players.csv from the inbox: eligible_positions such as
"PG,SG"), the draft pool (player_id, position), settings.draft.position_eligibility (position ->
slots it can fill).
Outputs: per player, the list of starting slots he can fill and where that came from ("yahoo" or
"bbm"); Yahoo's own position string for display.
Tables: reads yahoo_players.

Yahoo is the authority for eligibility in this league. A player without a Yahoo row falls back to
his BBM primary position and is marked "bbm", so the UI can show the lower confidence.
"""

from __future__ import annotations

import duckdb
import pandas as pd

from research_room.config import Settings, settings

PRIMARY = ("PG", "SG", "SF", "PF", "C")


def slots_for(positions: list[str], cfg: Settings) -> list[str]:
    """Union of the slots each Yahoo position can fill, in roster order, Util always last."""
    mapping = cfg.draft.position_eligibility
    order = [s for s in cfg.roster.slots if s not in ("BN", "IL")]
    allowed = {slot for p in positions if p in PRIMARY for slot in mapping.get(p, [p])}
    return [s for s in dict.fromkeys(order) if s in allowed] or ["Util"]


def load_yahoo(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """player_id -> Yahoo positions (list) from the latest players.csv snapshot (resolved rows only)."""
    df = con.execute("""
        SELECT player_id, eligible_positions FROM yahoo_players
        WHERE player_id IS NOT NULL AND snapshot_at = (SELECT max(snapshot_at) FROM yahoo_players)
    """).df()
    if df.empty:
        return pd.DataFrame({"player_id": pd.Series(dtype=int), "yahoo_positions": pd.Series(dtype=object)})
    df["yahoo_positions"] = df["eligible_positions"].fillna("").map(
        lambda s: [p for p in s.split(",") if p in PRIMARY])
    df = df[df["yahoo_positions"].map(bool)].drop_duplicates("player_id")
    return df[["player_id", "yahoo_positions"]].assign(player_id=lambda d: d["player_id"].astype(int))


def resolve(pool: pd.DataFrame, yahoo: pd.DataFrame | None, cfg: Settings | None = None) -> pd.DataFrame:
    """Per pool row: eligible slots, the position list shown, and eligibility_source."""
    cfg = cfg or settings()
    by_id = {} if yahoo is None or yahoo.empty else dict(zip(yahoo["player_id"], yahoo["yahoo_positions"],
                                                              strict=True))
    rows = []
    for pid, pos in zip(pool["player_id"], pool["position"], strict=True):
        ypos = by_id.get(int(pid))
        positions = ypos if ypos else ([str(pos)] if pd.notna(pos) else [])
        rows.append({"eligible": slots_for(positions, cfg), "positions": ",".join(positions),
                     "eligibility_source": "yahoo" if ypos else "bbm"})
    return pd.DataFrame(rows, index=pool.index)

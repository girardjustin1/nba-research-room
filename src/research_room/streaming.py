"""The opponent's in-week pickups ("streaming"): the adds a typical opponent makes during the week.

Inputs: the week's inputs (matchup.week_inputs, or the backtest's equivalent: both rosters, the
remaining days, every player's projections, live totals, calibrated spreads), the free agents
(optimizer.free_agents, or the backtest's pool), the opponent's adds so far this week when known,
settings.opponent / optimizer / transactions.
Outputs: `Streams` (his adds and drops, his roster on each remaining day, his projected days) and
`apply`, which puts them into the week's inputs, so the weekly odds (matchup_now, do_nothing_path)
and my add/drop plan (optimizer.optimize, evaluate) face a streaming opponent.
Tables: none (pure). Off unless settings.opponent.streaming (or backtest.run asks for it).

The rule, greedy and day by day:
- Value: the optimizer's per-game value (optimizer.day_values) with the optimizer's category
  weights taken from his side of the matchup, at the do-nothing week: what a player's line adds to
  his P(win week). A player with no game (or ruled out) is worth 0 that day.
- From the first day an add made now would count (optimizer.add_takes_effect_days), on each day his
  weakest player without a game that day (least value over the rest of the week, days t..end) is
  swapped for the free agent with a game that day worth the most over the rest of the week, when the
  free agent is worth more. Players in an IL slot or listed injured are never dropped (a manager
  keeps an injured starter); a free agent he drops isn't added back (waivers).
- At most `adds_per_day` swaps a day and `adds_per_week` a week (capped at the league's limit),
  less the adds he has made this week when Yahoo's matchup gives them.
- My roster is never touched. The free-agent pool is shared one way: he picks first, and the
  players he adds are not free agents for my plan (optimizer.optimize drops them from its pool).
  He doesn't react to my plan, so my adds stay open to him (a simplification, DECISIONS.md).
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from research_room import lineup, matchup, optimizer
from research_room.config import Settings, settings


@dataclass
class Streams:
    moves: list[optimizer.Move]          # add = the free agent, drop = his player, effective = the day
    rosters: list[pd.DataFrame]          # his roster on each remaining day
    days: matchup.TeamDays               # his projected days with those rosters
    adds_allowed: int                    # adds he had left for the rest of the week


def _protected(roster: pd.DataFrame) -> set[int]:
    """His players never dropped: in an IL slot or listed injured."""
    slot = roster["current_slot"].fillna("BN").astype(str).str.split("#").str[0]
    status = roster["status"].fillna("").astype(str).str.upper()
    hit = (slot == optimizer.IL_SLOT) | status.isin(lineup.IL_STATUSES)
    return {int(p) for p in roster.loc[hit, "player_id"]}


def opponent_streams(inp: dict, pool: pd.DataFrame, cfg: Settings | None = None,
                     adds_used: int = 0) -> Streams:
    """His adds and drops for the rest of the week by the rule in the module doc."""
    cfg = cfg or settings()
    o, days, base = cfg.opponent, inp["days"], inp["opp_roster"]
    allowed = max(0, min(o.adds_per_week, cfg.transactions.max_acquisitions_per_week) - int(adds_used))
    rostered = set(base["player_id"].astype(int)) | set(inp["me_roster"]["player_id"].astype(int))
    fa = pool[~pool["player_id"].astype(int).isin(rostered)]
    first = optimizer.first_add_index(days, inp["now"].date(), cfg)
    moves: list[optimizer.Move] = []
    if allowed and first < len(days) and not fa.empty:
        his = matchup._team(inp["opp"], inp["opp_done"], 0)
        mine = matchup._team(inp["me"], inp["me_done"], 0)
        w = optimizer.category_weights(his, mine, cfg, inp["var_mult"])
        free = [int(p) for p in fa["player_id"]]
        on = [int(p) for p in base["player_id"]]
        values = optimizer.day_values(inp["proj"], list(dict.fromkeys(on + free)), days, w, cfg)
        keep, added = _protected(base), set()
        for t in range(first, len(days)):
            rest = values.loc[:, t:].sum(axis=1)
            for _ in range(o.adds_per_day):
                if len(moves) >= allowed:
                    break
                idle = [p for p in on if p not in keep and values.at[p, t] == 0.0]
                cands = [p for p in free if p not in added and values.at[p, t] != 0.0]
                if not idle or not cands:
                    break
                drop = min(idle, key=lambda p: (rest[p], p))
                add = max(cands, key=lambda p: (rest[p], -p))
                if rest[add] <= rest[drop]:
                    break
                moves.append(optimizer.Move(optimizer.move_id(add, drop, days[t]), add, drop, days[t]))
                on.remove(drop)
                on.append(add)
                added.add(add)
    rosters = optimizer.apply_moves(base, fa, moves, days)
    return Streams(moves, rosters, matchup.team_days(rosters, inp["proj"], days, cfg), allowed)


def apply(inp: dict, pool: pd.DataFrame, cfg: Settings | None = None, adds_used: int = 0) -> dict:
    """The week's inputs with the opponent streaming: his projected days from the streamed rosters
    (`opp`; the fixed roster's stay as `opp_static`), his moves (`opp_moves`, whose adds my plan
    can't make) and rosters (`opp_rosters`)."""
    s = opponent_streams(inp, pool, cfg, adds_used)
    return {**inp, "opp": s.days, "opp_static": inp["opp"], "opp_moves": s.moves,
            "opp_rosters": s.rosters, "opp_adds_allowed": s.adds_allowed}

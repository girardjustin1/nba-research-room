"""Bot drafters for mock drafts (the CLI exit check and mock mode in the draft API).

Inputs: the available pool with `expected_pick`, `adp_sd`, `position` (from
`draft.availability.expected_pick`), the bot's held primary positions, a seeded RNG.
Outputs: the bot's chosen player_id. Tables: none.

Rule: noisy ADP. Each available player's draft position is sampled once from
Normal(expected_pick, adp_sd) and the bot takes the earliest, skipping positions it already
holds `cap` times (so bots don't draft six centers). If that rules out everyone, the cap is
ignored.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

BOT_POSITION_CAP = 4


def bot_choice(avail: pd.DataFrame, held_positions: list[str], rng: np.random.Generator,
               cap: int = BOT_POSITION_CAP) -> int:
    """Noisy-ADP pick: lowest sampled draft position, skipping positions already at `cap`."""
    sampled = rng.normal(avail["expected_pick"].to_numpy(float), avail["adp_sd"].to_numpy(float))
    counts = pd.Series(held_positions, dtype=object).value_counts()
    full = set(counts[counts >= cap].index)
    allowed = ~avail["position"].isin(full).to_numpy()
    if not allowed.any():
        allowed[:] = True
    sampled = np.where(allowed, sampled, np.inf)
    return int(avail.index[int(np.argmin(sampled))])

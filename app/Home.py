"""NBA Research Room: home page.

Inputs: the store (read-only). Outputs: league summary and store status.
Tables: reads ingest_runs. Projected totals, win probability and games vs opponent arrive
in Phase 1 once projections exist.
"""

from __future__ import annotations

import streamlit as st

from research_room.config import settings
from research_room.ui import q, store_ready

st.set_page_config(page_title="NBA Research Room", page_icon="🏀", layout="wide")
cfg = settings()

st.title("NBA Research Room")
st.caption(f"{cfg.league.name} · {cfg.league.teams} teams · Head-to-Head One Win, 9 categories · "
           f"my team #{cfg.league.my_team_id}")

c1, c2, c3 = st.columns(3)
c1.metric("Draft", cfg.draft.starts_at.strftime("%a %b %d, %-I:%M %p"))
c2.metric("My draft slot", cfg.draft.my_slot or "not set")
c3.metric("Trade deadline", cfg.transactions.trade_deadline.strftime("%b %d, %Y"))

if store_ready():
    runs = q("SELECT source, job, status, finished_at FROM ingest_runs ORDER BY finished_at DESC LIMIT 1")
    if not runs.empty:
        r = runs.iloc[0]
        st.success(f"Store ready. Last job: {r.source} {r.job} ({r.status}) "
                   f"at {r.finished_at:%Y-%m-%d %H:%M} UTC")

st.info("Projections, lineup and win probability arrive in Phase 1. The Data page has the store "
        "status and the schedule matrix.")

"""Data page: sync status, table sizes, Yahoo inbox, name quarantine, schedule matrix.

Inputs: the store (read-only), data/inbox/ file listing.
Outputs: tables and the per-team per-week schedule matrix.
Tables: reads ingest_runs, games, game_logs, advanced_stats, teams, unresolved_names,
yahoo_rosters, yahoo_players, yahoo_matchups, draft_picks.
"""

from __future__ import annotations

import pandas as pd
import streamlit as st

from research_room import quality, schedule, store
from research_room.config import settings
from research_room.ingest.yahoo import SCHEMAS, CsvBackend
from research_room.ui import q, store_ready

st.set_page_config(page_title="Data · NBA Research Room", page_icon="🏀", layout="wide")
cfg = settings()
st.title("Data")

if not store_ready():
    st.stop()

# ------------------------------------------------------------------ sync status
st.subheader("Last syncs")
runs = q("""
    SELECT source, job, status, finished_at, rows, detail
    FROM (SELECT *, row_number() OVER (PARTITION BY source, job ORDER BY started_at DESC) rn
          FROM ingest_runs)
    WHERE rn = 1 ORDER BY finished_at DESC NULLS FIRST
""")
if runs.empty:
    st.write("No jobs have run yet.")
else:
    st.dataframe(runs, hide_index=True, width="stretch")
    failed = runs[runs["status"] == "error"]
    for r in failed.itertuples():
        st.error(f"{r.source} {r.job} failed: {r.detail}")

# ------------------------------------------------------------------ coverage
st.subheader("History in the store")
coverage = q("""
    SELECT g.season,
           count(DISTINCT g.game_id) AS games,
           count(DISTINCT l.game_id) AS games_with_box_scores,
           count(l.player_id) FILTER (WHERE l.did_play) AS player_games,
           count(DISTINCT l.player_id) AS players,
           (SELECT count(*) FROM advanced_stats a WHERE a.season = g.season) AS advanced_rows
    FROM games g LEFT JOIN game_logs l USING (game_id)
    WHERE NOT g.postseason
    GROUP BY g.season ORDER BY g.season
""")
st.dataframe(coverage, hide_index=True)
_con = store.connect(read_only=True)
qs = quality.summary(_con)
_con.close()
bad = int(qs["incomplete"].sum()) if not qs.empty else 0
if bad:
    st.caption(f"Box-score check: {bad} team-game(s) don't add up to the final score (missing player "
               "rows at the source). They are excluded from features.")
    st.dataframe(qs, hide_index=True)
with st.expander("Row counts per table"):
    counts = pd.concat([q(f"SELECT '{t}' AS table, count(*) AS rows FROM {t}") for t in store.SCHEMA])
    st.dataframe(counts, hide_index=True)

# ------------------------------------------------------------------ inbox
st.subheader("Yahoo inbox")
backend = CsvBackend(cfg.paths.inbox_dir)
present = backend.available()
last = {
    "roster": q("SELECT max(snapshot_at) AS t FROM yahoo_rosters"),
    "players": q("SELECT max(snapshot_at) AS t FROM yahoo_players"),
    "matchup": q("SELECT max(snapshot_at) AS t FROM yahoo_matchups"),
    "draft_results": q("SELECT max(picked_at) AS t FROM draft_picks WHERE entry_source = 'yahoo_csv'"),
}
inbox_rows = []
for name, schema in SCHEMAS.items():
    ingested = last[name]["t"].iloc[0]
    inbox_rows.append({
        "file": f"{name}.csv",
        "in inbox": present.get(name),
        "last ingested snapshot": ingested if pd.notna(ingested) else None,
        "columns (required*)": ", ".join(c.name + ("*" if c.required else "") for c in schema),
    })
st.dataframe(pd.DataFrame(inbox_rows), hide_index=True, width="stretch")
st.caption(f"Inbox folder: `{cfg.paths.inbox_dir}`")

# ------------------------------------------------------------------ quarantine
st.subheader("Name quarantine")
quarantine = q("""
    SELECT source, raw_name, team_abbr, reason, candidates, first_seen, last_seen
    FROM unresolved_names ORDER BY last_seen DESC
""")
if quarantine.empty:
    st.success("No unresolved names.")
else:
    st.warning(f"{len(quarantine)} name(s) did not match a BallDontLie player. Add each to "
               "`config/aliases.yaml`; they are never merged automatically.")
    st.dataframe(quarantine, hide_index=True, width="stretch")

# ------------------------------------------------------------------ schedule
season = cfg.season
st.subheader(f"Schedule matrix: {season.nba_season}-{(season.nba_season + 1) % 100:02d}")
value = st.radio("Show", ["games", "b2b_games", "light_day_games", "cup_window_games"], horizontal=True,
                 format_func=lambda v: {"games": "Games", "b2b_games": "Back-to-back games",
                                        "light_day_games": f"Light-day games (≤{season.light_day_max_games})",
                                        "cup_window_games": "NBA Cup window games"}[v])
games = q("SELECT * FROM games WHERE season = ?", season.nba_season)
if games.empty:
    st.write("No schedule loaded for this season yet.")
else:
    m = schedule.team_week_matrix(games, season)
    abbr = dict(q("SELECT team_id, abbreviation FROM teams").itertuples(index=False, name=None))
    m["team"] = m["team_id"].map(abbr)
    wide = m.pivot(index="team", columns="week", values=value)
    wide.columns = [f"W{w}" for w in wide.columns]
    playoff_cols = [f"W{w}" for w in season.playoff_weeks]
    wide["playoffs"] = wide[playoff_cols].sum(axis=1)
    wide["total"] = wide.drop(columns=["playoffs"]).sum(axis=1)
    wide = wide.sort_values(["playoffs", "total"], ascending=False)
    st.dataframe(wide.style.background_gradient(cmap="Greens", axis=None), width="stretch")

    weeks = schedule.fantasy_weeks(season)
    scheduled = int(games["status_state"].eq("scheduled").sum())
    notes = [f"Playoff weeks {season.playoff_weeks[0]}-{season.playoff_weeks[-1]} "
             f"({weeks[weeks.is_playoff].start.min():%b %d} - {season.playoffs_end:%b %d}).",
             f"{len(games)} games loaded ({scheduled} not yet played)."]
    if len(games) < 1230:
        notes.append(f"{1230 - len(games)} games are not scheduled yet: the NBA sets them after the "
                     "Cup group stage, so December counts will rise.")
    if not season.week_boundaries_verified:
        notes.append("Week boundaries for weeks 1-19 are assumed (week 1 and the All-Star week are "
                     "double weeks). Confirm against the Yahoo league schedule.")
    for n in notes:
        st.caption(n)

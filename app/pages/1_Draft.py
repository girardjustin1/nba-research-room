"""Draft page: the Streamlit fallback for the live draft.

A client of the local draft API (`make draft-api`, 127.0.0.1:8765), the single source of truth the
React app and the Tampermonkey listener share. This page never imports the board or simulator:
every number it shows comes from the API, so all three clients see the same draft.

Inputs: the draft API (session, board, players, rosters). Outputs: pick entry, undo, export,
top-10 recommendations, my roster and category balance, tiers, punt drift, next-pick countdown.
Tables: none directly (the API writes draft_picks).

The live part polls the API every 2 s (`st.fragment(run_every=...)`), so picks posted by the
listener appear without a manual refresh.
"""

from __future__ import annotations

import os
import time
from typing import Any

import pandas as pd
import requests
import streamlit as st

from research_room.config import settings

API_URL = os.environ.get("RESEARCH_ROOM_API", "http://127.0.0.1:8765").rstrip("/")
POLL_EVERY = "2s"
TIMEOUT_S = 5.0                 # board, pick, players calls (the board answers in well under 1 s)
SESSION_TIMEOUT_S = 60.0        # starting a session loads the pool from the store
API_DOWN = "Start the draft API: make draft-api"
TIERS_SHOWN = 6

st.set_page_config(page_title="Draft · NBA Research Room", page_icon="🏀", layout="wide")
cfg = settings()


# ------------------------------------------------------------------ HTTP
class ApiDown(RuntimeError):
    """The draft API is not reachable."""


def call(method: str, path: str, *, params: dict | None = None, body: dict | None = None,
         timeout: float = TIMEOUT_S) -> tuple[int, Any]:
    try:
        r = requests.request(method, f"{API_URL}{path}", params=params, json=body, timeout=timeout)
    except requests.RequestException as exc:
        raise ApiDown(str(exc)) from exc
    try:
        data = r.json()
    except ValueError:
        data = {"detail": r.text}
    return r.status_code, data


def detail(data: Any) -> str:
    """Readable text from a FastAPI error body (`detail` is a string or {error, candidates})."""
    d = data.get("detail", data) if isinstance(data, dict) else data
    if isinstance(d, dict):
        msg = str(d.get("error", d))
        if d.get("candidates"):
            msg += f". Candidates: {', '.join(map(str, d['candidates']))}"
        return msg
    return str(d)


def flash(kind: str, msg: str) -> None:
    st.session_state["_flash"] = (kind, msg)


def show_flash() -> None:
    if "_flash" in st.session_state:
        kind, msg = st.session_state.pop("_flash")
        getattr(st, kind)(msg)


def pct(p: float | None) -> str:
    return "n/a" if p is None else f"{p:.0%}"


# ------------------------------------------------------------------ session controls
def labels(session: dict | None) -> dict[str, str]:
    cats = session["categories"] if session else [{"key": c.key, "label": c.label} for c in cfg.categories]
    return {c["key"]: c["label"] for c in cats}


def start_session(draft_id: str, my_slot: int, punts: list[str]) -> None:
    body: dict[str, Any] = {"my_slot": my_slot, "punts": punts}
    if draft_id.strip():
        body["draft_id"] = draft_id.strip()
    try:
        code, data = call("POST", "/draft/session", body=body, timeout=SESSION_TIMEOUT_S)
    except ApiDown:
        flash("error", API_DOWN)
        return
    if code == 200:
        flash("success", f"Draft session `{data['draft_id']}` ready: slot {data['my_slot']}, "
                         f"{len(data['picks'])} pick(s) already logged.")
    else:
        flash("error", f"Could not start the session: {detail(data)}")


def setup_form(session: dict | None, where: Any) -> None:
    """Start a new draft, or resume one: the API reloads that draft_id's pick log from the store."""
    teams = session["teams"] if session else cfg.league.teams
    default_slot = (session or {}).get("my_slot") or cfg.draft.my_slot
    with where.form("setup_form"):
        draft_id = st.text_input("Draft id", value=session["draft_id"] if session else "",
                                 placeholder=f"blank = hoopdreams-{cfg.season.nba_season}",
                                 help="Use a throwaway id (e.g. yahoo-mock-1) for Yahoo mock drafts.")
        slot = st.selectbox("My draft slot", list(range(1, teams + 1)),
                            index=(default_slot - 1) if default_slot else None,
                            placeholder="Pick your slot", key="setup_slot")
        st.caption("Punt categories")
        chosen = [k for k, lab in labels(session).items()
                  if st.toggle(lab, value=k in (session or {}).get("punts", []), key=f"setup_punt_{k}")]
        if st.form_submit_button("Start / resume draft", type="primary", key="setup_submit"):
            if slot is None:
                flash("error", "Choose your draft slot first.")
            else:
                start_session(draft_id, int(slot), chosen)
            st.rerun()


def _put_slot() -> None:
    slot = st.session_state.get("slot")
    if slot is None:
        return
    try:
        code, data = call("PUT", "/draft/slot", body={"my_slot": int(slot)})
    except ApiDown:
        flash("error", API_DOWN)
        return
    if code != 200:
        flash("error", f"Slot not changed: {detail(data)}")


def _put_punts(keys: list[str]) -> None:
    punts = [k for k in keys if st.session_state.get(f"punt_{k}")]
    try:
        code, data = call("PUT", "/draft/punts", body={"punts": punts})
    except ApiDown:
        flash("error", API_DOWN)
        return
    if code != 200:
        flash("error", f"Punts not changed: {detail(data)}")


def session_controls(session: dict) -> None:
    """Slot selector and punt toggles, synced to the API's session on every full run."""
    keys = [c["key"] for c in session["categories"]]
    sig = config_sig(session)
    if st.session_state.get("_cfg_sig") != sig:
        # Another client (React, a second tab) may have changed these: follow the API.
        st.session_state["slot"] = session["my_slot"]
        for k in keys:
            st.session_state[f"punt_{k}"] = k in session["punts"]
        st.session_state["_cfg_sig"] = sig
    sb = st.sidebar
    sb.subheader("Session")
    sb.caption(f"Draft `{session['draft_id']}` · {session['teams']} teams · {session['rounds']} rounds")
    sb.selectbox("My draft slot", list(range(1, session["teams"] + 1)), key="slot",
                 placeholder="Pick your slot", on_change=_put_slot)
    sb.caption("Punt categories (re-values the pool)")
    for k, lab in labels(session).items():
        sb.toggle(lab, key=f"punt_{k}", on_change=_put_punts, args=(keys,))
    with sb.expander("Start or resume another draft"):
        setup_form(session, st)


def config_sig(session: dict) -> tuple:
    return session["draft_id"], session["my_slot"], tuple(session["punts"])


# ------------------------------------------------------------------ live board pieces
def countdown(session: dict, board: dict | None, where: Any) -> None:
    cp = session["current_pick"]
    if st.session_state.get("_clock_pick") != cp:
        st.session_state["_clock_pick"] = cp
        st.session_state["_clock_t0"] = time.monotonic()
    left = max(0.0, session["pick_clock_seconds"] - (time.monotonic() - st.session_state["_clock_t0"]))
    otc = session["on_the_clock"]
    mine = otc is not None and otc == session["my_slot"]
    c1, c2, c3, c4 = where.columns(4)
    c1.metric("Current pick", f"{cp} / {session['total_picks']}" if cp else "done")
    c2.metric("On the clock", "You" if mine else (f"Slot {otc}" if otc else "-"))
    decision = (board or {}).get("decision_pick")
    if decision and cp:
        until = decision - cp
        c3.metric("My next pick", decision, delta="now" if until == 0 else f"in {until} pick(s)",
                  delta_color="off", delta_arrow="off")
    else:
        c3.metric("My next pick", "-")
    c4.metric("Pick clock", f"{left:.0f}s", help="Local estimate: restarts whenever the current pick "
              "changes. Yahoo's own clock is the one that counts.")
    if mine:
        where.success("You are on the clock.")


REC_COLS = ["rec", "name", "team_abbr", "position", "tier", "gain", "expected_cats", "p_win_week",
            "p_win_week_mc", "p_available_at_decision", "p_available_next", "expected_pick", "reasons"]
REC_CONFIG = {
    "rec": st.column_config.NumberColumn("#", width="small"),
    "name": st.column_config.TextColumn("Player"),
    "team_abbr": st.column_config.TextColumn("Team", width="small"),
    "position": st.column_config.TextColumn("Pos", width="small"),
    "tier": st.column_config.NumberColumn("Tier", width="small"),
    "gain": st.column_config.NumberColumn("Gain", format="%+.2f",
                                          help="Change in expected categories won vs a typical pick here"),
    "expected_cats": st.column_config.NumberColumn("Exp. cats", format="%.2f"),
    "p_win_week": st.column_config.NumberColumn("P(win week)", format="percent"),
    "p_win_week_mc": st.column_config.NumberColumn("P(win week) MC", format="percent",
                                                   help="Monte Carlo re-check (top candidates only)"),
    "p_available_at_decision": st.column_config.NumberColumn("P(avail. at my pick)", format="percent"),
    "p_available_next": st.column_config.NumberColumn("P(avail. next pick)", format="percent"),
    "expected_pick": st.column_config.NumberColumn("Exp. pick", format="%.1f"),
    "reasons": st.column_config.TextColumn("Why", width="large"),
}


def recommendations(board: dict) -> None:
    st.subheader("Top recommendations")
    recs = pd.DataFrame(board["recommendations"])
    if recs.empty:
        st.write("No recommendations (no players left?).")
        return
    st.dataframe(recs.reindex(columns=REC_COLS), hide_index=True, width="stretch",
                 column_config=REC_CONFIG)


def my_team(board: dict, session: dict) -> None:
    team = board["my_team"]
    lab = labels(session)
    st.subheader("My team")
    c1, c2, c3 = st.columns(3)
    c1.metric("Expected categories won", f"{team['expected_cats']:.2f}")
    c2.metric("P(win week)", pct(team["p_win_week"]))
    c3.metric("Players", len(team["roster"]))
    st.caption("Open starting slots: " + (", ".join(team["open_slots"]) or "none"))
    balance = pd.DataFrame([{"category": lab.get(k, k), "punted": k in session["punts"],
                             "P(win)": team["p_cat"].get(k), "z balance": team["z_balance"].get(k)}
                            for k in lab])
    st.dataframe(balance, hide_index=True, width="stretch", column_config={
        "P(win)": st.column_config.ProgressColumn("P(win cat)", format="percent", min_value=0.0,
                                                  max_value=1.0),
        "z balance": st.column_config.NumberColumn("z balance", format="%+.2f",
                                                   help="Sum of category z-scores across my roster")})
    if team["roster"]:
        st.dataframe(pd.DataFrame(team["roster"]).reindex(
            columns=["name", "team_abbr", "position", "tier", "value", "expected_pick"]),
            hide_index=True, width="stretch")


def drift_warning(board: dict, session: dict) -> None:
    if board.get("drift"):
        lab = labels(session)
        cats = ", ".join(lab.get(k, k) for k in board["drift"])
        st.warning(f"Punt drift: my P(win) is below the board's threshold in {cats}. Either punt "
                   "them (sidebar) or draft for them on purpose.")


def tier_view(players: list[dict]) -> None:
    st.subheader("Tiers (available)")
    df = pd.DataFrame(players)
    if df.empty or "tier" not in df:
        st.write("No players available.")
        return
    df = df.dropna(subset=["tier"]).sort_values(["tier", "rank"])
    for tier, grp in list(df.groupby("tier", sort=True))[:TIERS_SHOWN]:
        names = ", ".join(f"{r['name']} ({r['position']}, {r['team_abbr']})" for _, r in grp.iterrows())
        st.markdown(f"**Tier {int(tier)}** · {len(grp)} left: {names}")


def recent_picks(session: dict) -> None:
    picks = pd.DataFrame(session["picks"])
    st.subheader("Recent picks")
    if picks.empty:
        st.write("No picks yet.")
        return
    picks = picks.sort_values("pick_no", ascending=False).head(10)
    picks["mine"] = picks["team_id"] == session["my_slot"]
    st.dataframe(picks.reindex(columns=["pick_no", "round", "team_id", "player_name", "mine"]),
                 hide_index=True, width="stretch",
                 column_config={"team_id": st.column_config.NumberColumn("Slot")})


def all_rosters(session: dict) -> None:
    with st.expander("All rosters"):
        try:
            code, data = call("GET", "/draft/rosters")
        except ApiDown:
            st.error(API_DOWN)
            return
        if code != 200:
            st.write(detail(data))
            return
        cols = {f"Slot {t}": [p["player_name"] for p in rows] for t, rows in data["teams"].items()}
        depth = max((len(v) for v in cols.values()), default=0)
        if depth == 0:
            st.write("No picks yet.")
            return
        wide = pd.DataFrame({k: v + [""] * (depth - len(v)) for k, v in cols.items()})
        wide.index = [f"R{i + 1}" for i in range(depth)]
        st.dataframe(wide, width="stretch")


def pick_entry(session: dict, players: list[dict]) -> bool:
    """Manual pick entry. Returns True when a pick (or undo) changed the draft."""
    otc = session["on_the_clock"]
    by_id = {p["player_id"]: p for p in players}

    def player_label(v: Any) -> str:
        p = by_id.get(v)
        if p is None:
            return str(v)           # free text: the API resolves the name
        return f"{p['name']} · {p['team_abbr']} · {p['position']} · rank {p['rank']} · tier {p['tier']}"

    changed = False
    with st.form("pick_form", clear_on_submit=True):
        c1, c2, c3 = st.columns([3, 2, 1])
        player = c1.selectbox("Player", list(by_id), index=None, format_func=player_label,
                              placeholder="Search available players", accept_new_options=True,
                              key="pick_player")
        team = c2.selectbox("Team (draft slot)", [0] + list(range(1, session["teams"] + 1)),
                            format_func=lambda t: f"On the clock (slot {otc})" if t == 0 else f"Slot {t}",
                            key="pick_team")
        pick_no = c3.number_input("Pick #", min_value=1, max_value=session["total_picks"], value=None,
                                  step=1, placeholder="current", key="pick_no")
        if st.form_submit_button("Record pick", type="primary", key="pick_submit",
                                 disabled=session["current_pick"] is None):
            if player is None:
                st.error("Choose a player.")
            else:
                body: dict[str, Any] = {"source": "manual"}
                if isinstance(player, int) and player in by_id:
                    body["player_id"] = player
                else:
                    body["player_name"] = str(player)
                if team:
                    body["team_id"] = int(team)
                if pick_no:
                    body["pick_no"] = int(pick_no)
                code, data = call("POST", "/draft/pick", body=body)
                if code == 200:
                    flash("success", f"Recorded {player_label(player).split(' · ')[0]}.")
                    changed = True
                else:
                    st.error(f"Pick not recorded: {detail(data)}")
    b1, b2, _ = st.columns([1, 1.5, 3])
    if b1.button("Undo last pick", key="undo"):
        code, data = call("POST", "/draft/undo")
        if code == 200:
            flash("info", "Last pick undone.")
            changed = True
        else:
            st.error(f"Undo failed: {detail(data)}")
    if b2.button("Export draft_results.csv", key="export"):
        code, data = call("POST", "/draft/export")
        if code == 200:
            st.success(f"Exported to `{data['path']}`")
        else:
            st.error(f"Export failed: {detail(data)}")
    return changed


# ------------------------------------------------------------------ live fragment
@st.fragment(run_every=POLL_EVERY)
def live() -> None:
    try:
        _live()
    except ApiDown:
        st.error(API_DOWN)


def _live() -> None:
    code, session = call("GET", "/draft/session")
    if code != 200:
        st.rerun()                      # session went away: fall back to the setup form
    if config_sig(session) != st.session_state.get("_cfg_sig"):
        st.rerun()                      # slot/punts changed elsewhere: re-sync the sidebar

    top = st.container()
    _, plist = call("GET", "/draft/players", params={"available_only": "true", "limit": 2000})
    players = plist.get("players", []) if isinstance(plist, dict) else []
    st.subheader("Enter a pick")
    if pick_entry(session, players):
        code, session = call("GET", "/draft/session")
        _, plist = call("GET", "/draft/players", params={"available_only": "true", "limit": 2000})
        players = plist.get("players", [])
    show_flash()

    t0 = time.perf_counter()
    bcode, board = call("GET", "/draft/board")
    round_trip_ms = 1000 * (time.perf_counter() - t0)
    ready = bcode == 200 and not board.get("complete")
    countdown(session, board if ready else None, top)

    if bcode == 409:
        st.info(detail(board))
    elif bcode != 200:
        st.error(f"Board unavailable: {detail(board)}")
    elif board.get("complete"):
        st.success("Draft complete. Export the results above.")
    else:
        drift_warning(board, session)
        recommendations(board)
        tm = board.get("timings_ms", {})
        st.caption("Board timings: " + " · ".join(f"{k} {v:.0f} ms" for k, v in tm.items())
                   + f" · round trip {round_trip_ms:.0f} ms")
        left, right = st.columns(2)
        with left:
            my_team(board, session)
        with right:
            tier_view(players)
    recent_picks(session)
    all_rosters(session)


# ------------------------------------------------------------------ page
st.title("Draft")
try:
    code, session = call("GET", "/draft/session")
except ApiDown:
    st.error(API_DOWN)
    st.caption(f"Looked for the draft API at {API_URL}.")
    st.stop()

if code != 200:
    st.info("No draft session yet. Start one (or resume a draft id whose picks are in the store).")
    show_flash()
    setup_form(None, st)
    st.stop()

show_flash()
session_controls(session)
live()

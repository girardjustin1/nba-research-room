"""Local JSON API for the draft (and later the season tools). The single source of truth that
the React app, the Streamlit Draft page and the Tampermonkey listener all talk to.

Inputs: the store (pool, schedule, pick log), settings. HTTP requests from localhost only.
Outputs: JSON for the board, rosters, players, session; picks written to `draft_picks`.
Tables: reads external_projections, game_logs, games, teams; writes draft_picks.

Run with `make draft-api` (127.0.0.1:8765). It never contacts Yahoo or performs any action
there: the Tampermonkey script *reports* picks it sees; nothing here clicks or drafts.

The store is opened per request and closed straight away. DuckDB allows one writer, and a
connection held open for the whole draft would lock out the Data page.
"""

from __future__ import annotations

import math
import threading
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from research_room import images, schedule, store
from research_room.config import Settings, settings
from research_room.draft import tracker
from research_room.draft.availability import expected_pick, picks_for_slot
from research_room.draft.board import DraftBoard
from research_room.draft.value import category_balance, compute_values
from research_room.ingest.external_proj import blend_preseason
from research_room.ingest.names import NameResolver

ALLOWED_ORIGINS = [
    "http://localhost:5173", "http://127.0.0.1:5173",       # React (Vite dev server)
    "http://localhost:6006", "http://127.0.0.1:6006",       # Storybook
    "http://localhost:8501", "http://127.0.0.1:8501",       # Streamlit
    "https://basketball.fantasysports.yahoo.com",           # Tampermonkey listener in the draft room
]


# ------------------------------------------------------------------ session
@dataclass
class Session:
    draft_id: str
    cfg: Settings
    pool: pd.DataFrame                  # blended per-game projections (unvalued)
    team_games_per_week: float
    punts: set[str] = field(default_factory=set)
    state: tracker.DraftState | None = None
    valued: pd.DataFrame | None = None
    board: DraftBoard | None = None
    resolver: NameResolver | None = None

    def rebuild(self) -> None:
        """Re-value the pool for the current punts and rebuild the board (punt toggles)."""
        self.valued = with_image_urls(expected_pick(compute_values(self.pool, self.cfg, punts=self.punts),
                                                    self.cfg))
        self.board = DraftBoard(self.valued, self.cfg, self.team_games_per_week)
        self.resolver = NameResolver(self.valued[["player_id", "name", "team_abbr"]].rename(
            columns={"name": "full_name"}))


def with_image_urls(df: pd.DataFrame, root=None) -> pd.DataFrame:
    """Relative URLs for cached images (null when no image is cached: the UI shows initials)."""
    root = root or images.IMAGE_DIR
    out = df.copy()
    out["headshot_url"] = out["player_id"].map(
        lambda p: f"/images/players/{int(p)}.png" if images.player_path(p, root).exists() else None)
    out["team_logo_url"] = out["team_abbr"].map(
        lambda a: f"/images/teams/{a}.svg" if isinstance(a, str) and images.team_path(a, root).exists()
        else None)
    return out


class _Holder:
    def __init__(self) -> None:
        self.session: Session | None = None
        self.lock = threading.RLock()

    def require(self) -> Session:
        if self.session is None or self.session.state is None:
            raise HTTPException(409, "no draft session; POST /draft/session first")
        return self.session


def start_session(draft_id: str, my_slot: int | None, punts: set[str], cfg: Settings | None = None,
                  db_path: str | None = None) -> Session:
    cfg = cfg or settings()
    con = store.connect(db_path)
    try:
        pool = blend_preseason(con, cfg)
        gpw = schedule.games_per_week(schedule.load_games(con, cfg.season.nba_season), cfg.season)
        state = tracker.load_state(con, draft_id, cfg, my_slot)
    finally:
        con.close()
    s = Session(draft_id, cfg, pool, gpw, set(punts), state)
    s.rebuild()
    return s


# ------------------------------------------------------------------ request bodies
class SessionIn(BaseModel):
    draft_id: str = Field(default_factory=lambda: f"hoopdreams-{settings().season.nba_season}")
    my_slot: int | None = None
    punts: list[str] = Field(default_factory=list)


class PickIn(BaseModel):
    player_id: int | None = None
    player_name: str | None = None
    team_abbr: str | None = None        # NBA team, helps resolve shared names
    team_id: int | None = None          # draft slot; defaults to the team on the clock
    pick_no: int | None = None          # defaults to the current pick
    source: str = "manual"              # manual | listener


class PuntsIn(BaseModel):
    punts: list[str]


class SlotIn(BaseModel):
    my_slot: int


# ------------------------------------------------------------------ serialisation
def _clean(v: Any) -> Any:
    if isinstance(v, (float, np.floating)):
        return None if math.isnan(float(v)) else float(v)
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, np.bool_):
        return bool(v)
    if isinstance(v, (list, tuple, np.ndarray)):
        return [_clean(x) for x in v]
    return v


def records(df: pd.DataFrame, cols: list[str] | None = None) -> list[dict]:
    frame = df.reindex(columns=cols) if cols else df          # absent optional columns -> null
    return [{k: _clean(v) for k, v in row.items()} for row in frame.to_dict("records")]


PLAYER_COLS = [
    "player_id", "headshot_url", "team_logo_url", "name", "team_abbr", "position", "eligible",
    "games", "minutes_pg", "value", "value_pg", "rank", "tier", "expected_pick", "adp_source",
    "yahoo_adp", "injury_risk", "sources",
]


def session_json(s: Session) -> dict:
    st = s.state
    mine = picks_for_slot(st.my_slot, st.teams, st.rounds) if st.my_slot else []
    return {"draft_id": s.draft_id, "my_slot": st.my_slot, "teams": st.teams, "rounds": st.rounds,
            "total_picks": st.total_picks, "current_pick": st.current_pick,
            "on_the_clock": st.on_the_clock, "my_picks": mine, "punts": sorted(s.punts),
            "pick_clock_seconds": s.cfg.draft.pick_clock_seconds,
            "categories": [{"key": c.key, "label": c.label} for c in s.cfg.categories],
            "picks": records(st.picks)}


# ------------------------------------------------------------------ app
def create_app(db_path: str | None = None, image_root=None) -> FastAPI:
    app = FastAPI(title="NBA Research Room", version="0.1.0")
    app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_methods=["*"],
                       allow_headers=["*"])
    h = _Holder()
    app.state.holder = h
    image_root = image_root or images.IMAGE_DIR

    def write(fn):
        con = store.connect(db_path)
        try:
            return fn(con)
        finally:
            con.close()

    @app.get("/health")
    def health() -> dict:
        return {"ok": True, "session": h.session.draft_id if h.session else None}

    @app.post("/draft/session")
    def post_session(body: SessionIn) -> dict:
        with h.lock:
            try:
                h.session = start_session(body.draft_id, body.my_slot, set(body.punts), db_path=db_path)
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc
            return session_json(h.session)

    @app.get("/draft/session")
    def get_session() -> dict:
        return session_json(h.require())

    @app.put("/draft/slot")
    def put_slot(body: SlotIn) -> dict:
        with h.lock:
            s = h.require()
            if not 1 <= body.my_slot <= s.state.teams:
                raise HTTPException(400, f"slot must be 1..{s.state.teams}")
            s.state.my_slot = body.my_slot
            return session_json(s)

    @app.put("/draft/punts")
    def put_punts(body: PuntsIn) -> dict:
        with h.lock:
            s = h.require()
            unknown = set(body.punts) - {c.key for c in s.cfg.categories}
            if unknown:
                raise HTTPException(400, f"unknown categories {sorted(unknown)}")
            s.punts = set(body.punts)
            s.rebuild()
            return session_json(s)

    @app.get("/draft/board")
    def get_board() -> dict:
        with h.lock:
            s = h.require()
            if s.state.my_slot is None:
                raise HTTPException(409, "set your draft slot first (PUT /draft/slot)")
            if s.state.current_pick is None:
                return {"complete": True, **session_json(s)}
            res = s.board.recommend(s.state, s.punts)
            cols = PLAYER_COLS + ["starts", "expected_cats", "gain", "p_win_week", "p_win_week_mc",
                                  "p_available_at_decision", "p_available_next", "reasons"]
            mine = s.state.roster(s.state.my_slot)
            roster = s.valued[s.valued["player_id"].isin(mine["player_id"])]
            return {
                "complete": False, "decision_pick": res.decision_pick, "following_pick": res.following_pick,
                "on_the_clock": s.state.on_the_clock, "recommendations": records(res.table, cols),
                "my_team": {"p_cat": res.my_p_cat, "expected_cats": res.my_expected_cats,
                            "p_win_week": res.my_p_win_week, "open_slots": res.open_slots,
                            "z_balance": _clean_dict(category_balance(roster, s.cfg).to_dict()),
                            "roster": records(roster, PLAYER_COLS)},
                "drift": res.drift, "timings_ms": res.timings_ms,
            }

    @app.get("/draft/players")
    def get_players(q: str = "", available_only: bool = True, limit: int = 300) -> dict:
        s = h.require()
        df = s.valued
        drafted = s.state.drafted
        if available_only:
            df = df[~df["player_id"].isin(drafted)]
        if q:
            df = df[df["name"].str.contains(q, case=False, regex=False)]
        out = df.head(limit).assign(drafted=lambda d: d["player_id"].isin(drafted))
        return {"players": records(out, PLAYER_COLS + ["drafted"])}

    @app.get("/draft/rosters")
    def get_rosters() -> dict:
        s = h.require()
        teams = {}
        for t in range(1, s.state.teams + 1):
            teams[t] = records(s.state.roster(t))
        return {"teams": teams}

    @app.post("/draft/pick")
    def post_pick(body: PickIn) -> dict:
        with h.lock:
            s = h.require()
            pid, name = body.player_id, body.player_name
            if pid is None:
                if not name:
                    raise HTTPException(400, "send player_id or player_name")
                res = s.resolver.resolve(name, body.team_abbr)
                if res.player_id is None:
                    raise HTTPException(409, {"error": f"could not match '{name}' ({res.reason})",
                                              "candidates": res.candidates})
                pid = res.player_id
            row = s.valued[s.valued["player_id"] == pid]
            if row.empty:
                raise HTTPException(404, f"player {pid} is not in the draft pool")
            name = row.iloc[0]["name"]
            try:
                s.state = write(lambda con: tracker.record_pick(
                    con, s.state, pid, name, team_id=body.team_id, pick_no=body.pick_no,
                    entry_source=body.source))
            except tracker.PickError as exc:
                raise HTTPException(409, str(exc)) from exc
            return session_json(s)

    @app.post("/draft/undo")
    def post_undo() -> dict:
        with h.lock:
            s = h.require()
            try:
                s.state = write(lambda con: tracker.undo_last(con, s.state))
            except tracker.PickError as exc:
                raise HTTPException(409, str(exc)) from exc
            return session_json(s)

    @app.get("/images/players/{player_id}.png")
    def player_image(player_id: int) -> FileResponse:
        path = images.player_path(player_id, image_root)
        if not path.exists():
            raise HTTPException(404, "no cached headshot; run `make images`")
        return FileResponse(path, media_type="image/png", headers={"Cache-Control": "max-age=86400"})

    @app.get("/images/teams/{abbr}.svg")
    def team_image(abbr: str) -> FileResponse:
        if not abbr.isalpha() or len(abbr) > 4:
            raise HTTPException(400, "bad team abbreviation")
        path = images.team_path(abbr, image_root)
        if not path.exists():
            raise HTTPException(404, "no cached logo; run `make images`")
        return FileResponse(path, media_type="image/svg+xml", headers={"Cache-Control": "max-age=86400"})

    @app.post("/draft/export")
    def post_export() -> dict:
        s = h.require()
        return {"path": str(tracker.export_results(s.state))}

    return app


def _clean_dict(d: dict) -> dict:
    return {k: _clean(v) for k, v in d.items()}

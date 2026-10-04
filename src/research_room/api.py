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

import contextlib
import math
import threading
import time
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
from research_room.draft.board import DraftBoard, split_starters
from research_room.draft.bots import BOT_POSITION_CAP, bot_choice
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
PRIMARY = ("PG", "SG", "SF", "PF", "C")
MOCK_TICK_S = 0.1
MOCK_SPEED_RANGE = (0.1, 60.0)


@dataclass
class MockState:
    """A mock draft against bots. Picks live in an in-memory store, never the real one."""
    speed_s: float
    seed: int
    paused: bool = False
    finished: bool = False
    next_due: float = 0.0
    rng: np.random.Generator | None = None
    con: Any = None

    def __post_init__(self) -> None:
        self.rng = np.random.default_rng(self.seed)
        self.con = store.connect(":memory:")


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
    extras: pd.DataFrame | None = None  # player_id, rookie, playoff_games (from the store)
    mock: MockState | None = None
    names: dict[int, str] = field(default_factory=dict)   # saved team names for this draft

    @property
    def mode(self) -> str:
        return "mock" if self.mock else "live"

    def team_names(self) -> dict[int, str]:
        st = self.state
        label = "Bot" if self.mock else "Team"
        return {t: self.names.get(t) or ("You" if t == st.my_slot else f"{label} {t}")
                for t in range(1, st.teams + 1)}

    def rebuild(self) -> None:
        """Re-value the pool for the current punts and rebuild the board (punt toggles)."""
        valued = expected_pick(compute_values(self.pool, self.cfg, punts=self.punts), self.cfg)
        self.valued = with_image_urls(add_ranks(valued, self.extras))
        self.board = DraftBoard(self.valued, self.cfg, self.team_games_per_week)
        self.resolver = NameResolver(self.valued[["player_id", "name", "team_abbr"]].rename(
            columns={"name": "full_name"}))


def add_ranks(valued: pd.DataFrame, extras: pd.DataFrame | None) -> pd.DataFrame:
    """Positional rank by value, ADP rank overall and by position, plus rookie / playoff games."""
    out = valued.copy()
    out["pos_rank"] = out.groupby("position")["value"].rank(ascending=False, method="first")
    out["adp_rank"] = out["expected_pick"].rank(method="first")
    out["adp_pos_rank"] = out.groupby("position")["expected_pick"].rank(method="first")
    if extras is not None and not extras.empty:
        out = out.drop(columns=[c for c in ("rookie", "playoff_games") if c in out]).merge(
            extras, on="player_id", how="left")
    return out


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


def load_extras(con, cfg: Settings) -> pd.DataFrame:
    """Rookie flag (drafted in the season's NBA draft) and games in the fantasy playoff weeks."""
    games = schedule.load_games(con, cfg.season.nba_season)
    m = schedule.team_week_matrix(games, cfg.season)
    playoff = m[m["is_playoff"]].groupby("team_id")["games"].sum()
    players = con.execute("SELECT player_id, draft_year, team_id FROM players").df()
    players["rookie"] = players["draft_year"] == cfg.season.nba_season
    players["playoff_games"] = players["team_id"].map(playoff)
    return players[["player_id", "rookie", "playoff_games"]]


def start_session(draft_id: str, my_slot: int | None, punts: set[str], cfg: Settings | None = None,
                  db_path: str | None = None, mock: MockState | None = None) -> Session:
    """Load the pool and the pick log (the real store, or the mock's in-memory store)."""
    cfg = cfg or settings()
    con = store.connect(db_path)
    try:
        pool = blend_preseason(con, cfg)
        gpw = schedule.games_per_week(schedule.load_games(con, cfg.season.nba_season), cfg.season)
        extras = load_extras(con, cfg)
        log = mock.con if mock else con
        state = tracker.load_state(log, draft_id, cfg, my_slot)
        saved = dict(log.execute("SELECT team_id, name FROM draft_teams WHERE draft_id = ?",
                                 [draft_id]).fetchall())
    finally:
        con.close()
    s = Session(draft_id, cfg, pool, gpw, set(punts), state, extras=extras, mock=mock, names=saved)
    s.rebuild()
    return s


def league_with_teams(teams: int, base: Settings | None = None) -> Settings:
    s = base or settings()
    return s.model_copy(update={"league": s.league.model_copy(update={"teams": teams})})


def bot_pick(s: Session) -> int:
    """The bot on the clock picks by noisy ADP (see draft.bots)."""
    st = s.state
    avail = s.valued.set_index("player_id", drop=False)
    avail = avail[~avail.index.isin(st.drafted)]
    held = list(avail.reindex(st.roster(st.on_the_clock)["player_id"])["position"].dropna())
    return bot_choice(avail, held, s.mock.rng, BOT_POSITION_CAP)


def my_auto_pick(s: Session) -> int:
    return int(s.board.recommend(s.state, s.punts).table.iloc[0]["player_id"])


def _record_mock(s: Session, pid: int, source: str) -> None:
    name = s.valued.loc[s.valued["player_id"] == pid, "name"].iloc[0]
    s.state = tracker.record_pick(s.mock.con, s.state, pid, name, entry_source=source)


def advance_mock(s: Session, now: float) -> bool:
    """One bot pick if it is a bot's turn and the speed timer has elapsed. Never picks for me."""
    m = s.mock
    if m is None or m.paused or m.finished or s.state.current_pick is None:
        return False
    if s.state.on_the_clock == s.state.my_slot or now < m.next_due:
        return False
    _record_mock(s, bot_pick(s), "bot")
    m.next_due = now + m.speed_s
    if s.state.current_pick is None:
        m.finished = True
    return True


def finish_mock(s: Session) -> None:
    """Fill every remaining pick at once: bots by noisy ADP, me by the board's #1."""
    while s.state.current_pick is not None:
        mine = s.state.on_the_clock == s.state.my_slot
        _record_mock(s, my_auto_pick(s) if mine else bot_pick(s), "auto" if mine else "bot")
    s.mock.finished = True


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


class MockIn(BaseModel):
    draft_id: str = Field(default_factory=lambda: f"mock-{int(time.time())}")
    teams: int = Field(default_factory=lambda: settings().league.teams, ge=2, le=20)
    my_slot: int = 1
    speed_s: float = 1.0
    seed: int = 1
    punts: list[str] = Field(default_factory=list)


class NamesIn(BaseModel):
    names: dict[int, str]


class SpeedIn(BaseModel):
    speed_s: float


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
    "yahoo_adp", "injury_risk", "sources", "pos_rank", "adp_rank", "adp_pos_rank", "rookie",
    "playoff_games",
]
COMPARE_STATS = ("pts", "reb", "ast", "stl", "blk", "fg3m", "fgm", "fga", "ftm", "fta", "tov")


def session_json(s: Session) -> dict:
    st = s.state
    mine = picks_for_slot(st.my_slot, st.teams, st.rounds) if st.my_slot else []
    return {"draft_id": s.draft_id, "my_slot": st.my_slot, "teams": st.teams, "rounds": st.rounds,
            "total_picks": st.total_picks, "current_pick": st.current_pick,
            "on_the_clock": st.on_the_clock, "my_picks": mine, "punts": sorted(s.punts),
            "pick_clock_seconds": s.cfg.draft.pick_clock_seconds,
            "categories": [{"key": c.key, "label": c.label} for c in s.cfg.categories],
            "mode": s.mode, "team_names": s.team_names(),
            "mock": ({"speed_s": s.mock.speed_s, "paused": s.mock.paused, "finished": s.mock.finished}
                     if s.mock else None),
            "picks": records(st.picks)}


# ------------------------------------------------------------------ app
def create_app(db_path: str | None = None, image_root=None, run_mock_thread: bool = True) -> FastAPI:
    app = FastAPI(title="NBA Research Room", version="0.1.0")
    app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_methods=["*"],
                       allow_headers=["*"])
    h = _Holder()
    app.state.holder = h
    image_root = image_root or images.IMAGE_DIR

    def write(fn, s: Session | None = None):
        if s is not None and s.mock is not None:
            return fn(s.mock.con)                        # mock picks never touch the real store
        con = store.connect(db_path)
        try:
            return fn(con)
        finally:
            con.close()

    def tick() -> bool:
        with h.lock:
            return bool(h.session and advance_mock(h.session, time.monotonic()))
    app.state.tick = tick

    if run_mock_thread:
        def loop() -> None:
            while True:
                time.sleep(MOCK_TICK_S)
                with contextlib.suppress(Exception):       # keep the ticker alive
                    tick()
        threading.Thread(target=loop, name="mock-draft-ticker", daemon=True).start()

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
            cols = PLAYER_COLS + [f"dp_{c.key}" for c in s.cfg.categories] + [
                                  "starts", "expected_cats", "gain", "p_win_week", "p_win_week_mc",
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

    @app.get("/draft/teams")
    def get_teams() -> dict:
        """Every team's roster and needs, and when it picks next (for strategy)."""
        with h.lock:
            s = h.require()
            st, board = s.state, s.board
            current = st.current_pick
            names = s.team_names()
            out = []
            for t in range(1, st.teams + 1):
                ids = [p for p in st.roster(t)["player_id"] if p in board.pool.index]
                roster = s.valued[s.valued["player_id"].isin(ids)]
                _, open_slots = split_starters([board.pool.at[p, "eligible"] for p in ids],
                                               board.starting_slots)
                nxt = next((p for p in picks_for_slot(t, st.teams, st.rounds)
                            if current and p >= current), None)
                counts = roster["position"].value_counts()
                out.append({
                    "team_id": t, "name": names[t], "is_me": t == st.my_slot,
                    "roster": records(roster, PLAYER_COLS),
                    "position_counts": {pos: int(counts.get(pos, 0)) for pos in PRIMARY},
                    "open_slots": open_slots,
                    "z_balance": _clean_dict(category_balance(roster, s.cfg).to_dict()),
                    "next_pick": nxt, "picks_until_next": (nxt - current) if nxt and current else None,
                })
            return {"teams": out, "current_pick": current}

    @app.get("/draft/insights")
    def get_insights(last: int = 5) -> dict:
        """Live read on the most recent picks: each drafting team's needs, strengths and
        weaknesses, and its projected head-to-head against me, as rosters stand right now."""
        with h.lock:
            s = h.require()
            picks = s.state.picks.sort_values("pick_no", ascending=False).head(max(1, min(last, 50)))
            names = s.team_names()
            out = []
            for pick_no in picks["pick_no"].astype(int):
                ins = s.board.pick_insight(s.state, pick_no)
                ins["team_name"] = names.get(ins["team_id"])
                out.append(ins)
            return {"insights": out, "current_pick": s.state.current_pick,
                    "categories": [{"key": c.key, "label": c.label} for c in s.cfg.categories]}

    @app.put("/draft/teams/names")
    def put_team_names(body: NamesIn) -> dict:
        with h.lock:
            s = h.require()
            try:
                write(lambda con: tracker.save_team_names(con, s.state, body.names), s)
            except tracker.PickError as exc:
                raise HTTPException(400, str(exc)) from exc
            s.names.update({int(k): v.strip()[:40] for k, v in body.names.items() if v.strip()})
            return session_json(s)

    @app.delete("/draft/pick/{pick_no}")
    def delete_pick(pick_no: int) -> dict:
        with h.lock:
            s = h.require()
            try:
                s.state = write(lambda con: tracker.remove_pick(con, s.state, pick_no), s)
            except tracker.PickError as exc:
                raise HTTPException(409, str(exc)) from exc
            return session_json(s)

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
                    entry_source=body.source), s)
            except tracker.PickError as exc:
                raise HTTPException(409, str(exc)) from exc
            return session_json(s)

    @app.post("/draft/undo")
    def post_undo() -> dict:
        with h.lock:
            s = h.require()
            try:
                s.state = write(lambda con: tracker.undo_last(con, s.state), s)
            except tracker.PickError as exc:
                raise HTTPException(409, str(exc)) from exc
            return session_json(s)

    # ---------------------------------------------------------------- mock drafts
    def require_mock() -> Session:
        s = h.require()
        if s.mock is None:
            raise HTTPException(409, "not a mock draft; POST /draft/mock to start one")
        return s

    def check_speed(v: float) -> float:
        lo, hi = MOCK_SPEED_RANGE
        if not lo <= v <= hi:
            raise HTTPException(400, f"speed_s must be between {lo} and {hi} seconds")
        return v

    @app.post("/draft/mock")
    def post_mock(body: MockIn) -> dict:
        with h.lock:
            if not 1 <= body.my_slot <= body.teams:
                raise HTTPException(400, f"my_slot must be 1..{body.teams}")
            m = MockState(speed_s=check_speed(body.speed_s), seed=body.seed)
            m.next_due = time.monotonic() + m.speed_s
            h.session = start_session(body.draft_id, body.my_slot, set(body.punts),
                                      cfg=league_with_teams(body.teams), db_path=db_path, mock=m)
            return session_json(h.session)

    @app.post("/draft/mock/speed")
    def post_speed(body: SpeedIn) -> dict:
        with h.lock:
            s = require_mock()
            s.mock.speed_s = check_speed(body.speed_s)
            s.mock.next_due = min(s.mock.next_due, time.monotonic() + s.mock.speed_s)
            return session_json(s)

    @app.post("/draft/mock/pause")
    def post_pause() -> dict:
        with h.lock:
            s = require_mock()
            s.mock.paused = True
            return session_json(s)

    @app.post("/draft/mock/resume")
    def post_resume() -> dict:
        with h.lock:
            s = require_mock()
            s.mock.paused = False
            s.mock.next_due = time.monotonic() + s.mock.speed_s
            return session_json(s)

    @app.post("/draft/mock/pick-now")
    def post_pick_now() -> dict:
        with h.lock:
            s = require_mock()
            if s.state.current_pick is None or s.state.on_the_clock != s.state.my_slot:
                raise HTTPException(409, "you are not on the clock")
            _record_mock(s, my_auto_pick(s), "auto")
            s.mock.next_due = time.monotonic() + s.mock.speed_s
            return session_json(s)

    @app.post("/draft/mock/finish")
    def post_finish() -> dict:
        with h.lock:
            s = require_mock()
            finish_mock(s)
            return session_json(s)

    # ---------------------------------------------------------------- draft analytics
    @app.get("/draft/positional_value")
    def get_positional_value() -> dict:
        with h.lock:
            s = h.require()
            if s.state.my_slot is None or s.state.current_pick is None:
                raise HTTPException(409, "needs an open draft with your slot set")
            res = s.board.recommend(s.state, s.punts)
            scores = res.scores
            my_ids = [p for p in s.state.roster(s.state.my_slot)["player_id"] if p in s.board.pool.index]
            _, open_slots = split_starters([s.board.pool.at[p, "eligible"] for p in my_ids],
                                           s.board.starting_slots)
            rows = []
            for pos in PRIMARY:
                at = scores[scores["position"] == pos].sort_values("value", ascending=False)
                if at.empty:
                    rows.append({"pos": pos, "best_available": None, "replacement_value": 0.0,
                                 "value_over_replacement": 0.0, "drop_if_wait": None,
                                 "my_open_slots": 0})
                    continue
                best = at.iloc[0]
                v, a = at["value"].to_numpy(), at["p_available_next"].to_numpy()
                none_better = np.r_[1.0, np.cumprod(1 - a)[:-1]]
                expected_next = float((v * a * none_better).sum())
                fills = s.cfg.draft.position_eligibility.get(pos, [pos])
                rows.append({
                    "pos": pos,
                    "best_available": {"player_id": int(best["player_id"]), "name": best["name"],
                                       "value": float(best["value"])},
                    "replacement_value": 0.0,            # `value` is already over replacement
                    "value_over_replacement": max(0.0, float(best["value"])),
                    "drop_if_wait": float(best["value"]) - expected_next if res.following_pick else None,
                    "my_open_slots": sum(1 for slot in open_slots if slot in fills and slot != "Util"),
                })
            top = max((r["value_over_replacement"] for r in rows), default=0.0) or 1.0
            for r in rows:
                r["scale_0_1"] = r["value_over_replacement"] / top
            return {"positions": rows, "following_pick": res.following_pick,
                    "note": "value = season value over replacement (z-score units x games/82)"}

    @app.get("/draft/compare")
    def get_compare(ids: str) -> dict:
        with h.lock:
            s = h.require()
            try:
                wanted = [int(x) for x in ids.split(",") if x.strip()]
            except ValueError as exc:
                raise HTTPException(400, "ids must be comma-separated player ids") from exc
            if not 1 <= len(wanted) <= 6:
                raise HTTPException(400, "compare 1 to 6 players")
            rows = s.valued[s.valued["player_id"].isin(wanted)].set_index("player_id")
            missing = sorted(set(wanted) - set(rows.index))
            if missing:
                raise HTTPException(404, f"not in the draft pool: {missing}")
            scored = None
            if s.state.my_slot and s.state.current_pick:
                sc = s.board.recommend(s.state, s.punts).scores.set_index("player_id")
                scored = sc[["gain", "expected_cats", "p_available_next", "p_available_at_decision"]]
            rows = rows.join(scored, how="left") if scored is not None else rows
            rows = rows.reindex(wanted).reset_index()
            rows["drafted"] = rows["player_id"].isin(s.state.drafted)
            cols = (PLAYER_COLS + [f"{k}_mean" for k in COMPARE_STATS]
                    + [f"z_{c.key}" for c in s.cfg.categories]
                    + ["gain", "expected_cats", "p_available_next", "p_available_at_decision", "drafted"])
            return {"players": records(rows, cols)}

    # ---------------------------------------------------------------- schedule (real 2026-27 data)
    sched_cache: dict = {}

    def schedule_frames():
        """Team-week matrix and per-team daily games, computed once per API process."""
        if not sched_cache:
            cfg = settings()
            con = store.connect(db_path, read_only=True) if db_path is None else store.connect(db_path)
            try:
                games = schedule.load_games(con, cfg.season.nba_season)
                abbr = dict(con.execute("SELECT team_id, abbreviation FROM teams").fetchall())
            finally:
                con.close()
            tg = schedule.flag_back_to_backs(schedule.team_games(games))
            daily = schedule.daily_counts(tg, cfg.season.light_day_max_games).set_index("game_date")
            opp = pd.concat([
                games[["game_id", "home_team_id", "visitor_team_id"]].rename(
                    columns={"home_team_id": "team_id", "visitor_team_id": "opp_id"}).assign(home=True),
                games[["game_id", "visitor_team_id", "home_team_id"]].rename(
                    columns={"visitor_team_id": "team_id", "home_team_id": "opp_id"}).assign(home=False)])
            tg = tg.merge(opp[["game_id", "team_id", "opp_id"]], on=["game_id", "team_id"], how="left")
            tg["team"] = tg["team_id"].map(abbr)
            tg["opponent"] = tg["opp_id"].map(abbr)
            tg["light_day"] = tg["game_date"].map(daily["light_day"])
            sched_cache.update(cfg=cfg, matrix=schedule.team_week_matrix(games, cfg.season),
                               weeks=schedule.fantasy_weeks(cfg.season), team_games=tg, abbr=abbr,
                               daily=daily)
        return sched_cache

    @app.get("/schedule/team_weeks")
    def get_team_weeks() -> dict:
        """Games per team per fantasy week (+ back-to-backs, light-day games), playoff-week totals."""
        sc = schedule_frames()
        m, weeks = sc["matrix"].copy(), sc["weeks"]
        m["team"] = m["team_id"].map(sc["abbr"])
        teams = []
        for team, g in m.groupby("team"):
            g = g.set_index("week")
            teams.append({
                "team": team,
                "games_by_week": {int(k): int(v) for k, v in g["games"].items()},
                "b2b_by_week": {int(k): int(v) for k, v in g["b2b_games"].items()},
                "light_day_games_by_week": {int(k): int(v) for k, v in g["light_day_games"].items()},
                "total": int(g["games"].sum()),
                "playoff_games": int(g.loc[g["is_playoff"], "games"].sum()),
            })
        return {"weeks": [{"week": int(w.week), "start": str(w.start), "end": str(w.end),
                           "n_days": int(w.n_days), "is_playoff": bool(w.is_playoff)}
                          for w in weeks.itertuples()],
                "teams": sorted(teams, key=lambda t: t["team"]),
                "unscheduled_note": "the NBA schedules 30 more games after the Cup group stage; "
                                    "December counts will rise",
                "source": "BallDontLie games (2026-27 schedule)"}

    @app.get("/schedule/team_days")
    def get_team_days(team: str, start: str | None = None, end: str | None = None) -> dict:
        """One team's game days (opponent, home/away, back-to-back, light day) in a date range."""
        sc = schedule_frames()
        team = team.upper()
        if team not in set(sc["abbr"].values()):
            raise HTTPException(404, f"unknown team {team}")
        tg = sc["team_games"]
        days = tg[tg["team"] == team]
        if start:
            days = days[days["game_date"] >= pd.Timestamp(start).date()]
        if end:
            days = days[days["game_date"] <= pd.Timestamp(end).date()]
        return {"team": team, "days": [
            {"date": str(r.game_date), "opponent": r.opponent, "home": bool(r.home),
             "back_to_back": bool(r.b2b), "light_day": bool(r.light_day),
             "week": schedule.week_of(r.game_date, sc["cfg"].season)}
            for r in days.itertuples()]}

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

"""The Streamlit Draft page as an API client: HTTP is faked by monkeypatching `requests.request`,
so no draft API (and no store) is needed. Players are synthetic."""

from __future__ import annotations

from pathlib import Path

import pytest
import requests
from streamlit.testing.v1 import AppTest

PAGE = Path(__file__).resolve().parents[1] / "app" / "pages" / "1_Draft.py"
CATS = [{"key": k, "label": lab} for k, lab in
        [("fg_pct", "FG%"), ("ft_pct", "FT%"), ("fg3m", "3PTM"), ("pts", "PTS"), ("reb", "REB"),
         ("ast", "AST"), ("stl", "ST"), ("blk", "BLK"), ("tov", "TO")]]
KEYS = [c["key"] for c in CATS]


def player(pid: int, name: str, pos: str, tier: int, rank: int) -> dict:
    return {"player_id": pid, "name": name, "team_abbr": "AAA", "position": pos, "eligible": [pos, "Util"],
            "games": 70.0, "minutes_pg": 32.0, "value": 10.0 - rank, "value_pg": 1.0, "rank": rank,
            "tier": tier, "expected_pick": float(rank), "adp_source": "yahoo", "yahoo_adp": float(rank),
            "injury_risk": "L", "sources": "bbm+last_season", "drafted": False}


POOL = [player(101, "Synth Guard One", "PG", 1, 1), player(102, "Synth Center Two", "C", 1, 2),
        player(103, "Synth Wing Three", "SF", 2, 3), player(104, "Synth Forward Four", "PF", 3, 4)]


class Resp:
    def __init__(self, code: int, data: dict) -> None:
        self.status_code, self._data = code, data

    def json(self) -> dict:
        return self._data


class FakeApi:
    """Just enough of the draft API's routes and shapes (see research_room/api.py)."""

    def __init__(self, session: bool = True, my_slot: int | None = 3, down: bool = False) -> None:
        self.calls: list[tuple[str, str, dict | None]] = []
        self.down = down
        self.picks: list[dict] = []
        self.punts: list[str] = []
        self.my_slot = my_slot
        self.draft_id = "test-draft" if session else None

    def session(self) -> dict:
        cp = len(self.picks) + 1
        return {"draft_id": self.draft_id, "my_slot": self.my_slot, "teams": 4, "rounds": 2,
                "total_picks": 8, "current_pick": cp, "on_the_clock": [1, 2, 3, 4, 4, 3, 2, 1][cp - 1],
                "my_picks": [3, 6], "punts": self.punts, "pick_clock_seconds": 60, "categories": CATS,
                "picks": self.picks}

    def board(self) -> dict:
        drafted = {p["player_id"] for p in self.picks}
        avail = [p for p in POOL if p["player_id"] not in drafted]
        recs = [{**p, "rec": i + 1, "expected_cats": 4.5, "gain": 0.3 - 0.1 * i, "p_win_week": 0.55,
                 "p_win_week_mc": 0.54, "p_available_at_decision": 0.4, "p_available_next": 0.1,
                 "reasons": f"synthetic reason {i + 1}"} for i, p in enumerate(avail)]
        return {"complete": False, "decision_pick": 3, "following_pick": 6, "on_the_clock": 1,
                "recommendations": recs,
                "my_team": {"p_cat": dict.fromkeys(KEYS, 0.5), "expected_cats": 4.5, "p_win_week": 0.5,
                            "open_slots": ["PG", "C", "Util"], "z_balance": dict.fromkeys(KEYS, 0.0),
                            "roster": []},
                "drift": ["reb"], "timings_ms": {"setup": 5.0, "score": 4.0, "monte_carlo": 3.0,
                                                 "total": 12.0}}

    def __call__(self, method: str, url: str, params=None, json=None, timeout=None) -> Resp:
        path = url.split("8765", 1)[-1]
        self.calls.append((method, path, json))
        if self.down:
            raise requests.ConnectionError("connection refused")
        if path == "/draft/session" and method == "POST":
            self.draft_id = json.get("draft_id", "default-draft")
            self.my_slot, self.punts = json["my_slot"], json["punts"]
            return Resp(200, self.session())
        if self.draft_id is None:
            return Resp(409, {"detail": "no draft session; POST /draft/session first"})
        if path == "/draft/session":
            return Resp(200, self.session())
        if path == "/draft/board":
            if self.my_slot is None:
                return Resp(409, {"detail": "set your draft slot first (PUT /draft/slot)"})
            return Resp(200, self.board())
        if path == "/draft/players":
            drafted = {p["player_id"] for p in self.picks}
            return Resp(200, {"players": [p for p in POOL if p["player_id"] not in drafted]})
        if path == "/draft/rosters":
            return Resp(200, {"teams": {str(t): [p for p in self.picks if p["team_id"] == t]
                                        for t in range(1, 5)}})
        if path == "/draft/pick":
            p = next(x for x in POOL if x["player_id"] == json["player_id"])
            n = len(self.picks) + 1
            self.picks.append({"pick_no": n, "round": 1, "team_id": n, "player_id": p["player_id"],
                               "player_name": p["name"], "is_keeper": False})
            return Resp(200, self.session())
        if path == "/draft/undo":
            self.picks.pop()
            return Resp(200, self.session())
        if path == "/draft/punts":
            self.punts = json["punts"]
            return Resp(200, self.session())
        if path == "/draft/export":
            return Resp(200, {"path": "/tmp/draft_results.csv"})
        return Resp(404, {"detail": "not found"})


@pytest.fixture
def fake(monkeypatch):
    def install(**kw) -> FakeApi:
        api = FakeApi(**kw)
        monkeypatch.setattr(requests, "request", api)
        return api
    return install


def run_page() -> AppTest:
    at = AppTest.from_file(str(PAGE), default_timeout=30).run()
    assert not at.exception, at.exception
    return at


def posts(api: FakeApi, path: str) -> list[dict]:
    return [body for m, p, body in api.calls if m in ("POST", "PUT") and p == path]


def test_api_down_shows_how_to_start_it(fake):
    fake(down=True)
    at = run_page()
    assert at.error[0].value == "Start the draft API: make draft-api"


def test_session_setup_posts_slot_and_punts(fake):
    api = fake(session=False)
    at = run_page()
    assert "No draft session yet" in at.info[0].value
    at.selectbox(key="setup_slot").set_value(4)
    at.toggle(key="setup_punt_ft_pct").set_value(True)
    at.button(key="setup_submit").click()
    at.run()
    assert not at.exception, at.exception
    assert posts(api, "/draft/session") == [{"my_slot": 4, "punts": ["ft_pct"]}]
    assert any("ready: slot 4" in s.value for s in at.success)
    assert at.sidebar.selectbox(key="slot").value == 4
    assert at.sidebar.toggle(key="punt_ft_pct").value is True


def test_board_renders_recommendations_roster_tiers_and_drift(fake):
    fake()
    at = run_page()
    recs = at.dataframe[0].value
    assert list(recs["name"]) == [p["name"] for p in POOL]
    assert {"gain", "p_win_week", "p_available_at_decision", "p_available_next", "reasons"} <= set(recs)
    assert "Punt drift" in at.warning[0].value and "REB" in at.warning[0].value
    metrics = {m.label: m.value for m in at.metric}
    assert metrics["Current pick"] == "1 / 8"
    assert metrics["On the clock"] == "Slot 1"
    assert metrics["My next pick"] == "3"
    assert metrics["Pick clock"].endswith("s")
    assert any(c.value.startswith("Board timings: setup 5 ms") for c in at.caption)
    balance = at.dataframe[1].value
    assert list(balance["category"]) == [c["label"] for c in CATS]
    tiers = [m.value for m in at.markdown if m.value.startswith("**Tier")]
    assert tiers[0].startswith("**Tier 1** · 2 left: Synth Guard One (PG, AAA)")
    assert len(tiers) == 3


def test_pick_submission_posts_to_the_api(fake):
    api = fake()
    at = run_page()
    at.selectbox(key="pick_player").set_value(102)
    at.button(key="pick_submit").click()
    at.run()
    assert not at.exception, at.exception
    assert posts(api, "/draft/pick") == [{"player_id": 102, "source": "manual"}]
    assert any("Recorded Synth Center Two" in s.value for s in at.success)
    # the board was re-read after the pick: the drafted player is gone from the recommendations
    assert "Synth Center Two" not in list(at.dataframe[0].value["name"])


def test_pick_with_explicit_team_and_pick_number(fake):
    api = fake()
    at = run_page()
    at.selectbox(key="pick_player").set_value(101)
    at.selectbox(key="pick_team").set_value(1)
    at.number_input(key="pick_no").set_value(1)
    at.button(key="pick_submit").click()
    at.run()
    assert posts(api, "/draft/pick") == [{"player_id": 101, "source": "manual", "team_id": 1, "pick_no": 1}]


def test_undo_export_and_punt_toggle(fake):
    api = fake()
    api.picks.append({"pick_no": 1, "round": 1, "team_id": 1, "player_id": 101,
                      "player_name": "Synth Guard One", "is_keeper": False})
    at = run_page()
    at.button(key="undo").click()
    at.run()
    assert posts(api, "/draft/undo") == [None]
    assert api.picks == []
    at.button(key="export").click()
    at.run()
    assert any("draft_results.csv" in s.value for s in at.success)
    at.sidebar.toggle(key="punt_blk").set_value(True)
    at.run()
    assert posts(api, "/draft/punts") == [{"punts": ["blk"]}]


def test_slot_not_set_explains_itself(fake):
    fake(my_slot=None)
    at = run_page()
    assert any("set your draft slot first" in i.value for i in at.info)

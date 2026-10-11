"""This week's opponent from a screenshot, read on this Mac: names and team found, my players left
out, nothing kept. The text reader is stubbed except in the one Mac-only test. Invented names."""

from __future__ import annotations

import base64
import shutil
import sys
from datetime import UTC, datetime

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from research_room import api, free_agents, opponent_roster, screenshot, store
from research_room.config import settings

NOW = datetime(2026, 11, 4, 17, 0, tzinfo=UTC)
META = {"source": "test", "fetched_at": pd.Timestamp(NOW)}
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 100
TEXT = """Invented Rivals
Invented Guard  BOS - PG,SG
Made Up Center  MIA - C   INJ
Pretend Forward  MIA - SF,PF
My Own Guy  BOS - SG
"""


@pytest.fixture
def cfg(tmp_path, monkeypatch):
    c = settings()
    c = c.model_copy(update={"paths": c.paths.model_copy(update={"inbox_dir": tmp_path})})
    for name, file in (("_names_path", "league_teams.json"), ("_mine_path", "my_roster.json"),
                       ("_path", "opponent.json")):
        monkeypatch.setattr(opponent_roster, name, lambda cfg=None, f=file: tmp_path / f)
    monkeypatch.setattr(free_agents, "load_aliases", lambda: [])
    monkeypatch.setattr(screenshot, "read_text", lambda data: TEXT)
    return c


@pytest.fixture
def nba(con):
    store.upsert(con, "teams", pd.DataFrame(
        [{"team_id": t, "abbreviation": a, "full_name": a, **META} for t, a in ((1, "BOS"), (2, "MIA"))]))
    store.upsert(con, "players", pd.DataFrame([
        {"player_id": i, "full_name": n, "team_id": t, "position": p, **META}
        for i, n, t, p in ((1, "Invented Guard", 1, "G"), (2, "Made Up Center", 2, "C"),
                           (3, "Pretend Forward", 2, "F"), (4, "My Own Guy", 1, "G"))
    ]))
    return con


def test_the_team_and_players_are_read_and_my_players_left_out(nba, cfg):
    opp = 5 if settings().league.my_team_id != 5 else 6
    opponent_roster.set_team_names({opp: "Invented Rivals", 2: "Rivals"}, cfg)
    opponent_roster.save_mine(nba, [4], [], [], cfg, NOW)
    out = screenshot.opponent_from_screenshot(nba, PNG, cfg)
    assert out["team_id"] == opp and out["team_name"] == "Invented Rivals"   # the longer name wins
    assert [p["player_id"] for p in out["players"]] == [1, 2, 3] and out["skipped_mine"] == 1
    assert "never sent anywhere" in out["policy"]
    assert not (cfg.paths.inbox_dir / "opponent.json").exists()             # nothing saved yet


def test_bad_images_are_refused_plainly(cfg):
    with pytest.raises(screenshot.ScreenshotError):
        screenshot._suffix(b"not an image at all")
    with pytest.raises(screenshot.ScreenshotError):
        screenshot.decode("data:image/png;base64,***")
    assert screenshot.decode("data:image/png;base64," + base64.b64encode(PNG).decode()) == PNG


def test_the_route(tmp_path, cfg):
    db = tmp_path / "s.duckdb"
    c = store.connect(db)
    store.upsert(c, "players", pd.DataFrame(
        [{"player_id": 1, "full_name": "Invented Guard", "team_id": 1, "position": "G", **META}]))
    store.upsert(c, "teams", pd.DataFrame([{"team_id": 1, "abbreviation": "BOS", "full_name": "B", **META}]))
    c.close()
    client = TestClient(api.create_app(db_path=str(db), run_mock_thread=False))
    r = client.post("/season/opponent_roster/screenshot",
                    json={"image_base64": base64.b64encode(PNG).decode()})
    assert r.status_code == 200 and r.json()["players"][0]["name"] == "Invented Guard"
    bad = client.post("/season/opponent_roster/screenshot", json={"image_base64": "bm9wZQ=="})
    assert bad.status_code == 422


@pytest.mark.skipif(sys.platform != "darwin" or shutil.which("swiftc") is None, reason="needs macOS Vision")
def test_the_mac_reads_a_real_image(tmp_path):
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (700, 120), "white")
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 30)
    except OSError:
        pytest.skip("no system font")
    ImageDraw.Draw(img).text((20, 40), "Invented Guard  BOS - PG", fill="black", font=font)
    path = tmp_path / "r.png"
    img.save(path)
    assert "Invented Guard" in screenshot.read_text(path.read_bytes())

from __future__ import annotations

from datetime import UTC, date, datetime

import pandas as pd
from fastapi.testclient import TestClient

from research_room import api, images, store

SILHOUETTE = b"\x89PNG silhouette"


class FakeResp:
    def __init__(self, content: bytes, ctype: str, status: int = 200):
        self.content, self.status_code, self.headers = content, status, {"content-type": ctype}

    @property
    def ok(self):
        return self.status_code == 200


class FakeCDN:
    headers: dict = {}

    def __init__(self):
        self.urls = []

    def get(self, url, timeout=None):
        self.urls.append(url)
        if "/logos/" in url:
            return FakeResp(b'<svg viewBox="0 0 1 1"></svg>', "image/svg+xml")
        nba_id = url.rsplit("/", 1)[1].split(".")[0]
        if nba_id in ("1", "999"):                         # unknown ids -> generic silhouette
            return FakeResp(SILHOUETTE, "image/png")
        return FakeResp(b"\x89PNG face " + nba_id.encode(), "image/png")


def _seed(con):
    rows = [{"source": "bbm", "snapshot": date(2026, 10, 4), "ext_id": str(i), "player_id": pid,
             "nba_id": nba, "name": f"P{pid}", "games": 70.0, "fetched_at": datetime(2026, 10, 4, tzinfo=UTC)}
            for i, (pid, nba) in enumerate([(10, 203999), (11, 999), (12, None)])]
    store.upsert(con, "external_projections", pd.DataFrame(rows))


def test_fetch_all_saves_faces_skips_silhouettes_and_is_incremental(con, tmp_path):
    _seed(con)
    cdn = FakeCDN()
    counts = images.fetch_all(con, root=tmp_path, session=cdn, delay_s=0, echo=lambda _: None)
    assert counts["logos"] == 30 and counts["headshots"] == 1 and counts["silhouette"] == 1
    assert images.player_path(10, tmp_path).exists() and not images.player_path(11, tmp_path).exists()
    assert images.team_path("DEN", tmp_path).read_bytes().startswith(b"<svg")
    again = images.fetch_all(con, root=tmp_path, session=FakeCDN(), delay_s=0, echo=lambda _: None)
    assert again["headshots"] == 0 and again["skipped"] == 31     # 30 logos + 1 face already cached


def test_team_map_has_all_thirty_teams():
    ids = images.team_ids()
    assert len(ids) == 30 and len(set(ids.values())) == 30 and ids["DEN"] == 1610612743


def test_api_serves_cached_images_and_urls(tmp_path):
    (tmp_path / "players").mkdir()
    (tmp_path / "teams").mkdir()
    images.player_path(10, tmp_path).write_bytes(b"\x89PNG x")
    images.team_path("DEN", tmp_path).write_bytes(b"<svg/>")
    client = TestClient(api.create_app(db_path=str(tmp_path / "x.duckdb"), image_root=tmp_path))
    assert client.get("/images/players/10.png").headers["content-type"] == "image/png"
    assert client.get("/images/players/11.png").status_code == 404
    assert client.get("/images/teams/DEN.svg").headers["content-type"].startswith("image/svg+xml")
    assert client.get("/images/teams/D3N.svg").status_code == 400
    df = api.with_image_urls(pd.DataFrame({"player_id": [10, 11], "team_abbr": ["DEN", None]}), root=tmp_path)
    rec = api.records(df)                                         # what the JSON responses carry
    assert [r["headshot_url"] for r in rec] == ["/images/players/10.png", None]
    assert [r["team_logo_url"] for r in rec] == ["/images/teams/DEN.svg", None]

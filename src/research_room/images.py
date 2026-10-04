"""Local cache of player headshots and team logos for the front ends.

Inputs: external_projections.nba_id (from Basketball Monster's "NBA ID" column, the NBA person
id), config/nba_teams.yaml (BDL abbreviation -> NBA team id). Source: the NBA's public image CDN.
Outputs: data/images/players/<bdl player_id>.png, data/images/teams/<abbr>.svg,
data/images/manifest.json.
Tables: reads external_projections, players.

These images belong to the NBA and its teams. They are cached under data/ (gitignored) for
private, personal use only: never committed, never redistributed. The API serves them to the
local apps so the draft never depends on the CDN being reachable.

The CDN returns a generic silhouette (HTTP 200) for unknown ids; those are detected by
comparing against the silhouette's hash and not saved, so the UI shows initials instead.
"""

from __future__ import annotations

import hashlib
import json
import time
from collections.abc import Callable
from pathlib import Path

import duckdb
import requests
import yaml

from research_room import store
from research_room.config import CONFIG_DIR, REPO_ROOT

IMAGE_DIR = REPO_ROOT / "data" / "images"
HEADSHOT_URL = "https://cdn.nba.com/headshots/nba/latest/260x190/{nba_id}.png"
LOGO_URL = "https://cdn.nba.com/logos/nba/{team_id}/primary/L/logo.svg"
UNKNOWN_PLAYER_ID = 1                         # no NBA person has id 1: returns the silhouette
USER_AGENT = "nba-research-room/0.1 (personal, local use)"


def team_ids() -> dict[str, int]:
    raw = yaml.safe_load((CONFIG_DIR / "nba_teams.yaml").read_text())["teams"]
    return {k.upper(): int(v) for k, v in raw.items()}


def player_path(player_id: int, root: Path = IMAGE_DIR) -> Path:
    return root / "players" / f"{int(player_id)}.png"


def team_path(abbr: str, root: Path = IMAGE_DIR) -> Path:
    return root / "teams" / f"{abbr.upper()}.svg"


def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def fetch_all(con: duckdb.DuckDBPyConnection, root: Path = IMAGE_DIR, refresh: bool = False,
              session: requests.Session | None = None, delay_s: float = 0.1,
              echo: Callable[[str], None] = print) -> dict[str, int]:
    """Download missing headshots (players in the latest projections) and all team logos."""
    s = session or requests.Session()
    s.headers.update({"User-Agent": USER_AGENT})
    (root / "players").mkdir(parents=True, exist_ok=True)
    (root / "teams").mkdir(parents=True, exist_ok=True)
    counts = {"logos": 0, "headshots": 0, "silhouette": 0, "skipped": 0, "failed": 0}

    for abbr, tid in team_ids().items():
        path = team_path(abbr, root)
        if path.exists() and not refresh:
            counts["skipped"] += 1
            continue
        r = s.get(LOGO_URL.format(team_id=tid), timeout=20)
        if r.ok and r.content.lstrip().startswith((b"<?xml", b"<svg")):
            path.write_bytes(r.content)
            counts["logos"] += 1
        else:
            counts["failed"] += 1
        time.sleep(delay_s)

    silhouette = _sha(s.get(HEADSHOT_URL.format(nba_id=UNKNOWN_PLAYER_ID), timeout=20).content)
    rows = con.execute("""
        SELECT DISTINCT player_id, nba_id FROM external_projections
        WHERE source = 'bbm' AND player_id IS NOT NULL AND nba_id IS NOT NULL
          AND snapshot = (SELECT max(snapshot) FROM external_projections WHERE source = 'bbm')
    """).fetchall()
    for i, (player_id, nba_id) in enumerate(rows, 1):
        path = player_path(player_id, root)
        if path.exists() and not refresh:
            counts["skipped"] += 1
            continue
        try:
            r = s.get(HEADSHOT_URL.format(nba_id=int(nba_id)), timeout=20)
        except requests.RequestException:
            counts["failed"] += 1
            continue
        if not r.ok or r.headers.get("content-type", "").split(";")[0] != "image/png":
            counts["failed"] += 1
        elif _sha(r.content) == silhouette:
            counts["silhouette"] += 1
        else:
            path.write_bytes(r.content)
            counts["headshots"] += 1
        if i % 100 == 0:
            echo(f"  headshots: {i}/{len(rows)}")
        time.sleep(delay_s)

    manifest = {"fetched_at": store.utcnow().isoformat(), "counts": counts,
                "players": sorted(int(p.stem) for p in (root / "players").glob("*.png")),
                "teams": sorted(p.stem for p in (root / "teams").glob("*.svg"))}
    (root / "manifest.json").write_text(json.dumps(manifest))
    return counts

"""This week's opponent from a screenshot of his Yahoo roster, read on this Mac.

Inputs: an image (PNG/JPEG/HEIC) the owner drops or pastes on Teams → This week's opponent; the NBA
players (BallDontLie) and config/aliases.yaml, through free_agents.find_players; the registered
league team names (opponent_roster.team_names); my roster entry.
Outputs: a draft of the opponent entry for the owner to check and save (team, players). Nothing is
saved here: the screen saves it the usual way (opponent_roster.save, one opponent at a time).
Tables: none.

Read locally: Apple's Vision framework does the text recognition (scripts/ocr.swift, built on first
use into data/bin/ocr). No image, text or name leaves the Mac or reaches an AI service, and the
image and its text are deleted as soon as they are read (the Yahoo data policy, ingest/yahoo_live.py).
"""

from __future__ import annotations

import base64
import binascii
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import duckdb

from research_room.config import REPO_ROOT, Settings, settings

SOURCE = REPO_ROOT / "scripts" / "ocr.swift"
BINARY = REPO_ROOT / "data" / "bin" / "ocr"
MAX_BYTES = 12_000_000        # a full-screen Retina screenshot is ~3-8 MB
READ_TIMEOUT_S = 120          # Vision loads its models on the very first read (about a minute)
POLICY = (
    "Read on this Mac by its own text recognition: the screenshot and its text are deleted once "
    "read and never sent anywhere. Check the players, then Save."
)
_SIGNATURES = {b"\x89PNG": ".png", b"\xff\xd8\xff": ".jpg", b"GIF8": ".gif"}


class ScreenshotError(ValueError):
    """The image couldn't be read (shown to the owner as is)."""


def _suffix(data: bytes) -> str:
    for sig, ext in _SIGNATURES.items():
        if data.startswith(sig):
            return ext
    if data[4:12] in (b"ftypheic", b"ftypheix", b"ftypmif1", b"ftypmsf1"):
        return ".heic"
    raise ScreenshotError("that file isn't an image (PNG, JPEG or HEIC)")


def ensure_built() -> Path:
    """The OCR helper, compiled from scripts/ocr.swift when missing or older than its source."""
    if BINARY.exists() and BINARY.stat().st_mtime >= SOURCE.stat().st_mtime:
        return BINARY
    if sys.platform != "darwin" or shutil.which("swiftc") is None:
        raise ScreenshotError("reading screenshots needs a Mac with Xcode's command-line tools")
    BINARY.parent.mkdir(parents=True, exist_ok=True)
    out = subprocess.run(["swiftc", "-O", str(SOURCE), "-o", str(BINARY)],
                         capture_output=True, text=True, timeout=300)
    if out.returncode != 0:
        raise ScreenshotError(f"couldn't build the text reader: {out.stderr.strip()[:200]}")
    return BINARY


def read_text(data: bytes) -> str:
    """The text in the image, line by line (top to bottom). The image file is deleted at once."""
    if not data:
        raise ScreenshotError("the image is empty")
    if len(data) > MAX_BYTES:
        raise ScreenshotError(f"that image is too large (over {MAX_BYTES // 1_000_000} MB)")
    binary = ensure_built()
    fd, path = tempfile.mkstemp(suffix=_suffix(data))
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        out = subprocess.run([str(binary), path], capture_output=True, text=True, timeout=READ_TIMEOUT_S)
    except subprocess.TimeoutExpired as exc:
        raise ScreenshotError("reading the image took too long; try again") from exc
    finally:
        Path(path).unlink(missing_ok=True)
    if out.returncode != 0:
        raise ScreenshotError(out.stderr.strip()[:200] or "couldn't read the image")
    return out.stdout


def decode(image_base64: str) -> bytes:
    """The image from the page (a data: URL or plain base64)."""
    raw = image_base64.split(",", 1)[1] if image_base64.startswith("data:") else image_base64
    try:
        data = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ScreenshotError("that image didn't arrive intact; try again") from exc
    _suffix(data)                                   # an image, or a plain refusal now
    return data


def _guess_team(text: str, cfg: Settings) -> tuple[int | None, str | None]:
    """The registered team whose name appears in the text (the longest, if several)."""
    from research_room.free_agents import _tokens
    from research_room.opponent_roster import team_names

    words = " " + " ".join(_tokens(text)) + " "
    best: tuple[int, int | None, str | None] = (0, None, None)
    for team_id, name in team_names(cfg).items():
        key = " ".join(_tokens(name))
        if key and f" {key} " in words and len(key) > best[0]:
            best = (len(key), team_id, name)
    return best[1], best[2]


def opponent_from_screenshot(
    con: duckdb.DuckDBPyConnection, data: bytes, cfg: Settings | None = None
) -> dict:
    """A draft of this week's opponent from a screenshot: the team (when a registered name is in
    it) and the NBA players found, minus my own (a matchup page shows both rosters)."""
    from research_room.free_agents import find_players
    from research_room.opponent_roster import _cards, read_mine

    cfg = cfg or settings()
    text = read_text(data)
    ids, ambiguous = find_players(con, text)
    mine = set((read_mine(cfg) or {}).get("player_ids", []))
    mine |= {r[0] for r in con.execute(
        "SELECT player_id FROM yahoo_rosters WHERE team_id = ? AND player_id IS NOT NULL",
        [cfg.league.my_team_id]).fetchall()}
    theirs = [i for i in ids if i not in mine]
    team_id, team_name = _guess_team(text, cfg)
    most = len(cfg.roster.slots)
    return {
        "team_id": team_id,
        "team_name": team_name,
        "players": [{**c, "owner": "opponent"} for c in _cards(con, theirs[:most])],
        "skipped_mine": len(ids) - len(theirs),
        "too_many": len(theirs) > most,
        "ambiguous": ambiguous,
        "policy": POLICY,
    }

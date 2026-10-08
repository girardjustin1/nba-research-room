"""One-time Yahoo sign-in for the read-only Fantasy API (run in your own terminal).

Usage: make yahoo-auth

Opens Yahoo's consent page in the browser. Approve, copy the code Yahoo shows, paste it here.
The tokens are saved into oauth2.json (gitignored) and refreshed automatically after that. Nothing
is printed but a connection check. If your Yahoo app was registered with a redirect URI other than
"oob", set YAHOO_REDIRECT_URI to it in .env first.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def env_value(name: str) -> str | None:
    """One setting from .env (only the Yahoo ones are read; nothing is exported)."""
    if os.environ.get(name):
        return os.environ[name]
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith(f"{name}="):
                return line.split("=", 1)[1].strip().strip('"') or None
    return None


def exchange(path: Path, code: str, redirect: str) -> None:
    """Swap the one-time code Yahoo shows for tokens, saved into oauth2.json (yahoo_oauth's format)."""
    import json
    import time

    import requests

    d = json.loads(path.read_text())
    r = requests.post(
        "https://api.login.yahoo.com/oauth2/get_token",
        auth=(d["consumer_key"], d["consumer_secret"]),
        data={"grant_type": "authorization_code", "code": code.strip(), "redirect_uri": redirect},
        timeout=30,
    )
    if r.status_code != 200:
        raise SystemExit(
            f"Yahoo refused the code (HTTP {r.status_code}): it may have expired; get a new one."
        )
    tok = r.json()
    d.update(
        {
            "access_token": tok["access_token"],
            "refresh_token": tok["refresh_token"],
            "token_type": tok.get("token_type", "bearer"),
            "token_time": time.time(),
            "guid": tok.get("xoauth_yahoo_guid"),
        }
    )
    path.write_text(json.dumps(d, indent=2))
    os.chmod(path, 0o600)


def main() -> int:
    from yahoo_oauth import OAuth2

    path = ROOT / "oauth2.json"
    if not path.exists():
        print("oauth2.json not found: it needs your app's consumer_key and consumer_secret.")
        return 1
    if "--code" in sys.argv:  # a code copied from Yahoo's page (no prompt)
        exchange(path, sys.argv[sys.argv.index("--code") + 1], env_value("YAHOO_REDIRECT_URI") or "oob")
    redirect = env_value("YAHOO_REDIRECT_URI")
    extra = {"callback_uri": redirect} if redirect else {}
    sc = OAuth2(None, None, from_file=str(path), **extra)
    if not sc.token_is_valid():
        sc.refresh_access_token()
    import yahoo_fantasy_api as yfa

    game = yfa.Game(sc, "nba")
    league_id = env_value("YAHOO_LEAGUE_ID") or "79805"
    keys = [k for k in game.league_ids() if k.endswith(f".l.{league_id}")]
    if not keys:
        print(f"Signed in, but league {league_id} isn't among this account's NBA leagues this season.")
        return 1
    lg = game.to_league(keys[-1])
    s = lg.settings()
    teams, status = s.get("num_teams"), s.get("draft_status")
    print(f"Signed in. League {league_id}: {teams} teams, draft status: {status}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

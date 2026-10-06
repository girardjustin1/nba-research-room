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


def main() -> int:
    from yahoo_oauth import OAuth2

    path = ROOT / "oauth2.json"
    if not path.exists():
        print("oauth2.json not found: it needs your app's consumer_key and consumer_secret.")
        return 1
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

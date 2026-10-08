"""Save your Yahoo app's Client ID and Client Secret into oauth2.json (run in your own terminal).

Usage: make yahoo-keys

Asks for both without showing what you type, writes oauth2.json (gitignored, readable only by
you) and clears any old sign-in tokens, since they belong to the previous keys. Then run
`make yahoo-auth`. Nothing is printed back.
"""

from __future__ import annotations

import json
import os
import sys
from getpass import getpass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    cid = getpass("Yahoo Client ID (consumer key): ").strip()
    secret = getpass("Yahoo Client Secret (consumer secret): ").strip()
    if not cid or not secret:
        print("Both are needed; nothing was saved.")
        return 1
    path = ROOT / "oauth2.json"
    path.write_text(json.dumps({"consumer_key": cid, "consumer_secret": secret}, indent=2))
    os.chmod(path, 0o600)
    print("Saved to oauth2.json (gitignored). Next: make yahoo-auth")
    return 0


if __name__ == "__main__":
    sys.exit(main())

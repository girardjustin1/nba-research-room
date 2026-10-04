"""Run the local draft API on 127.0.0.1:8765 (localhost only).

Inputs/outputs: see research_room.api. Usage: `make draft-api`.
"""

from __future__ import annotations

import uvicorn

from research_room.api import create_app

HOST, PORT = "127.0.0.1", 8765

app = create_app()

if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")

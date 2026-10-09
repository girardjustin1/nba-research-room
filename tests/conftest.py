"""Shared fixtures: an in-memory store with the full schema, and a stand-in for Yahoo.

Yahoo Fantasy information is never stored; every connection reads it live (ingest/yahoo_live).
Tests never touch Yahoo: the live read is replaced by what the test itself put in the in-memory
Yahoo tables (store.LIVE_ONLY), replayed into each new connection, as Yahoo would return it.
"""

from __future__ import annotations

import pandas as pd
import pytest

from research_room import store
from research_room.ingest import yahoo_api, yahoo_live

REAL_ATTACH = yahoo_live.attach   # for the tests of the live read itself (never the real API)


@pytest.fixture
def con():
    c = store.connect(":memory:")
    yield c
    c.close()


@pytest.fixture(autouse=True)
def opponent_static(monkeypatch):
    """Tests don't follow the owner's live choice: the opponent's roster is fixed unless a test
    turns streaming on itself (settings.opponent.streaming is a production setting)."""
    from research_room.config import settings

    monkeypatch.setattr(settings().opponent, "streaming", False)


@pytest.fixture(autouse=True)
def fake_yahoo(monkeypatch):
    """What "Yahoo" returns in this test: every frame the test wrote to a Yahoo table."""
    yahoo_live.reset()   # no Yahoo status or pause carried over from another test
    seeded: list[tuple[str, pd.DataFrame]] = []
    real_upsert = store.upsert

    def upsert(c, table, df):
        if table in store.LIVE_ONLY and not getattr(upsert, "replaying", False):
            seeded.append((table, df.copy()))
        return real_upsert(c, table, df)

    def attach(c, cfg=None, parts=None, show_names=False, time_limit=None):
        upsert.replaying = True
        try:
            for table, df in seeded:
                real_upsert(c, table, df)
        finally:
            upsert.replaying = False
        return {"source": "test", "loaded": {t: len(d) for t, d in seeded}, "unresolved": 0}

    monkeypatch.setattr(store, "upsert", upsert)
    monkeypatch.setattr(yahoo_live, "attach", attach)
    monkeypatch.setattr(yahoo_api, "signed_in", lambda *a, **k: False)   # never the real API
    return seeded

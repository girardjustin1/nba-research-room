"""Shared fixtures: an in-memory store with the full schema."""

from __future__ import annotations

import pytest

from research_room import store


@pytest.fixture
def con():
    c = store.connect(":memory:")
    yield c
    c.close()

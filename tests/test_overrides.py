from __future__ import annotations

from datetime import UTC, date, datetime

import pandas as pd
import pytest

from research_room import overrides, store
from research_room.config import settings

SNAP = datetime(2026, 10, 19, 16, 0, tzinfo=UTC)       # noon ET, Oct 19


def injuries(con, rows, fetched_at=SNAP):
    rows = [{**r, "source": "bdl", "fetched_at": fetched_at} for r in rows]
    store.upsert(con, "injuries", pd.DataFrame(rows))


def players(con):
    rows = [{"player_id": i, "full_name": n, "source": "t", "fetched_at": SNAP}
            for i, n in [(1, "Alpha One"), (2, "Beta Two"), (3, "Gamma Three")]]
    store.upsert(con, "players", pd.DataFrame(rows))


def event(eid, pid, status, cap, account, rank, hour):
    return {"event_id": eid, "player_id": pid, "status": status, "minutes_cap": cap, "account": account,
            "authority_rank": rank, "ts": datetime(2026, 10, 21, hour, 0, tzinfo=UTC), "source": "x",
            "fetched_at": SNAP}


def by(df):
    return {(r.player_id, r.date): r for r in df.itertuples()}


def test_return_date_window_and_no_date_horizon(con, tmp_path):
    players(con)
    injuries(con, [{"player_id": 1, "status": "Out", "return_date": "2026-10-23", "description": "knee"},
                   {"player_id": 2, "status": "Questionable", "return_date": None, "description": "ankle"},
                   {"player_id": 3, "status": "Out For Season", "return_date": None, "description": "ACL"}])
    empty = tmp_path / "o.yaml"
    empty.write_text("overrides: []\n")
    ov = by(overrides.resolve(con, date(2026, 10, 19), date(2026, 10, 25), as_of=SNAP, manual_path=empty))
    assert ov[(1, date(2026, 10, 22))].play_prob == 0.0
    assert (1, date(2026, 10, 23)) not in ov                       # back on his return date
    assert ov[(2, date(2026, 10, 19))].play_prob == settings().overrides.status_play_prob["Questionable"]
    assert (2, date(2026, 10, 20)) not in ov                       # questionable lasts 1 day w/o a date
    assert ov[(3, date(2026, 10, 25))].play_prob == 0.0            # out for season covers everything


def test_manual_beats_x_beats_bdl_and_recency_breaks_ties(con, tmp_path):
    players(con)
    injuries(con, [{"player_id": 1, "status": "Out", "return_date": "2026-10-30", "description": ""}])
    store.upsert(con, "status_events", pd.DataFrame([
        event("a", 1, "Probable", 24.0, "nuggets", 1, 20),
        event("b", 2, "Questionable", None, "beat", 3, 18),
        event("c", 2, "Out", None, "beat2", 3, 22),
    ]))
    manual = tmp_path / "o.yaml"
    manual.write_text("overrides:\n  - {player: Alpha One, status: Out, from: 2026-10-24, until: 2026-10-24, "
                      "note: rest}\n")
    as_of = datetime(2026, 10, 23, tzinfo=UTC)
    ov = by(overrides.resolve(con, date(2026, 10, 20), date(2026, 10, 25), as_of=as_of, manual_path=manual))
    official = ov[(1, date(2026, 10, 21))]
    probable = settings().overrides.status_play_prob["Probable"]
    assert (official.authority, official.play_prob, official.minutes_cap) == ("official", probable, 24.0)
    assert (1, date(2026, 10, 22)) not in ov       # the team's newer "probable" ends BallDontLie's older out
    assert ov[(1, date(2026, 10, 24))].authority == "manual"
    assert ov[(2, date(2026, 10, 21))].status == "Out"              # later report from the same tier wins


def test_as_of_reads_only_what_was_known(con, tmp_path):
    players(con)
    injuries(con, [{"player_id": 1, "status": "Questionable", "return_date": None, "description": ""}])
    injuries(con, [{"player_id": 1, "status": "Out", "return_date": "2026-10-28", "description": ""}],
             fetched_at=datetime(2026, 10, 20, 16, 0, tzinfo=UTC))
    empty = tmp_path / "o.yaml"
    empty.write_text("overrides: []\n")
    before = by(overrides.resolve(con, date(2026, 10, 19), date(2026, 10, 19), as_of=SNAP, manual_path=empty))
    assert before[(1, date(2026, 10, 19))].status == "Questionable"
    after = by(overrides.resolve(con, date(2026, 10, 20), date(2026, 10, 21),
                                 as_of=datetime(2026, 10, 21, tzinfo=UTC), manual_path=empty))
    assert after[(1, date(2026, 10, 21))].status == "Out"


def test_ambiguous_manual_name_is_an_error(con, tmp_path):
    store.upsert(con, "players", pd.DataFrame([{"player_id": i, "full_name": "Same Name", "source": "t",
                                                "fetched_at": SNAP} for i in (1, 2)]))
    bad = tmp_path / "o.yaml"
    bad.write_text("overrides:\n  - {player: Same Name, status: Out}\n")
    with pytest.raises(ValueError, match="add player_id"):
        overrides.resolve(con, date(2026, 10, 20), date(2026, 10, 21), manual_path=bad, cfg=settings())


def test_injury_news_time_is_when_the_status_first_appeared(con):
    """Every snapshot re-lists a player; the news time is the start of his current status run."""
    from datetime import timedelta
    players(con)
    t = [SNAP - timedelta(hours=h) for h in (8, 6, 4, 2, 0)]
    for when, status in zip(t, ["Questionable", "Questionable", "Out", "Questionable", "Questionable"],
                            strict=True):
        injuries(con, [{"player_id": 1, "status": status, "return_date": None, "description": "x"},
                       {"player_id": 2, "status": "Out", "return_date": None, "description": "y"}], when)
    rows = overrides.from_injuries(con, date(2026, 10, 19), date(2026, 10, 19), SNAP, settings())
    ts = {r.player_id: pd.Timestamp(r.ts) for r in rows.itertuples()}
    assert ts[1] == pd.Timestamp(t[3])          # Questionable again since the 4th snapshot
    assert ts[2] == pd.Timestamp(t[0])          # Out in every snapshot: since the first


def _xevent(eid, pid, status, lo, hi, day, hour=20, rank=2):
    return {"event_id": eid, "player_id": pid, "status": status, "minutes_cap": None,
            "account": "insider", "authority_rank": rank,
            "ts": datetime(2026, 10, day, hour, 0, tzinfo=UTC), "source": "x",
            "fetched_at": SNAP, "out_days_min": lo, "out_days_max": hi}


def test_a_stated_absence_carries_then_ramps_back(con, tmp_path):
    players(con)
    empty = tmp_path / "o.yaml"
    empty.write_text("overrides: []\n")
    store.upsert(con, "status_events", pd.DataFrame([_xevent("e1", 1, "Out", 14, 21, 20)]))
    ov = by(overrides.resolve(con, date(2026, 10, 20), date(2026, 11, 20),
                              as_of=datetime(2026, 10, 21, tzinfo=UTC), manual_path=empty))
    assert ov[(1, date(2026, 10, 20))].play_prob == 0.0 and not ov[(1, date(2026, 10, 20))].carried
    assert ov[(1, date(2026, 11, 2))].play_prob == 0.0 and ov[(1, date(2026, 11, 2))].carried   # day 13
    ramp = [ov[(1, date(2026, 11, 3) + pd.Timedelta(days=k).to_pytimedelta())].play_prob for k in range(8)]
    assert ramp == sorted(ramp) and 0 < ramp[0] < ramp[-1] < 1                                  # days 14-21
    assert (1, date(2026, 11, 11)) not in ov                                    # back to the model
    assert ov[(1, date(2026, 10, 25))].note == "out 14-21 days"


def test_newer_news_beats_and_ends_a_carried_absence(con, tmp_path):
    players(con)
    empty = tmp_path / "o.yaml"
    empty.write_text("overrides: []\n")
    store.upsert(con, "status_events", pd.DataFrame([
        _xevent("e1", 1, "Out", 14, 21, 20),
        _xevent("e2", 1, "Probable", None, None, 25, rank=3),        # a beat writer, five days later
    ]))
    injuries(con, [{"player_id": 1, "status": "Day-To-Day", "return_date": None, "description": "x"}],
             fetched_at=datetime(2026, 10, 22, 16, 0, tzinfo=UTC))
    ov = by(overrides.resolve(con, date(2026, 10, 22), date(2026, 10, 26),
                              as_of=datetime(2026, 10, 26, tzinfo=UTC), manual_path=empty))
    assert ov[(1, date(2026, 10, 22))].status == "Out"           # carried insider beats BallDontLie
    assert ov[(1, date(2026, 10, 25))].status == "Probable"      # same-day post beats the forecast
    assert (1, date(2026, 10, 26)) not in ov                     # newer good news ends the forecast

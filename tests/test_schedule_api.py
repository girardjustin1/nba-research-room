from __future__ import annotations

from datetime import UTC, date, datetime

import pandas as pd
from fastapi.testclient import TestClient

from research_room import api, store

NOW = datetime(2026, 10, 4, tzinfo=UTC)


def test_schedule_endpoints(tmp_path):
    db = tmp_path / "s.duckdb"
    con = store.connect(db)
    teams = [{"team_id": t, "abbreviation": a, "source": "t", "fetched_at": NOW}
             for t, a in [(1, "DEN"), (2, "BOS"), (3, "MIA")]]
    store.upsert(con, "teams", pd.DataFrame(teams))
    rows = [(date(2026, 11, 3), 1, 2), (date(2026, 11, 4), 3, 1),        # DEN back-to-back in week 2
            (date(2027, 3, 16), 1, 2), (date(2027, 3, 18), 2, 3)]         # playoff week 20
    store.upsert(con, "games", pd.DataFrame([{
        "game_id": i, "season": 2026, "game_date": d, "home_team_id": h, "visitor_team_id": v,
        "postseason": False, "postponed": False, "status_state": "scheduled", "source": "t",
        "fetched_at": NOW} for i, (d, h, v) in enumerate(rows)]))
    con.close()
    client = TestClient(api.create_app(db_path=str(db), run_mock_thread=False))

    tw = client.get("/schedule/team_weeks").json()
    assert len(tw["weeks"]) == 22 and tw["weeks"][19]["is_playoff"]
    den = next(t for t in tw["teams"] if t["team"] == "DEN")
    assert den["games_by_week"]["2"] == 2 and den["b2b_by_week"]["2"] == 2
    assert den["total"] == 3 and den["playoff_games"] == 1

    days = client.get("/schedule/team_days", params={"team": "den"}).json()["days"]
    assert [d["opponent"] for d in days] == ["BOS", "MIA", "BOS"]
    assert days[0]["home"] and not days[1]["home"] and days[0]["back_to_back"] and days[0]["week"] == 2
    ranged = client.get("/schedule/team_days", params={"team": "DEN", "start": "2027-03-01"}).json()
    assert [d["date"] for d in ranged["days"]] == ["2027-03-16"]
    assert client.get("/schedule/team_days", params={"team": "XYZ"}).status_code == 404

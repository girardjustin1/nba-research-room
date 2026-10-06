"""Compare the league's settings in Yahoo with config/settings.yaml (read only).

Usage: make yahoo-check   (needs `make yahoo-auth` once)

Prints each fact (teams, draft rounds, keepers, roster slots, categories, weekly acquisitions,
draft order, your draft slot, fantasy week dates) as match, differs, new (Yahoo has it, the
settings don't yet) or unknown, with the settings.yaml change for anything not matching. Nothing
is edited and nothing is done inside Yahoo.
"""

from __future__ import annotations

import sys

from research_room.config import settings
from research_room.ingest import yahoo_api

HINT = {
    "draft rounds": "draft.rounds: {y}   (and draft.confirmed.rounds: true)",
    "keepers": "draft.keepers: [...] if any, then draft.confirmed.keepers: true",
    "draft order": "draft.order: {y}",
    "my draft slot": "draft.my_slot: {y}",
    "weekly acquisitions": "transactions.max_acquisitions_per_week: {y}",
    "roster slots": "roster.slots: {y}",
    "teams": "league.teams: {y}",
}


def main() -> int:
    cfg = settings()
    if not yahoo_api.signed_in():
        print("Not signed in to Yahoo yet: run `make yahoo-auth` in your terminal first.")
        return 1
    league, _ = yahoo_api.connect(cfg)
    rows = yahoo_api.compare(yahoo_api.league_facts(league, cfg), cfg)
    for r in rows:
        y = r["yahoo"]
        shown = f"{len(y)} weeks" if r["fact"] == "week dates" and y else y
        print(f"{r['status']:>8}  {r['fact']:<20} yahoo: {shown}")
        if r["status"] in ("differs", "new") and r["fact"] in HINT:
            print(f"          -> settings.yaml: {HINT[r['fact']].format(y=y)}")
        if r["fact"] == "week dates" and r["status"] == "differs" and y:
            ours = {w["week"]: w for w in r["ours"]}
            for w in y:
                o = ours.get(w["week"])
                if not o or (o["start"], o["end"]) != (w["start"], w["end"]):
                    print(
                        f"          week {w['week']}: yahoo {w['start']}..{w['end']}, ours "
                        f"{(o['start'], o['end']) if o else 'missing'}"
                    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

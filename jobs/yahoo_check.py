"""Compare the league's settings in Yahoo with config/settings.yaml (read only).

Usage: make yahoo-check   (needs `make yahoo-auth` once)

Prints each fact (teams, draft rounds, keepers, roster slots, categories and their Yahoo stat ids,
weekly acquisitions, draft order, your draft slot, fantasy week dates) as match, differs, new (Yahoo
has it, the settings don't yet) or unknown, with the settings.yaml change for anything not matching.
Then a speed check: one page's read and one nightly run's read, timed against settings.yahoo's
limits (counts and seconds only; nothing from Yahoo is printed by name or kept). Nothing is edited
and nothing is done inside Yahoo.
"""

from __future__ import annotations

import sys
import time

from research_room import store
from research_room.config import settings
from research_room.ingest import yahoo_api, yahoo_live

HINT = {
    "draft rounds": "draft.rounds: {y}   (and draft.confirmed.rounds: true)",
    "keepers": "draft.keepers: [...] if any, then draft.confirmed.keepers: true",
    "draft order": "draft.order: {y}",
    "my draft slot": "draft.my_slot: {y}",
    "weekly acquisitions": "transactions.max_acquisitions_per_week: {y}",
    "roster slots": "roster.slots: {y}",
    "teams": "league.teams: {y}",
    "category stat ids": "categories: yahoo_stat_id for each, as Yahoo has them: {y}",
}


def main() -> int:
    cfg = settings()
    if not yahoo_api.signed_in():
        print("Not signed in to Yahoo yet: run `make yahoo-auth` in your terminal first.")
        return 1
    try:
        league, _ = yahoo_api.connect(cfg)
        rows = yahoo_api.compare(yahoo_api.league_facts(league, cfg), cfg)
    except Exception as exc:  # noqa: BLE001 - say what kind of failure, not a traceback
        kind = yahoo_api.problem(exc)
        print(f"Yahoo couldn't be read ({kind}). {yahoo_live.MESSAGES[kind]}")
        if kind == "no_access":
            print("Your sign-in works; Yahoo hasn't given this app access to the league yet.")
        return 1
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
    return speed_check(cfg)


def speed_check(cfg) -> int:
    """Time a page's read and a nightly run's read (live, in memory, then gone)."""
    print("\nSpeed (read live into memory, nothing kept):")
    yahoo_live.reset()
    worst = 0
    for label, parts, limit in (
        ("a page", yahoo_live.PAGE, cfg.yahoo.page_time_limit_s),
        ("a nightly run", yahoo_live.ALL, cfg.yahoo.job_time_limit_s),
    ):
        con = store.connect(read_only=True)
        try:
            started = time.monotonic()
            out = yahoo_live.attach(con, cfg, parts, time_limit=limit)
            took = time.monotonic() - started
        finally:
            con.close()
        y = out.get("yahoo") or {}
        ok = y.get("state") == "live"
        worst = max(worst, 0 if ok else 1)
        print(f"{'ok' if ok else y.get('state', '?'):>8}  {label:<14} {took:5.1f} s of {limit:g} s   "
              f"rows: {out.get('loaded')}")
        if not ok:
            print(f"          {y.get('message')}")
    return worst


if __name__ == "__main__":
    sys.exit(main())

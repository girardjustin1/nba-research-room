"""Draft-night readiness check: prints every check with the action that fixes it.

Inputs/outputs: see research_room.readiness. Read-only. Usage:
  make doctor              exit code 1 when any check is an error, else 0
"""

from __future__ import annotations

import sys

from research_room import readiness, store

MARK = {"ok": "ok  ", "warn": "WARN", "error": "FAIL"}


def main() -> int:
    con = store.connect(read_only=True)
    try:
        report = readiness.readiness(con)
    finally:
        con.close()
    print(f"Draft starts {report['draft_starts_at']} ({report['hours_to_draft']:.0f} h from now)\n")
    width = max(len(c["label"]) for c in report["checks"])
    for c in report["checks"]:
        print(f"  {MARK[c['status']]}  {c['label']:<{width}}  {c['detail']}")
        if c["action"]:
            print(f"        {'':<{width}}  -> {c['action']}")
    print(f"\noverall: {report['overall']}")
    return 1 if report["overall"] == "error" else 0


if __name__ == "__main__":
    sys.exit(main())

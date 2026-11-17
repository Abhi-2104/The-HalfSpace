#!/usr/bin/env python3
"""CLI: bulk-ingest every match in a StatsBomb open-data competition/season.

Usage: python3 scripts/ingest_competition.py <competition_id> <season_id> [--360]

  --360   also pull 360 freeze-frames (only some competitions have them, see
          match_available_360 in data/raw/competitions.json).

Idempotent: matches already ingested are skipped. For many competitions or
keeping everything up to date, use scripts/refresh_data.py instead.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from halfspace import db
from halfspace.ingest import statsbomb


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 2:
        print(__doc__)
        sys.exit(1)
    ok, failed, done = statsbomb.ingest_competition(db.connect(), int(args[0]), int(args[1]), "--360" in sys.argv)
    print(f"done: {ok} newly processed, {done} already done, {len(failed)} failed")
    for mid, err in failed:
        print(f"  FAILED {mid}: {err}")


if __name__ == "__main__":
    main()

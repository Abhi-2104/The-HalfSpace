#!/usr/bin/env python3
"""CLI: ingest one StatsBomb open-data match by id.

Usage: python3 scripts/ingest_match.py <match_id> <competition_id> <season_id>
Example (WC2022 final): python3 scripts/ingest_match.py 3869685 43 106
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from halfspace import db
from halfspace.ingest import statsbomb


def main():
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(1)
    match_id, competition_id, season_id = (int(x) for x in sys.argv[1:4])
    conn = db.connect()
    statsbomb.ingest_match(conn, match_id, competition_id=competition_id, season_id=season_id)
    print(f"ingested match {match_id}")


if __name__ == "__main__":
    main()

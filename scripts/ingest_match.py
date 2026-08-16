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

    match_list = statsbomb.fetch_match_list(competition_id, season_id)
    meta = None
    for m in match_list:
        if m["match_id"] == match_id:
            meta = {
                "home_team_id": m["home_team"]["home_team_id"], "away_team_id": m["away_team"]["away_team_id"],
                "home_score": m.get("home_score"), "away_score": m.get("away_score"), "match_date": m.get("match_date"),
            }
            break

    statsbomb.ingest_match(conn, match_id, competition_id=competition_id, season_id=season_id, match_meta=meta)
    print(f"ingested match {match_id}")


if __name__ == "__main__":
    main()

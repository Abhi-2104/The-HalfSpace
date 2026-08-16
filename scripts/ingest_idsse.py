#!/usr/bin/env python3
"""CLI: ingest all 7 IDSSE matches (real Bundesliga 2022/23 optical tracking + events).
Each match's positions file is ~350-420MB - this downloads ~2.5GB total on first run.
Idempotent: skips match keys already in tracking_team_match."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from halfspace import db
from halfspace.ingest import idsse

MATCH_KEYS = [
    "DFL-COM-000001_DFL-MAT-J03WMX",
    "DFL-COM-000001_DFL-MAT-J03WN1",
    "DFL-COM-000002_DFL-MAT-J03WOH",
    "DFL-COM-000002_DFL-MAT-J03WOY",
    "DFL-COM-000002_DFL-MAT-J03WPY",
    "DFL-COM-000002_DFL-MAT-J03WQQ",
    "DFL-COM-000002_DFL-MAT-J03WR9",
]


def main():
    conn = db.connect()
    for key in MATCH_KEYS:
        match_id = "DFL-MAT-" + key.split("_DFL-MAT-")[1]
        done = conn.execute(
            "SELECT 1 FROM tracking_team_match WHERE provider='idsse_open_data' AND provider_match_id=?",
            (match_id,),
        ).fetchone()
        if done:
            print(f"  {key}: already ingested, skipping")
            continue
        try:
            results = idsse.ingest_match(conn, key)
            for r in results:
                print(f"  {key}: {r['team_name']:20s} width={r['width_std_y']:.2f} length={r['length_std_x']:.2f} "
                      f"(n={r['frames_used']} frames)")
        except Exception as exc:
            print(f"  {key}: FAILED - {exc}")


if __name__ == "__main__":
    main()

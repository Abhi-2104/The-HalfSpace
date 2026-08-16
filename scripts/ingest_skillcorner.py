#!/usr/bin/env python3
"""CLI: ingest all matches in SkillCorner Open Data (10 matches, 2024/25 A-League),
computing team compactness (width/length) for each. Idempotent."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from halfspace import db
from halfspace.ingest import skillcorner


def main():
    conn = db.connect()
    match_list = skillcorner.fetch_match_list()
    print(f"{len(match_list)} SkillCorner matches")

    for m in match_list:
        mid = m["id"]
        done = conn.execute(
            "SELECT 1 FROM tracking_team_match WHERE provider='skillcorner_open_data' AND provider_match_id=?",
            (str(mid),),
        ).fetchone()
        if done:
            print(f"  {mid}: already ingested, skipping")
            continue
        try:
            results = skillcorner.ingest_match(conn, mid)
            for r in results:
                print(f"  {mid}: {r['team_name']:20s} width={r['width_std_y']:.2f} length={r['length_std_x']:.2f} "
                      f"(n={r['frames_used']} frames, avg {r['avg_players_tracked']:.1f} players/frame)")
        except Exception as exc:
            print(f"  {mid}: FAILED - {exc}")


if __name__ == "__main__":
    main()

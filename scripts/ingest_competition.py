#!/usr/bin/env python3
"""CLI: bulk-ingest every match in a StatsBomb open-data competition/season.

Usage: python3 scripts/ingest_competition.py <competition_id> <season_id> [--360]

  --360   also pull 360 freeze-frames (only tournaments with 360 coverage have
          them: WC2022, Euro 2024, Copa America 2024, Women's Euro 2025).

Example (WC2022 with 360):        python3 scripts/ingest_competition.py 43 106 --360
Example (La Liga, event-only):    python3 scripts/ingest_competition.py 11 27

Idempotent. Without --360, skips matches already present. With --360, skips
matches that already have has_360=1 (so it backfills 360 onto matches that
were previously ingested event-only).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from halfspace import db
from halfspace.ingest import statsbomb


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    fetch_360 = "--360" in sys.argv
    if len(args) != 2:
        print(__doc__)
        sys.exit(1)
    competition_id, season_id = int(args[0]), int(args[1])

    conn = db.connect()
    match_list = statsbomb.fetch_match_list(competition_id, season_id)
    print(f"{len(match_list)} matches in competition {competition_id} season {season_id}{' (with 360)' if fetch_360 else ''}")

    comp_name, season_name = statsbomb.fetch_competition_season_names(competition_id, season_id)
    conn.execute("INSERT OR IGNORE INTO competition (id, name) VALUES (?, ?)", (competition_id, comp_name))
    conn.execute("UPDATE competition SET name = ? WHERE id = ?", (comp_name, competition_id))
    conn.execute("INSERT OR IGNORE INTO season (id, competition_id, name) VALUES (?, ?, ?)",
                 (season_id, competition_id, season_name))
    conn.execute("UPDATE season SET name = ? WHERE id = ?", (season_name, season_id))
    conn.commit()
    print(f"  -> {comp_name} {season_name}")

    if fetch_360:
        # backfill mode: skip matches that already have 360, re-process the rest
        done_ids = {r["match_id"] for r in conn.execute(
            "SELECT match_id FROM data_coverage WHERE has_360 = 1 AND match_id IN "
            "(SELECT id FROM match WHERE competition_id=? AND season_id=?)",
            (competition_id, season_id)).fetchall()}
    else:
        # a match with any ingested events is considered done
        done_ids = {r["match_id"] for r in conn.execute(
            "SELECT DISTINCT match_id FROM event WHERE match_id IN (SELECT id FROM match WHERE competition_id=? AND season_id=?)",
            (competition_id, season_id)).fetchall()}

    ok, failed = 0, []
    for i, m in enumerate(match_list, 1):
        mid = m["match_id"]
        if mid in done_ids:
            continue
        meta = {
            "home_team_id": m["home_team"]["home_team_id"], "away_team_id": m["away_team"]["away_team_id"],
            "home_score": m.get("home_score"), "away_score": m.get("away_score"), "match_date": m.get("match_date"),
        }
        try:
            statsbomb.ingest_match(conn, mid, competition_id=competition_id, season_id=season_id,
                                    match_meta=meta, fetch_360=fetch_360)
            ok += 1
        except Exception as exc:
            failed.append((mid, str(exc)))
        if i % 20 == 0 or i == len(match_list):
            print(f"  {i}/{len(match_list)} processed ({ok} this run, {len(failed)} failed)")

    print(f"done: {ok} newly processed, {len(done_ids)} already done, {len(failed)} failed")
    for mid, err in failed:
        print(f"  FAILED {mid}: {err}")


if __name__ == "__main__":
    main()

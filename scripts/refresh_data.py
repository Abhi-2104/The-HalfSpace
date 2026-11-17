#!/usr/bin/env python3
"""Keep the database current with StatsBomb open data. Safe to run on a schedule (cron, CI).

  refresh_data.py                       re-check every ingested competition/season for new matches
  refresh_data.py --add 43:3 2:27       also ingest these competition:season pairs
  refresh_data.py --all-360             also ingest every competition that has 360 freeze-frames
  refresh_data.py --women               also ingest every women's competition
  refresh_data.py --dry-run             print the plan (match counts), download nothing else

It re-downloads competitions.json and each match list (small), then ingests only matches
not already done. 360 is fetched for any season StatsBomb marks as having it. A running API
picks up new matches without a restart (profile caches are keyed on match count).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from halfspace import db
from halfspace.ingest import statsbomb


def main():
    argv = sys.argv[1:]
    add = {tuple(map(int, a.split(":"))) for a in argv if ":" in a}
    comps = statsbomb.fetch_competitions(refresh=True)
    by_key = {(c["competition_id"], c["season_id"]): c for c in comps}

    conn = db.connect()
    targets = {(r[0], r[1]) for r in conn.execute("SELECT DISTINCT competition_id, season_id FROM match")} | add
    if "--all-360" in argv:
        targets |= {k for k, c in by_key.items() if c.get("match_available_360")}
    if "--women" in argv:
        targets |= {k for k, c in by_key.items() if c.get("competition_gender") == "female"}

    unknown = sorted(k for k in targets if k not in by_key)
    if unknown:
        sys.exit(f"not in StatsBomb open data: {unknown}")

    if "--dry-run" in argv:
        total = 0
        for k in sorted(targets):
            n = len(statsbomb.fetch_match_list(*k, refresh=True))
            total += n
            c = by_key[k]
            print(f"{k[0]}:{k[1]:<4} {c['competition_name']} {c['season_name']}: {n} matches"
                  f"{' +360' if c.get('match_available_360') else ''}")
        print(f"total {total} matches in {len(targets)} seasons")
        return

    new = fails = 0
    for k in sorted(targets):
        ok, failed, _ = statsbomb.ingest_competition(conn, *k, fetch_360=bool(by_key[k].get("match_available_360")),
                                                     refresh=True)
        new, fails = new + ok, fails + len(failed)
        for mid, err in failed:
            print(f"  FAILED {mid}: {err}")
    print(f"refresh done: {new} new matches, {fails} failed")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()

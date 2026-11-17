#!/usr/bin/env python3
"""One-off: convert JSON-text freeze-frames in data/halfspace.db to packed blobs, then VACUUM.
Stop the API and any ingest first (VACUUM needs the DB to itself). Safe to re-run: converts only
rows still stored as text, in batches, committing as it goes.
Usage: python3 scripts/pack_frames.py"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from halfspace import db, framepack

BATCH = 20000


def main():
    conn = db.connect()
    done = 0
    while True:
        rows = conn.execute("SELECT event_id, freeze_frame, visible_area FROM freeze_frame "
                            "WHERE typeof(freeze_frame) = 'text' LIMIT ?", (BATCH,)).fetchall()
        if not rows:
            break
        conn.executemany(
            "UPDATE freeze_frame SET freeze_frame = ?, visible_area = ? WHERE event_id = ?",
            [(framepack.pack_players(json.loads(r["freeze_frame"])),
              framepack.pack_area(json.loads(r["visible_area"] or "[]")), r["event_id"]) for r in rows])
        conn.commit()
        done += len(rows)
        print(f"packed {done}")
    size = db.DEFAULT_DB_PATH.stat().st_size
    print(f"vacuuming ({size / 1e9:.2f} GB before)...")
    conn.execute("VACUUM")
    print(f"done: {db.DEFAULT_DB_PATH.stat().st_size / 1e9:.2f} GB after")


if __name__ == "__main__":
    main()

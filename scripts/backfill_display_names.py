#!/usr/bin/env python3
"""Fill player.display_name for every player from the cached raw lineups (nickname if any, else a guess).
Idempotent; safe to re-run after new ingests (new matches also set it as they are ingested).
Usage: python3 scripts/backfill_display_names.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from halfspace import db, names

files = sorted((Path(__file__).resolve().parent.parent / "data" / "raw" / "lineups").glob("*.json"))
nick, full = names.best_nicknames(files)
conn = db.connect()
rows = [(nick.get(pid) or names.known_as(name), pid) for pid, name in full.items()]
conn.executemany("UPDATE player SET display_name = ? WHERE id = ?", rows)
conn.commit()
n = conn.execute("SELECT COUNT(*) FROM player WHERE display_name IS NOT NULL").fetchone()[0]
print(f"{len(files)} lineup files, {len(nick)} players with a nickname, {n} players with a display_name")

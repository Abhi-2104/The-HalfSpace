#!/usr/bin/env python3
"""Bundle everything the server needs that is NOT in git into one archive:
  data/halfspace.db, data/derived.db, data/models/, data/derived/shots.pkl + matches.pkl, frontend/dist/
Upload it to the server and unpack it into the app folder. Never includes the raw cache, the big
local tables, or data/restricted.db (Impect, restricted terms).

  python3 scripts/package_release.py              # build the frontend first: cd frontend && VITE_API_BASE=/api npm run build
  python3 scripts/package_release.py --allow-unpacked   # skip the freeze-frame packing check
"""
import sqlite3
import sys
import tarfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = ["data/halfspace.db", "data/derived.db", "data/derived/shots.pkl", "data/derived/matches.pkl"]
DIRS = ["data/models", "frontend/dist"]


def check() -> list[str]:
    problems = []
    for f in FILES:
        if not (ROOT / f).exists():
            problems.append(f"missing {f}")
    for d in DIRS:
        if not (ROOT / d).is_dir():
            problems.append(f"missing {d}/" + ("  (build it: cd frontend && VITE_API_BASE=/api npm run build)" if "dist" in d else ""))
    if not (ROOT / "frontend/dist/index.html").exists() and not any("dist" in p for p in problems):
        problems.append("frontend/dist has no index.html")
    if (ROOT / "data/halfspace.db").exists() and "--allow-unpacked" not in sys.argv:
        c = sqlite3.connect(ROOT / "data/halfspace.db", timeout=30)
        n = c.execute("SELECT COUNT(*) FROM freeze_frame WHERE typeof(freeze_frame) = 'text'").fetchone()[0]
        if n:
            problems.append(f"{n:,} freeze-frames are still stored as large JSON text: run `python3 scripts/pack_frames.py` first "
                            "(the database shrinks from about 4.4 GB to about 1.3 GB), or pass --allow-unpacked")
    return problems


def main() -> None:
    problems = check()
    if problems:
        sys.exit("cannot package yet:\n  - " + "\n  - ".join(problems))
    c = sqlite3.connect(ROOT / "data/halfspace.db", timeout=60)
    c.execute("PRAGMA wal_checkpoint(TRUNCATE)")  # fold the write-ahead log into the main file so the copy is complete
    c.close()
    out = ROOT / "release" / f"halfspace-data-{time.strftime('%Y%m%d-%H%M')}.tar.gz"
    out.parent.mkdir(exist_ok=True)
    with tarfile.open(out, "w:gz", compresslevel=3) as tar:
        for f in FILES + DIRS:
            tar.add(ROOT / f, arcname=f)
            print("added", f)
    print(f"\n{out}  ({out.stat().st_size / 1e9:.2f} GB)")
    print("upload:  scp -i <your-key> " + str(out) + " ubuntu@<server-ip>:/tmp/   then unpack it inside /opt/halfspace on the server")


if __name__ == "__main__":
    main()

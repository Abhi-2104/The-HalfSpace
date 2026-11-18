#!/usr/bin/env python3
"""Check a running Halfspace server end to end (frontend, API, models, search, admin switch).
  python3 scripts/smoke_test.py https://yourname.duckdns.org     # a deployed server
  python3 scripts/smoke_test.py --spawn                           # start the production app locally, test it, stop it
Exits non-zero if anything fails."""
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def get(base, path, headers=None):
    req = urllib.request.Request(base + path, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.headers.get("content-type", ""), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("content-type", ""), e.read()


def run(base: str) -> int:
    fails = []

    def check(name, ok, detail=""):
        print(("PASS  " if ok else "FAIL  ") + name + (f"  ({detail})" if detail and not ok else ""))
        if not ok:
            fails.append(name)

    s, ct, b = get(base, "/api/health")
    check("API health", s == 200 and json.loads(b) == {"status": "ok"}, f"{s}")
    s, ct, b = get(base, "/")
    check("home page is the frontend", s == 200 and "text/html" in ct and b"<div id=\"root\"" in b, f"{s} {ct}")
    s, ct, b = get(base, "/matches/3869685")
    check("a frontend route returns the app, not JSON", s == 200 and "text/html" in ct, f"{s} {ct}")
    s, ct, b = get(base, "/api/overview")
    ov = json.loads(b) if s == 200 else {}
    check("overview has all matches", ov.get("matches", 0) >= 2000, str(ov))
    s, ct, b = get(base, "/api/competitions")
    check("all 24 competition-seasons listed", s == 200 and len(json.loads(b)["competitions"]) == 24, f"{s}")
    s, ct, b = get(base, "/api/matches/3869685/momentum")
    m = json.loads(b) if s == 200 else {}
    check("momentum with extra time", s == 200 and len(m.get("minutes", [])) == 126 and m.get("extra_time") is True, f"{s}")
    s, ct, b = get(base, "/api/matches/3869685/shots-xg")
    check("shots with xG and known-as names", s == 200 and json.loads(b)["shots"][0].get("display_name") and json.loads(b)["shots"][0].get("xg") is not None, f"{s}")
    s, ct, b = get(base, "/api/competitions/11/seasons/27/players/5503/profile")
    check("scouting card", s == 200 and json.loads(b).get("display_name") == "Lionel Messi", f"{s}")
    s, ct, b = get(base, "/api/search?q=high+pressing+teams&limit=3")
    check("search", s == 200 and json.loads(b)["results"], f"{s}")
    s, ct, b = get(base, "/api/standings/PL")
    check("standings", s == 200 and json.loads(b)["table"], f"{s}")
    s, ct, b = get(base, "/api/tracking")
    check("tracking list", s == 200, f"{s}")
    s, ct, b = get(base, "/api/admin/status")
    check("admin refuses without a token", s in (401, 503), f"{s}")
    s, ct, b = get(base, "/api/does-not-exist")
    check("unknown API paths are real 404s", s == 404, f"{s}")
    print(f"\n{'all checks passed' if not fails else 'FAILED: ' + ', '.join(fails)}")
    return 1 if fails else 0


def main():
    if "--spawn" in sys.argv:
        import socket
        with socket.socket() as sk:  # any free port
            sk.bind(("127.0.0.1", 0))
            port = sk.getsockname()[1]
        proc = subprocess.Popen([sys.executable.rsplit("/", 1)[0] + "/uvicorn" if "--use-current-python" in sys.argv else str(ROOT / ".venv/bin/uvicorn"), "halfspace.server:root", "--host", "127.0.0.1", "--port", str(port)],
                                cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        base = f"http://127.0.0.1:{port}"
        try:
            for _ in range(60):
                try:
                    if get(base, "/api/health")[0] == 200:
                        break
                except Exception:
                    time.sleep(0.5)
            sys.exit(run(base))
        finally:
            proc.terminate()
    elif len(sys.argv) > 1:
        sys.exit(run(sys.argv[1].rstrip("/")))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()

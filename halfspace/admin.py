"""
Admin API: see data/model status and run the data jobs (ingest, rebuild models) from a browser.

Security model (read this before exposing it):
  - Disabled unless HALFSPACE_ADMIN_TOKEN is set. Every call needs `Authorization: Bearer <token>`.
  - Jobs come from a fixed whitelist with fixed arguments. There is no way to pass a shell command,
    a path or a free-form argument; the only parameter is `steps` for build_models, checked against
    the known step names.
  - 5 wrong tokens from one address locks that address out for 15 minutes. Serve it over HTTPS only
    (the tunnel / reverse proxy does that); X-Forwarded-For is not trusted.
  - One job at a time. Jobs run as child processes in their own process group, so Cancel stops them
    and everything they spawned. Job records and logs live in data/admin/.
"""
import json
import os
import secrets
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from halfspace import db, derive
from halfspace.agent.llm import load_dotenv
from halfspace.models.xg import MODEL_DIR

load_dotenv()  # so HALFSPACE_ADMIN_TOKEN can live in .env next to the Groq key

ROOT = Path(__file__).resolve().parent.parent
ADMIN_DIR = ROOT / "data" / "admin"
PY = sys.executable
LOCK_AFTER, LOCK_SECONDS = 5, 15 * 60
MODEL_STEPS = ["derive", "xg", "momentum", "xt", "profiles", "possessions", "style", "xpass", "passframes", "goalkeeper", "roles", "vaep", "tracking", "search"]

# name -> (description, argv). The ONLY things this API can run.
JOBS: dict[str, tuple[str, list[str]]] = {
    "check_updates": ("Show what new StatsBomb matches exist (downloads nothing but match lists)",
                      [PY, "scripts/refresh_data.py", "--all-360", "--women", "--dry-run"]),
    "ingest_statsbomb": ("Ingest new StatsBomb matches (events, 360, women's leagues)",
                         [PY, "-u", "scripts/refresh_data.py", "--all-360", "--women"]),
    "refresh_fixtures": ("Refresh fixtures, results and standings (openfootball; football-data.org too when a key is set)",
                         [PY, "-u", "scripts/refresh_fixtures.py"]),
    "ingest_skillcorner": ("Ingest SkillCorner tracking matches (re-reads the repo's match list)",
                           [PY, "-u", "scripts/ingest_skillcorner.py"]),
    "ingest_idsse": ("Ingest IDSSE tracking matches (about 2.5 GB download)", [PY, "-u", "scripts/ingest_idsse.py"]),
    "build_models": ("Rebuild derived tables and every model (a few minutes; optional steps)",
                     [PY, "-u", "scripts/build_models.py"]),
    "backfill_display_names": ("Fill the 'known as' names for players from the cached lineups (safe to repeat)",
                               [PY, "-u", "scripts/backfill_display_names.py"]),
    "ingest_impect": ("Ingest Impect open data into the restricted DB (refuses unless HALFSPACE_ACCEPT_IMPECT_TERMS=yes is set on the server)",
                      [PY, "-u", "scripts/ingest_impect.py"]),
    "pack_frames": ("Maintenance: compress freeze-frames and VACUUM the database (needs free disk about the size of the DB)",
                    [PY, "-u", "scripts/pack_frames.py"]),
}

router = APIRouter(prefix="/admin")
_state = threading.Lock()  # guards jobs file + the running process
_proc: dict[str, subprocess.Popen] = {}
_fails: dict[str, tuple[int, float]] = {}


# ---------- auth ----------

def require_admin(request: Request) -> None:
    token = os.environ.get("HALFSPACE_ADMIN_TOKEN", "")
    if len(token) < 16:
        raise HTTPException(503, "admin disabled: set HALFSPACE_ADMIN_TOKEN (16+ characters) on the server")
    ip = request.client.host if request.client else "?"
    count, until = _fails.get(ip, (0, 0.0))
    if until > time.time():
        raise HTTPException(429, f"too many wrong tokens; try again in {int(until - time.time())}s")
    given = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    if not secrets.compare_digest(given.encode(), token.encode()):
        count += 1
        _fails[ip] = (count, time.time() + LOCK_SECONDS if count >= LOCK_AFTER else 0.0)
        time.sleep(0.5)  # slows guessing
        raise HTTPException(401, "bad or missing admin token")
    _fails.pop(ip, None)


# ---------- job records ----------

def _jobs_file() -> Path:
    ADMIN_DIR.mkdir(parents=True, exist_ok=True)
    return ADMIN_DIR / "jobs.json"


def _load() -> list[dict]:
    f = _jobs_file()
    return json.loads(f.read_text()) if f.exists() else []


def _save(jobs: list[dict]) -> None:
    _jobs_file().write_text(json.dumps(jobs[-50:], indent=1))


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _refresh_orphans(jobs: list[dict]) -> None:
    """A job marked running whose process is gone (server restarted, killed) is not running any more."""
    for j in jobs:
        if j["status"] == "running" and j["id"] not in _proc and not _alive(j.get("pid", 0)):
            j["status"], j["finished_at"] = "interrupted", time.time()


def _running(jobs: list[dict]) -> dict | None:
    return next((j for j in jobs if j["status"] == "running"), None)


def _watch(job_id: str, proc: subprocess.Popen) -> None:
    code = proc.wait()
    with _state:
        jobs = _load()
        for j in jobs:
            if j["id"] == job_id and j["status"] == "running":
                j["status"] = "succeeded" if code == 0 else ("cancelled" if j.get("cancel") else "failed")
                j["exit_code"], j["finished_at"] = code, time.time()
        _save(jobs)
        _proc.pop(job_id, None)


class JobRequest(BaseModel):
    name: str
    steps: list[str] | None = None


# ---------- endpoints ----------

@router.get("/status", dependencies=[Depends(require_admin)])
def status():
    d = {}
    try:
        conn = db.connect()
        for key, q in {"matches": "SELECT COUNT(*) FROM match", "events": "SELECT COUNT(*) FROM event",
                       "matches_with_360": "SELECT COUNT(*) FROM data_coverage WHERE has_360 = 1",
                       "tracking_matches": "SELECT COUNT(DISTINCT provider_match_id) FROM tracking_team_match"}.items():
            d[key] = conn.execute(q).fetchone()[0]
        d["journal_mode"] = conn.execute("PRAGMA journal_mode").fetchone()[0]
    except Exception as exc:  # a busy DB must not break the status page
        d["error"] = f"{type(exc).__name__}: {exc}"
    cards = sorted(MODEL_DIR.glob("*_card.json"))
    disk = shutil.disk_usage(ROOT)
    size = lambda p: round(p.stat().st_size / 1e9, 3) if p.exists() else None
    with _state:
        jobs = _load()
        _refresh_orphans(jobs)
        _save(jobs)
    return {"data": d, "models": {"count": len(cards), "last_built": max((c.stat().st_mtime for c in cards), default=None)},
            "files_gb": {"database": size(db.DEFAULT_DB_PATH), "derived_db": size(derive.DERIVED_DB)},
            "disk_free_gb": round(disk.free / 1e9, 1), "running_job": _running(jobs),
            "jobs_available": {k: v[0] for k, v in JOBS.items()}, "build_steps": MODEL_STEPS}


@router.get("/jobs", dependencies=[Depends(require_admin)])
def list_jobs():
    with _state:
        jobs = _load()
        _refresh_orphans(jobs)
        _save(jobs)
    return {"jobs": list(reversed(jobs))}


@router.post("/jobs", dependencies=[Depends(require_admin)])
def start_job(req: JobRequest):
    if req.name not in JOBS:
        raise HTTPException(400, f"unknown job '{req.name}'; available: {', '.join(JOBS)}")
    argv = list(JOBS[req.name][1])
    if req.steps:
        if req.name != "build_models" or any(s not in MODEL_STEPS for s in req.steps):
            raise HTTPException(400, f"steps only apply to build_models and must be among: {', '.join(MODEL_STEPS)}")
        argv += req.steps
    with _state:
        jobs = _load()
        _refresh_orphans(jobs)
        if _running(jobs):
            raise HTTPException(409, f"job '{_running(jobs)['name']}' is still running")
        job_id = uuid.uuid4().hex[:10]
        (ADMIN_DIR / "logs").mkdir(parents=True, exist_ok=True)
        log = ADMIN_DIR / "logs" / f"{job_id}.log"
        proc = subprocess.Popen(argv, cwd=ROOT, stdout=log.open("wb"), stderr=subprocess.STDOUT, start_new_session=True)
        _proc[job_id] = proc
        job = {"id": job_id, "name": req.name, "steps": req.steps, "status": "running", "pid": proc.pid,
               "started_at": time.time(), "finished_at": None, "exit_code": None}
        jobs.append(job)
        _save(jobs)
    threading.Thread(target=_watch, args=(job_id, proc), daemon=True).start()
    return job


def _find(job_id: str) -> dict:
    job = next((j for j in _load() if j["id"] == job_id), None)
    if job is None:
        raise HTTPException(404, "no such job")
    return job


@router.get("/jobs/{job_id}", dependencies=[Depends(require_admin)])
def job_detail(job_id: str, tail: int = 200):
    job = _find(job_id)
    log = ADMIN_DIR / "logs" / f"{job['id']}.log"
    lines = log.read_text(errors="replace").splitlines()[-min(tail, 2000):] if log.exists() else []
    return {**job, "log": lines}


@router.post("/jobs/{job_id}/cancel", dependencies=[Depends(require_admin)])
def cancel_job(job_id: str):
    with _state:
        jobs = _load()
        job = next((j for j in jobs if j["id"] == job_id), None)
        if job is None:
            raise HTTPException(404, "no such job")
        if job["status"] != "running":
            raise HTTPException(409, f"job is {job['status']}, not running")
        job["cancel"] = True
        _save(jobs)
    try:
        os.killpg(job["pid"], signal.SIGTERM)
    except OSError:
        pass
    return {"cancelling": job_id}

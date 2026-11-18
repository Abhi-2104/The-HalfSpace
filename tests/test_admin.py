"""Admin API: auth, lockout, job whitelist, one-at-a-time, cancel. Jobs are replaced by harmless commands."""
import sys
import time

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))
from halfspace import admin
from halfspace.api import app

TOKEN = "t" * 32
H = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("HALFSPACE_ADMIN_TOKEN", TOKEN)
    monkeypatch.setattr(admin, "ADMIN_DIR", tmp_path)
    monkeypatch.setattr(admin, "JOBS", {"quick": ("prints", [sys.executable, "-c", "print('hello from job')"]),
                                        "slow": ("sleeps", [sys.executable, "-c", "import time; time.sleep(30)"]),
                                        "build_models": ("fake build", [sys.executable, "-c", "import sys; print(sys.argv[1:])"])})
    monkeypatch.setattr(admin.time, "sleep", lambda s: None)   # no real delay on wrong tokens
    admin._fails.clear()
    admin._proc.clear()
    return TestClient(app)


def _wait(client, job_id, status):
    for _ in range(100):
        j = client.get(f"/admin/jobs/{job_id}", headers=H).json()
        if j["status"] == status:
            return j
        time.sleep(0.1)
    raise AssertionError(f"job never reached {status}: {j}")


def test_disabled_without_token_and_rejects_bad_tokens(client, monkeypatch):
    assert client.get("/admin/status", headers=H).status_code == 200
    assert client.get("/admin/status").status_code == 401
    assert client.get("/admin/status", headers={"Authorization": "Bearer nope"}).status_code == 401
    monkeypatch.setenv("HALFSPACE_ADMIN_TOKEN", "")
    assert client.get("/admin/status", headers=H).status_code == 503          # no token configured: portal off
    monkeypatch.setenv("HALFSPACE_ADMIN_TOKEN", "short")
    assert client.get("/admin/status", headers={"Authorization": "Bearer short"}).status_code == 503  # too weak to accept


def test_five_wrong_tokens_lock_the_address_out(client):
    for _ in range(5):
        assert client.get("/admin/jobs", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.get("/admin/jobs", headers={"Authorization": "Bearer wrong"}).status_code == 429
    assert client.get("/admin/jobs", headers=H).status_code == 429            # even the right token, until the lock expires


def test_job_runs_logs_and_finishes(client):
    job = client.post("/admin/jobs", json={"name": "quick"}, headers=H).json()
    done = _wait(client, job["id"], "succeeded")
    assert done["exit_code"] == 0 and "hello from job" in "\n".join(done["log"])
    assert client.get("/admin/jobs", headers=H).json()["jobs"][0]["id"] == job["id"]


def test_only_whitelisted_jobs_and_validated_steps(client):
    assert client.post("/admin/jobs", json={"name": "rm -rf /"}, headers=H).status_code == 400
    assert client.post("/admin/jobs", json={"name": "quick", "steps": ["xg"]}, headers=H).status_code == 400
    assert client.post("/admin/jobs", json={"name": "build_models", "steps": ["xg; ls"]}, headers=H).status_code == 400
    ok = client.post("/admin/jobs", json={"name": "build_models", "steps": ["xg", "xt"]}, headers=H).json()
    assert "['xg', 'xt']" in "\n".join(_wait(client, ok["id"], "succeeded")["log"])


def test_one_job_at_a_time_and_cancel(client):
    first = client.post("/admin/jobs", json={"name": "slow"}, headers=H).json()
    assert client.post("/admin/jobs", json={"name": "quick"}, headers=H).status_code == 409
    assert client.post(f"/admin/jobs/{first['id']}/cancel", headers=H).status_code == 200
    assert _wait(client, first["id"], "cancelled")["finished_at"]
    assert client.post("/admin/jobs", json={"name": "quick"}, headers=H).status_code == 200   # free again


def test_status_reports_data_and_running_job(client):
    s = client.get("/admin/status", headers=H).json()
    assert {"data", "models", "files_gb", "disk_free_gb", "jobs_available", "build_steps"} <= set(s)
    assert s["running_job"] is None and "quick" in s["jobs_available"]

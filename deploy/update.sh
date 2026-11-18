#!/usr/bin/env bash
# Update the code from GitHub and restart. Data is updated from the admin page (or by uploading a new bundle).
set -euo pipefail
cd /opt/halfspace
git pull --ff-only
.venv/bin/pip install -r deploy/requirements.lock
sudo systemctl restart halfspace
sleep 2
curl -fsS http://127.0.0.1:8742/api/health && echo " ok"

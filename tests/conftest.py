"""Shared skip-guards: tests that assert on specific real data skip (not fail)
when that slice isn't ingested, so a partial local dataset gives a clean run."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from halfspace import db


def _rows(sql: str) -> int:
    return db.connect().execute(sql).fetchone()[0] if db.DEFAULT_DB_PATH.exists() else 0


@pytest.fixture
def needs_laliga():
    if not _rows("SELECT COUNT(*) FROM match WHERE competition_id = 11 AND season_id = 27"):
        pytest.skip("La Liga 2015/16 not ingested - scripts/ingest_competition.py 11 27")


@pytest.fixture
def needs_tracking():
    if not _rows("SELECT COUNT(*) FROM tracking_team_match"):
        pytest.skip("no tracking data - scripts/ingest_skillcorner.py / ingest_idsse.py")

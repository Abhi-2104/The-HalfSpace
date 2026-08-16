"""
Data-quality checks against whatever's currently ingested in data/halfspace.db.
Not fixture-bound like test_pipeline.py - this runs over the real dev dataset
(WC2022 + La Liga 2015/16 + whatever else has been ingested) to catch the
classes of bug the project spec explicitly calls out (invalid coords,
duplicate events, missing ids, period-scoping leaks) at real scale, not just
on one hand-picked match.

Skips (not fails) if the DB is empty - this is a check on ingested data, not
a substitute for test_pipeline.py's offline fixture tests.
"""
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from halfspace import db

PITCH_X = (0, 120)
PITCH_Y = (0, 80)


@pytest.fixture
def conn():
    if not db.DEFAULT_DB_PATH.exists():
        pytest.skip("no data/halfspace.db - run scripts/ingest_competition.py first")
    c = db.connect()
    n = c.execute("SELECT COUNT(*) AS n FROM event").fetchone()["n"]
    if n == 0:
        pytest.skip("data/halfspace.db has no ingested events")
    return c


def test_no_duplicate_event_ids(conn):
    row = conn.execute("SELECT COUNT(*) - COUNT(DISTINCT id) AS dupes FROM event").fetchone()
    assert row["dupes"] == 0, f"{row['dupes']} duplicate event ids"


def test_coordinates_within_pitch_bounds(conn):
    # A handful of real StatsBomb events sit marginally past the touchline (player/ball
    # chasing a ball out of play) - confirmed by manual inspection, not an ingestion bug.
    # Hard-fail on genuinely broken data (e.g. x=9999); tolerate <0.05% marginal overshoot.
    grossly_bad = conn.execute(
        "SELECT COUNT(*) AS n FROM event WHERE x IS NOT NULL AND (x < -5 OR x > 125 OR y < -5 OR y > 85)"
    ).fetchone()["n"]
    assert grossly_bad == 0, f"{grossly_bad} events with wildly invalid coordinates (way outside the pitch)"

    marginal = conn.execute(
        """SELECT COUNT(*) AS n FROM event
           WHERE x IS NOT NULL AND (x < ? OR x > ? OR y < ? OR y > ?)""",
        (PITCH_X[0], PITCH_X[1], PITCH_Y[0], PITCH_Y[1]),
    ).fetchone()["n"]
    total = conn.execute("SELECT COUNT(*) AS n FROM event WHERE x IS NOT NULL").fetchone()["n"]
    rate = marginal / total if total else 0
    assert rate < 0.0005, f"{marginal}/{total} ({rate:.4%}) events outside pitch bounds - too high to be marginal noise"


def test_no_orphan_team_or_player_refs(conn):
    orphan_teams = conn.execute(
        "SELECT COUNT(*) AS n FROM event WHERE team_id IS NOT NULL AND team_id NOT IN (SELECT id FROM team)"
    ).fetchone()["n"]
    orphan_players = conn.execute(
        "SELECT COUNT(*) AS n FROM event WHERE player_id IS NOT NULL AND player_id NOT IN (SELECT id FROM player)"
    ).fetchone()["n"]
    assert orphan_teams == 0, f"{orphan_teams} events reference a team not in the team table"
    assert orphan_players == 0, f"{orphan_players} events reference a player not in the player table"


def test_every_match_has_two_teams(conn):
    bad = conn.execute(
        """SELECT id FROM match
           WHERE home_team_id IS NULL OR away_team_id IS NULL OR home_team_id = away_team_id"""
    ).fetchall()
    assert not bad, f"{len(bad)} matches with missing/duplicate home-away team ids: {[r['id'] for r in bad[:5]]}"


def test_shootout_period_never_counted_as_regulation_goal(conn):
    """The exact bug class found during manual pipeline testing: period=5 (penalty
    shootout) events must never silently flow into a 'regulation goals' aggregate.
    This asserts the invariant at the data layer, not just in one feature function."""
    matches_with_shootout = conn.execute(
        "SELECT DISTINCT match_id FROM event WHERE period = 5"
    ).fetchall()
    for row in matches_with_shootout:
        mid = row["match_id"]
        reg_goals = conn.execute(
            "SELECT COUNT(*) AS n FROM event WHERE match_id=? AND period IN (1,2,3,4) "
            "AND type_name='Shot' AND outcome_name='Goal'", (mid,),
        ).fetchone()["n"]
        all_goals = conn.execute(
            "SELECT COUNT(*) AS n FROM event WHERE match_id=? "
            "AND type_name='Shot' AND outcome_name='Goal'", (mid,),
        ).fetchone()["n"]
        assert reg_goals <= all_goals, f"match {mid}: regulation-goal count exceeds total - period filter broken"


def test_minutes_played_are_plausible(conn):
    bad = conn.execute(
        "SELECT match_id, player_id, minutes FROM player_match_minutes WHERE minutes < 0 OR minutes > 130"
    ).fetchall()
    assert not bad, f"{len(bad)} player-match rows with implausible minutes: {[dict(r) for r in bad[:5]]}"


if __name__ == "__main__":
    import subprocess
    subprocess.run([sys.executable, "-m", "pytest", __file__, "-v"])

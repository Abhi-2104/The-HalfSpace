"""
Spatial/tracking tests against the live tracking_team_match table (SkillCorner
+ IDSSE). Skips if not ingested. Sanity-range checks, not "known fact" checks
like the other analytics tests - team compactness doesn't have a well-known
public benchmark the way Suárez's goal tally does, so this validates the
pipeline is producing physically plausible numbers, not a specific known
result (the project spec's own honesty principle: don't manufacture
certainty where the source doesn't support it).
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from halfspace import db
from halfspace.features import spatial


@pytest.fixture
def conn():
    if not db.DEFAULT_DB_PATH.exists():
        pytest.skip("no data/halfspace.db")
    c = db.connect()
    if c.execute("SELECT COUNT(*) n FROM tracking_team_match").fetchone()["n"] == 0:
        pytest.skip("no tracking data ingested - run scripts/ingest_skillcorner.py / ingest_idsse.py")
    return c


def test_skillcorner_team_shape_plausible(conn):
    rows = spatial.team_shape(conn, "skillcorner_open_data")
    assert rows, "expected SkillCorner tracking rows"
    for r in rows:
        assert 5 <= r["width_std_y"] <= 25, f"implausible width for {r['team_name']}: {r['width_std_y']}"
        assert 5 <= r["length_std_x"] <= 30, f"implausible length for {r['team_name']}: {r['length_std_x']}"
        assert 8 <= r["avg_players_tracked"] <= 11.5, f"implausible player count for {r['team_name']}"
        assert r["tracking_variant"] == "extrapolated"


def test_idsse_team_shape_plausible(conn):
    rows = spatial.team_shape(conn, "idsse_open_data")
    if not rows:
        pytest.skip("IDSSE not ingested yet")
    for r in rows:
        assert 5 <= r["width_std_y"] <= 25, f"implausible width for {r['team_name']}: {r['width_std_y']}"
        assert 5 <= r["length_std_x"] <= 30, f"implausible length for {r['team_name']}: {r['length_std_x']}"
        assert r["tracking_variant"] == "observed"


def test_both_providers_produce_comparable_ranges(conn):
    """Cross-provider sanity: SkillCorner (broadcast-derived) and IDSSE (true optical)
    should land in a similar physical range even though they're different leagues/methods -
    if one provider's numbers were off by 10x, that'd flag a units/parsing bug."""
    sc = spatial.team_shape(conn, "skillcorner_open_data")
    ids = spatial.team_shape(conn, "idsse_open_data")
    if not (sc and ids):
        pytest.skip("need both providers ingested for cross-check")
    sc_avg_width = sum(r["width_std_y"] for r in sc) / len(sc)
    ids_avg_width = sum(r["width_std_y"] for r in ids) / len(ids)
    assert abs(sc_avg_width - ids_avg_width) < 5, f"SkillCorner ({sc_avg_width:.1f}) and IDSSE ({ids_avg_width:.1f}) width diverge too much - check units"


if __name__ == "__main__":
    import subprocess
    subprocess.run([sys.executable, "-m", "pytest", __file__, "-v"])

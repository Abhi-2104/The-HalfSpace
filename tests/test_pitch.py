"""
Pitch-visualization feature tests against the live dataset. Heatmap/pass-network
work on any match with events; freeze-frame needs 360 (WC2022 final has it).
Sanity + shape checks - the frontend renders these, so the contract matters.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from halfspace import db
from halfspace.features import pitch

WC2022_FINAL = 3869685
ARGENTINA = 779
MESSI = 5503


@pytest.fixture
def conn():
    if not db.DEFAULT_DB_PATH.exists():
        pytest.skip("no data/halfspace.db")
    c = db.connect()
    if c.execute("SELECT COUNT(*) n FROM event WHERE match_id = ?", (WC2022_FINAL,)).fetchone()["n"] == 0:
        pytest.skip("WC2022 final not ingested")
    return c


def test_player_heatmap_grid_shape_and_peak(conn):
    hm = pitch.player_heatmap(conn, WC2022_FINAL, MESSI)
    assert len(hm["grid"]) == hm["bins_y"]
    assert all(len(row) == hm["bins_x"] for row in hm["grid"])
    total = sum(sum(row) for row in hm["grid"])
    assert total == hm["touches"], "binned counts must sum to total touches"
    assert hm["peak"] == max(max(row) for row in hm["grid"])
    assert hm["touches"] > 0, "Messi had touches in the final"


def test_team_heatmap_nonempty(conn):
    hm = pitch.team_heatmap(conn, WC2022_FINAL, ARGENTINA)
    assert hm["actions"] > 100  # a full match of team actions
    assert sum(sum(row) for row in hm["grid"]) == hm["actions"]


def test_pass_network_nodes_and_edges(conn):
    net = pitch.pass_network(conn, WC2022_FINAL, ARGENTINA)
    assert net["nodes"], "expected pass-network nodes"
    # every node sits on the pitch
    for n in net["nodes"]:
        assert 0 <= n["x"] <= 120 and 0 <= n["y"] <= 80
    # edges reference real node player_ids, never self-loops
    node_ids = {n["player_id"] for n in net["nodes"]}
    for e in net["edges"]:
        assert e["a"] in node_ids and e["b"] in node_ids
        assert e["a"] != e["b"], "no self-loop edges"
    assert net["cutoff_note"], "must explain the substitution cutoff honestly"


def test_shots_with_xg_and_freeze_flag(conn):
    shots = pitch.match_shots_with_xg(conn, WC2022_FINAL)
    assert shots
    # xg present (model was trained earlier) and in [0,1]
    for s in shots:
        if s["xg"] is not None:
            assert 0 <= s["xg"] <= 1
    # the final has 360, so at least some shots carry a freeze-frame
    assert any(s["has_freeze_frame"] for s in shots), "WC2022 final shots should have 360 freeze-frames"


def test_freeze_frame_roundtrip(conn):
    # find a shot that has a freeze-frame, fetch it, check structure
    row = conn.execute(
        """SELECT e.id FROM event e JOIN freeze_frame ff ON ff.event_id = e.id
           WHERE e.match_id = ? AND e.type_name = 'Shot' LIMIT 1""",
        (WC2022_FINAL,),
    ).fetchone()
    if not row:
        pytest.skip("no 360 shot freeze-frame ingested for the final yet")
    frame = pitch.shot_freeze_frame(conn, row["id"])
    assert frame is not None
    assert isinstance(frame["freeze_frame"], list)
    if frame["freeze_frame"]:
        p = frame["freeze_frame"][0]
        assert "location" in p and len(p["location"]) == 2
        assert "teammate" in p


if __name__ == "__main__":
    import subprocess
    subprocess.run([sys.executable, "-m", "pytest", __file__, "-v"])

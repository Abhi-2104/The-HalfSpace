"""
Analytics-layer tests against the live ingested dataset (495 real matches).
Same pattern as test_data_quality.py: assert football-sane outcomes against
known real facts, not just "did it run". Skips if the DB isn't populated.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from halfspace import db
from halfspace.features import player, team, sequences, shot_quality

LALIGA_1516 = (11, 27)
WC2022 = (43, 106)
WC2022_FINAL_ID = 3869685
MESSI_ID = 5503


@pytest.fixture
def conn():
    if not db.DEFAULT_DB_PATH.exists():
        pytest.skip("no data/halfspace.db - run scripts/ingest_competition.py first")
    c = db.connect()
    if c.execute("SELECT COUNT(*) n FROM event").fetchone()["n"] == 0:
        pytest.skip("data/halfspace.db has no ingested events")
    return c


def test_suarez_tops_goals_per_90_la_liga_1516(conn):
    """Luis Suárez won the real 2015/16 Pichichi (La Liga top scorer, 40 goals)."""
    profiles = player.season_player_profiles(conn, *LALIGA_1516)
    assert profiles, "expected season profiles for La Liga 2015/16"
    top = max(profiles, key=lambda p: p["goals_p90"])
    assert "Suárez" in top["name"], f"expected Suárez top of goals/90, got {top['name']} ({top['goals_p90']})"


def test_messi_similarity_surfaces_neymar(conn):
    """Both were Barcelona wide creative dribblers in 2015/16 - the expected real-world answer."""
    result = player.similar_players(conn, *LALIGA_1516, player_id=MESSI_ID, top_n=8)
    assert "most_similar" in result, result
    names = [m["name"] for m in result["most_similar"]]
    assert any("Neymar" in n for n in names), f"expected Neymar in Messi's top matches, got {names}"


def test_ppda_ranks_known_pressing_teams(conn):
    """Spain/Germany were real high-press sides at WC2022; Morocco ran a real deep block."""
    profiles = team.season_team_profiles(conn, *WC2022)
    ranked = [p["team"] for p in profiles if p["avg_ppda"] is not None]
    assert "Spain" in ranked[:5], f"expected Spain near the top of the press ranking, got top 5: {ranked[:5]}"
    assert "Morocco" in ranked[-8:], f"expected Morocco near the bottom (deep block), got bottom 8: {ranked[-8:]}"


def test_counterattack_detector_finds_mbappe_transition_goal(conn):
    """Known real sequence: Mbappé's 2nd goal (80:59) came off a quick transition."""
    candidates = sequences.find_counterattacks(conn, WC2022_FINAL_ID)
    assert candidates, "expected at least one counterattack candidate in the WC2022 final"
    assert all(c["confidence"] == "medium" for c in candidates), "heuristic detector must not claim high confidence"
    minutes = [c["start_minute"] for c in candidates]
    assert any(78 <= m <= 81 for m in minutes), f"expected a candidate around Mbappé's 80:59 goal, got minutes {minutes}"


def test_shot_quality_model_sane_predictions(conn):
    """Penalty spot should score much higher than a tight-angle box edge."""
    if not shot_quality.MODEL_PATH.exists():
        pytest.skip("model not trained - run scripts/train_shot_model.py first")
    penalty_spot = shot_quality.score_shot(108, 40, is_header=False)
    tight_angle = shot_quality.score_shot(110, 5, is_header=False)
    header_from_edge = shot_quality.score_shot(106, 40, is_header=True)
    footed_same_spot = shot_quality.score_shot(106, 40, is_header=False)
    assert penalty_spot > tight_angle, f"penalty spot ({penalty_spot:.3f}) should beat a tight-angle shot ({tight_angle:.3f})"
    assert footed_same_spot > header_from_edge, "footed shot should score higher than a header from the same spot"


if __name__ == "__main__":
    import subprocess
    subprocess.run([sys.executable, "-m", "pytest", __file__, "-v"])

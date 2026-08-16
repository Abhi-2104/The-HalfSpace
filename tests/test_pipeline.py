"""
One smoke test, whole pipeline: fixture JSON -> ingest -> canonical schema -> features.
Uses the WC2022 Final fixture (proven correct against the real known result during
manual research). Assertions are the football-sanity checks, not just "did it run":
  - regulation+extra-time score is 3-3 (period 5 = penalty shootout must NOT count)
  - goalkeepers are excluded from the progressive-passes ranking
Run: python3 -m pytest tests/test_pipeline.py -v   (or just: python3 tests/test_pipeline.py)
"""
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from halfspace import db, features
from halfspace.ingest import statsbomb

FIXTURES = Path(__file__).resolve().parent / "fixtures"
WC2022_FINAL_ID = 3869685


def _fresh_conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(db.SCHEMA)
    return conn


def test_regulation_score_excludes_shootout():
    conn = _fresh_conn()
    statsbomb.ingest_match(
        conn, WC2022_FINAL_ID,
        events_path=FIXTURES / "wc2022_final_events.json",
        lineups_path=FIXTURES / "wc2022_final_lineups.json",
        competition_id=43, season_id=106,
    )
    goals = features.goals_timeline(conn, WC2022_FINAL_ID)
    assert len(goals) == 6, f"expected 6 regulation+ET goals (3-3), got {len(goals)} - shootout leaking in?"

    shots = features.shot_summary(conn, WC2022_FINAL_ID)
    goal_counts = sorted(t["goals"] for t in shots.values())
    assert goal_counts == [3, 3], f"expected 3-3, got {goal_counts}"


def test_progressive_passes_exclude_goalkeepers():
    conn = _fresh_conn()
    statsbomb.ingest_match(
        conn, WC2022_FINAL_ID,
        events_path=FIXTURES / "wc2022_final_events.json",
        lineups_path=FIXTURES / "wc2022_final_lineups.json",
        competition_id=43, season_id=106,
    )
    counts = features.player_progressive_passes(conn, WC2022_FINAL_ID)
    gk_rows = conn.execute(
        "SELECT player_id FROM player_match_minutes WHERE match_id = ? AND position = 'Goalkeeper'",
        (WC2022_FINAL_ID,),
    ).fetchall()
    gk_ids = {r["player_id"] for r in gk_rows}
    assert gk_ids, "expected at least the two starting keepers in this match"
    assert not (set(counts.keys()) & gk_ids), "goalkeeper leaked into progressive-passes ranking"


def test_ppda_computes_for_both_teams():
    conn = _fresh_conn()
    statsbomb.ingest_match(
        conn, WC2022_FINAL_ID,
        events_path=FIXTURES / "wc2022_final_events.json",
        lineups_path=FIXTURES / "wc2022_final_lineups.json",
        competition_id=43, season_id=106,
    )
    result = features.ppda(conn, WC2022_FINAL_ID)
    assert len(result) == 2
    assert all(v > 0 for v in result.values())


if __name__ == "__main__":
    test_regulation_score_excludes_shootout()
    test_progressive_passes_exclude_goalkeepers()
    test_ppda_computes_for_both_teams()
    print("all smoke tests passed")

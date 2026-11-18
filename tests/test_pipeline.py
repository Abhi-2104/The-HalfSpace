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


def test_season_match_count_changes_when_matches_are_ingested(tmp_path):
    """Profile caches are keyed on this, so new matches must change it (no API restart)."""
    from halfspace import db
    conn = db.connect(tmp_path / "t.db")
    assert db.season_match_count(conn, 1, 1) == 0
    conn.execute("INSERT INTO competition (id, name) VALUES (1, 'c')")
    conn.execute("INSERT INTO season (id, competition_id, name) VALUES (1, 1, 's')")
    conn.execute("INSERT INTO match (id, competition_id, season_id) VALUES (10, 1, 1)")
    assert db.season_match_count(conn, 1, 1) == 1
    assert db.season_match_count(conn, 1, 2) == 0


def test_framepack_roundtrip_within_a_tenth_of_a_yard():
    from halfspace import framepack
    players = [{"teammate": True, "actor": True, "keeper": False, "location": [101.04, 48.0]},
               {"teammate": False, "actor": False, "keeper": True, "location": [118.96, 40.12]}]
    out = framepack.unpack_players(framepack.pack_players(players))
    assert [(p["teammate"], p["actor"], p["keeper"]) for p in out] == [(True, True, False), (False, False, True)]
    assert all(abs(a["location"][i] - b["location"][i]) <= 0.05 + 1e-9 for a, b in zip(players, out) for i in (0, 1))
    area = [10.5, 0.0, 99.9, 80.0]
    assert all(abs(a - b) <= 0.05 + 1e-9 for a, b in zip(area, framepack.unpack_area(framepack.pack_area(area))))
    assert len(framepack.pack_players(players)) == 10  # 5 bytes per player


def test_impect_kpis_are_stored_per_player_and_ingest_needs_terms_acceptance(tmp_path, monkeypatch):
    import sqlite3
    import pytest
    from halfspace.ingest import impect
    monkeypatch.delenv("HALFSPACE_ACCEPT_IMPECT_TERMS", raising=False)
    with pytest.raises(SystemExit, match="Terms of Use"):
        impect.ingest()
    conn = sqlite3.connect(tmp_path / "r.db")
    conn.executescript(impect.SCHEMA)
    doc = {"matchId": 7, "squadHome": {"id": 1, "players": [{"id": 10, "position": "GK", "playDuration": 5400.0,
                                                              "kpis": [{"kpiId": 0, "value": 2.5}, {"kpiId": 1}]}]},
           "squadAway": {"id": 2, "players": [{"id": 20, "position": "CB", "playDuration": 5000.0, "kpis": [{"kpiId": 0, "value": 1.0}]}]}}
    assert impect.store_player_kpis(conn, doc) == 2          # the KPI with no value is skipped
    assert impect.store_player_kpis(conn, doc) == 2          # re-ingest replaces, does not duplicate
    assert conn.execute("SELECT COUNT(*) FROM impect_player_kpi").fetchone()[0] == 2


def test_competitions_that_share_a_season_id_both_exist(tmp_path):
    """Regression: season was keyed on season_id alone, so Euro 2024 and Copa America 2024 (both 282) collapsed into one row
    and 10 of 24 competition-seasons disappeared from every list. Old databases are rebuilt on first connect."""
    import sqlite3
    from halfspace import db
    path = tmp_path / "old.db"
    raw = sqlite3.connect(path)
    raw.executescript("""
        CREATE TABLE competition (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE season (id INTEGER PRIMARY KEY, competition_id INTEGER NOT NULL, name TEXT NOT NULL);
        CREATE TABLE match (id INTEGER PRIMARY KEY, competition_id INTEGER NOT NULL, season_id INTEGER NOT NULL, match_date TEXT,
                            home_team_id INTEGER, away_team_id INTEGER, home_score INTEGER, away_score INTEGER, data_source_id INTEGER);
        INSERT INTO competition VALUES (55, 'UEFA Euro'), (223, 'Copa America');
        INSERT INTO season VALUES (282, 55, '2024');
        INSERT INTO match (id, competition_id, season_id) VALUES (1, 55, 282), (2, 223, 282);""")
    raw.commit()
    raw.close()
    conn = db.connect(path)
    rows = {(r["competition_id"], r["id"]) for r in conn.execute("SELECT competition_id, id FROM season")}
    assert rows == {(55, 282), (223, 282)}
    assert {r["competition_name"] for r in db.connect(path).execute(
        "SELECT c.name AS competition_name FROM competition c JOIN season s ON s.competition_id = c.id")} == {"UEFA Euro", "Copa America"}

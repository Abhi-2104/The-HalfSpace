"""Model tests. Pure-logic tests always run; ones that read built models/derived tables skip
until `python3 scripts/build_models.py` has been run."""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from halfspace import derive
from halfspace.models import xg

FIXTURE = Path(__file__).parent / "fixtures" / "wc2022_final_events.json"
needs_models = pytest.mark.skipif(not (xg.CARD_PATH.exists() and derive.DERIVED_DB.exists()),
                                  reason="run scripts/build_models.py first")


def test_parse_match_extracts_shots_with_freeze_frame_features():
    ev, shots = derive.parse_match(3869685, json.loads(FIXTURE.read_text()))
    assert (shots["period"] <= 5).all() and len(shots) == 38
    assert shots["xg_sb"].notna().all()                      # StatsBomb xG on every shot
    assert shots["has_ff"].mean() > 0.5 and (shots["n_def_cone"] >= 0).all()
    assert "Ball Receipt*" not in set(ev["type"])             # dropped on purpose
    assert ev["possession"].notna().all()


def test_triangle_counts_only_defenders_between_shooter_and_goal():
    frame = [{"location": [112, 40], "teammate": False, "position": {"name": "Center Back"}},    # in the lane
             {"location": [112, 60], "teammate": False, "position": {"name": "Center Back"}},    # wide: out
             {"location": [110, 40], "teammate": True, "position": {"name": "Center Forward"}},  # teammate: ignored
             {"location": [119, 40], "teammate": False, "position": {"name": "Goalkeeper"}}]     # keeper: separate
    f = derive.shot_frame_features(100, 40, frame)
    assert f["n_def_cone"] == 1 and f["keeper_x"] == 119 and f["n_team_vis"] == 1


def test_featurize_is_closer_better_at_the_basics():
    s = pd.DataFrame({"x": [108.0, 90.0], "y": [40.0, 40.0], "under_pressure": [0, 0], "first_time": [0, 0], "has_ff": [1, 1],
                      "n_def_cone": [0, 0], "nearest_def": [5.0, 5.0], "n_def_5": [0, 0], "n_team_vis": [3, 3],
                      "keeper_x": [118.0, 118.0], "keeper_y": [40.0, 40.0], "body_part": ["Right Foot"] * 2,
                      "technique": ["Normal"] * 2, "shot_type": ["Open Play"] * 2, "play_pattern": ["Regular Play"] * 2})
    f = xg.featurize(s)
    assert f.loc[0, "dist"] < f.loc[1, "dist"] and f.loc[0, "angle"] > f.loc[1, "angle"]


@needs_models
def test_xg_v2_card_beats_old_xg_lite_and_is_calibrated():
    card = json.loads(xg.CARD_PATH.read_text())
    m = card["oof_metrics"]
    assert m["xg_v2"]["auc"] > m["xg_lite_refit"]["auc"] + 0.02
    assert abs(m["xg_v2"]["sum_xg"] - m["xg_v2"]["goals"]) / m["xg_v2"]["goals"] < 0.03   # totals line up
    assert all(abs(b["pred"] - b["actual"]) < 0.04 for b in card["calibration"])


@needs_models
def test_momentum_story_for_the_2022_final():
    from fastapi.testclient import TestClient
    from halfspace.api import app
    r = TestClient(app).get("/matches/3869685/momentum")
    if r.status_code == 404:
        pytest.skip("match not in the ingested DB")
    j = r.json()
    assert len(j["momentum"]) == len(j["minutes"]) and all(-100 <= m <= 100 for m in j["momentum"])
    goals = [m for m in j["moments"] if m["kind"] == "goal"]
    assert len(goals) == 6 and j["extra_time"]                # 2-2 in regulation + 1-1 in extra time; shoot-out excluded
    assert len(j["minutes"]) > 100 and j["period_ends"] == [45, 90, 105, 120]
    assert any(g["minute"] >= 105 for g in goals)             # the extra-time goals are on the chart
    assert j["momentum"][30] != 0


@needs_models
def test_momentum_leans_toward_the_side_that_scores_next():
    card = json.loads((xg.MODEL_DIR / "momentum_card.json").read_text())["validation"]
    b = card["mean_net_goals_next_5min_by_momentum"]
    assert b["home >50"]["net_goals"] > b["even"]["net_goals"] > b["away >50"]["net_goals"]
    assert abs(card["corr_with_shuffled_goals_control"]) < 0.02 < card["corr_momentum_vs_net_goals_next_5min"]


@needs_models
def test_profile_endpoint_shrinks_small_samples_and_reports_percentiles():
    from fastapi.testclient import TestClient
    from halfspace.api import app
    c = TestClient(app)
    r = c.get("/competitions/11/seasons/27/leaders?metric=npxg&position_group=ATT")
    if r.status_code != 200 or not r.json()["players"]:
        pytest.skip("La Liga 2015/16 not ingested")
    top = r.json()["players"][0]
    assert 0 < top["confidence"] <= 1 and top["percentile"] >= 90
    assert top["adjusted"] <= top["per90"] + 1e-6            # a top rate shrinks toward the mean, never up


def _card(name):
    return json.loads((xg.MODEL_DIR / f"{name}_card.json").read_text())


@needs_models
def test_counters_are_more_dangerous_than_open_play_and_corners_have_zones():
    c = _card("possessions")
    assert c["counter_xg_per_possession"] > 2 * c["open_play_xg_per_possession"]
    assert c["corner_zone_share"]["penalty_spot"] > 0.1 and abs(sum(c["corner_zone_share"].values()) - 1) < 0.01


@needs_models
def test_team_style_puts_barcelona_2015_16_at_the_possession_extreme():
    t = pd.read_sql("SELECT team_id, possession FROM team_style WHERE competition_id=11 AND season_id=27", derive.connect_derived())
    if t.empty:
        pytest.skip("La Liga 2015/16 not in the style table")
    assert t.sort_values("possession").iloc[-1]["team_id"] == 217  # Barcelona


@needs_models
def test_xpass_and_goalkeeper_cards():
    xp, gk = _card("xpass"), _card("goalkeeper")
    assert xp["oof_metrics"]["auc"] > 0.85
    assert abs(xp["oof_metrics"]["sum_expected"] - xp["oof_metrics"]["sum_actual"]) / xp["oof_metrics"]["sum_actual"] < 0.002
    assert gk["oof_metrics"]["psxg"]["auc"] > 0.9 and gk["keeper_attributed_share"] > 0.9
    assert gk["oof_metrics"]["psxg"]["brier"] < gk["oof_metrics"]["constant_rate_baseline"]["brier"]


@needs_models
def test_360_defender_features_improve_pass_completion_model():
    m = _card("passframes")["oof_metrics"]
    assert m["xpass_v2_with_defenders"]["auc"] > m["xpass_v1_same_passes"]["auc"]


@needs_models
def test_roles_agree_with_listed_positions_and_plays_like_excludes_the_player_himself():
    import sqlite3
    from halfspace.models import roles
    assert _card("roles")["homogeneity_vs_listed_position"] > 0.4
    try:
        conn = sqlite3.connect(f"file:{__import__('halfspace.db', fromlist=['x']).DEFAULT_DB_PATH}?mode=ro", uri=True, timeout=30)
        conn.row_factory = sqlite3.Row
        out = roles.similar_players(conn, 5503, 11, 27, 5)
    except sqlite3.OperationalError:
        pytest.skip("DB busy or missing")
    if "error" in out:
        pytest.skip("Messi 2015/16 not in role table")
    assert all(p["player_id"] != 5503 for p in out["plays_like"]) and len(out["plays_like"]) == 5


@needs_models
def test_match_report_mentions_both_teams_and_flags_extra_time():
    from fastapi.testclient import TestClient
    from halfspace.api import app
    r = TestClient(app).get("/matches/3869685/report")
    if r.status_code == 404:
        pytest.skip("final not ingested")
    text = " ".join(r.json()["text"])
    assert "Argentina" in text and "France" in text and "Extra time was played" in text


# --- fixtures and standings ---

def test_standings_are_computed_from_results_with_tiebreaks():
    from halfspace.ingest.fixtures import standings_from_results
    ms = [{"home": "A", "away": "B", "home_score": 2, "away_score": 0, "status": "FINISHED"},
          {"home": "C", "away": "A", "home_score": 1, "away_score": 1, "status": "FINISHED"},
          {"home": "B", "away": "C", "home_score": 3, "away_score": 0, "status": "FINISHED"},
          {"home": "A", "away": "C", "home_score": None, "away_score": None, "status": "SCHEDULED"}]
    t = {r["team"]: r for r in standings_from_results(ms)}
    assert t["A"]["points"] == 4 and t["B"]["points"] == 3 and t["C"]["points"] == 1 and t["A"]["position"] == 1
    assert t["B"]["goal_diff"] == 1 and t["A"]["played"] == 2                 # the scheduled match is not counted


def test_football_data_response_is_mapped_and_missing_key_is_a_clear_error(tmp_path, monkeypatch):
    from halfspace import derive as d
    from halfspace.ingest import fixtures as fx
    monkeypatch.setattr(d, "DERIVED_DB", tmp_path / "d.db")
    monkeypatch.delenv("FOOTBALL_DATA_KEY", raising=False)
    monkeypatch.setattr(fx, "load_dotenv", lambda: None)
    with pytest.raises(RuntimeError, match="FOOTBALL_DATA_KEY"):
        fx.refresh_football_data()

    def fake(url, headers=None):
        if url.endswith("/matches"):
            return {"competition": {"name": "Premier League"}, "filters": {"season": "2026"}, "matches": [
                {"id": 1, "matchday": 3, "utcDate": "2026-09-05T14:00:00Z", "status": "FINISHED", "homeTeam": {"name": "X"},
                 "awayTeam": {"name": "Y"}, "score": {"fullTime": {"home": 2, "away": 1}}}]}
        return {"standings": [{"type": "TOTAL", "table": [{"position": 1, "team": {"name": "X"}, "playedGames": 1, "won": 1, "draw": 0,
                                                            "lost": 0, "goalsFor": 2, "goalsAgainst": 1, "goalDifference": 1, "points": 3}]}]}
    monkeypatch.setattr(fx, "FD_CODES", ["PL"])
    out = fx.refresh_football_data(key="k", fetch=fake, pause=0)
    assert out["PL"] == {"fixtures": 1, "table_rows": 1}
    c = d.connect_derived()
    assert c.execute("SELECT home, home_score, source FROM fixture").fetchone()[:] == ("X", 2, "football-data.org")


def test_fixture_endpoints_prefer_the_official_source(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from halfspace import derive as d
    from halfspace.api import app
    from halfspace.ingest import fixtures as fx
    monkeypatch.setattr(d, "DERIVED_DB", tmp_path / "d.db")
    c = fx._conn()
    for src, home in (("openfootball", "Open FC"), ("football-data.org", "Official FC")):
        fx._store(c, src, "PL", [{"match_id": "1", "competition": "Premier League", "season": "2026", "matchday": "1", "kickoff": "2026-09-05T14:00",
                                  "status": "FINISHED", "home": home, "away": "Z", "home_score": 1, "away_score": 0}],
                  [{"position": 1, "team": home, "played": 1, "won": 1, "drawn": 0, "lost": 0, "goals_for": 1, "goals_against": 0,
                    "goal_diff": 1, "points": 3, "season": "2026"}])
    cl = TestClient(app)
    j = cl.get("/fixtures", params={"competition": "pl"}).json()
    assert j["source"] == "football-data.org" and j["fixtures"][0]["home"] == "Official FC"
    assert cl.get("/standings/PL").json()["table"][0]["team"] == "Official FC"
    assert cl.get("/fixtures", params={"competition": "XX"}).status_code == 404


@needs_models
def test_tracking_physical_and_pitch_control_are_sane():
    import sqlite3
    c = derive.connect_derived()
    try:
        ph = pd.read_sql("SELECT * FROM tracking_physical", c)
        pc = pd.read_sql("SELECT match_id, SUM(control_share) s FROM tracking_pitch_control GROUP BY match_id", c)
    except Exception:
        pytest.skip("tracking not built")
    assert len(pc) >= 10 and (pc["s"].sub(1).abs() < 0.01).all()           # two teams split the pitch
    big = ph[ph["tracked_min"] >= 30]
    assert 90 < big["distance_per_tracked_min"].median() < 170              # roughly 5.5-10 km/h average running
    assert ph["top_speed_kmh"].max() < 45 and (ph["detected_share"].between(0, 1)).all()
    assert (ph["sprints"] >= 0).all() and (ph["hsr_m"] <= ph["distance_m"]).all()


@needs_models
def test_search_finds_concepts_players_and_matches():
    from halfspace.models import search
    if not search.INDEX_PATH.exists():
        pytest.skip("search index not built")
    top = lambda q, **kw: search.query(q, **kw)["results"]
    assert top("what is a high press")[0]["kind"] == "concept" and "press" in top("what is a high press")[0]["title"].lower()
    assert top("counterattacking", kind="concept")[0]["title"] in ("Counterattack", "Transition (attacking/defensive)", "Gegenpressing (counter-press)")
    assert any("Messi" in r["title"] for r in top("Messi", kind="player"))
    assert all(r["kind"] == "match" for r in top("extra time", kind="match")) and top("extra time", kind="match")
    assert search.query("zzzzqqqq")["results"] == []                         # nonsense finds nothing instead of a random list

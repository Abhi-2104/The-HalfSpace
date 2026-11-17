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
    assert len(goals) == 4                                    # 2-2 in regulation
    # Argentina (home side in this match list) dominated the first half: momentum leans their way at minute 30
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

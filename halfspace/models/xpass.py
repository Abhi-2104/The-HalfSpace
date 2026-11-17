"""
xPass: probability a pass is completed given where it starts and ends, length, height, body part,
pressure and game situation. Passing over expected (PoE) = completions - expected completions;
shrunk toward zero by attempts, so a player needs volume before the number moves.
Without 360 defender positions (those exist for ~1/4 of matches), this is a context-only model: it
knows a long high ball into the box is hard, not that a defender stands in the lane.
"""
import json

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import GroupKFold

from halfspace import derive
from halfspace.models.xg import MODEL_DIR

CARD_PATH = MODEL_DIR / "xpass_card.json"
CAT = ["pass_height", "body_part", "pass_type", "play_pattern"]
NUM = ["x", "y", "end_x", "end_y", "pass_length", "pass_angle", "under_pressure", "dx", "dist_to_goal_end"]
SHRINK_ATTEMPTS = 400  # prior strength: PoE is pulled toward 0 like a 400-pass average player


def _passes() -> pd.DataFrame:
    ev = derive.load_events()
    p = ev[(ev["type"] == "Pass") & (ev["period"] <= 4) & ev["x"].notna() & ev["end_x"].notna() & ev["player_id"].notna()].copy()
    p["done"] = p["outcome"].isna().astype(int)
    p["dx"] = p["end_x"] - p["x"]
    p["dist_to_goal_end"] = np.hypot(120 - p["end_x"], p["end_y"] - 40)
    for c in CAT:
        p[c] = p[c].astype(object).fillna("Unknown").astype("category")
    return p


def _gbm():
    return HistGradientBoostingClassifier(max_iter=150, learning_rate=0.1, max_leaf_nodes=31, min_samples_leaf=200,
                                          categorical_features="from_dtype", random_state=0)


def train() -> dict:
    p = _passes()
    X, y, g = p[NUM + CAT], p["done"].values, p["match_id"].values
    oof = np.zeros(len(p))
    for tr, te in GroupKFold(4).split(X, y, g):
        oof[te] = _gbm().fit(X.iloc[tr], y[tr]).predict_proba(X.iloc[te])[:, 1]
    p["exp"] = oof
    base = np.full(len(p), y.mean())
    m = derive.load_matches()[["match_id", "competition_id", "season_id"]]
    pl = p.merge(m, on="match_id").groupby(["player_id", "competition_id", "season_id"]).agg(
        passes=("done", "size"), completed=("done", "sum"), expected=("exp", "sum"), avg_difficulty=("exp", lambda s: 1 - s.mean())).reset_index()
    pl = pl[pl["passes"] >= 100]
    pl["poe"] = pl["completed"] - pl["expected"]
    pl["poe_per100"] = (pl["poe"] / pl["passes"] * 100 * pl["passes"] / (pl["passes"] + SHRINK_ATTEMPTS)).round(2)
    pl["exp_pct"] = (pl["expected"] / pl["passes"] * 100).round(1)
    pl["actual_pct"] = (pl["completed"] / pl["passes"] * 100).round(1)
    pl["avg_difficulty"] = pl["avg_difficulty"].round(3)
    derive.write_table("player_xpass", pl.round(3))
    derive.write_table("pass_xpass", p[["event_id"]].assign(exp=oof.round(3)))
    card = {"name": "xPass (pass completion)", "method": "HistGradientBoosting, 4-fold CV grouped by match",
            "n_passes": int(len(p)), "completion_rate": round(float(y.mean()), 4),
            "oof_metrics": {"auc": round(roc_auc_score(y, oof), 4), "brier": round(brier_score_loss(y, oof), 5),
                            "baseline_brier": round(brier_score_loss(y, base), 5), "sum_expected": round(float(oof.sum())),
                            "sum_actual": int(y.sum())},
            "shrinkage": f"PoE per 100 passes scaled by attempts/(attempts+{SHRINK_ATTEMPTS})",
            "limits": "No defender positions: difficulty reflects geometry and context only. Pooled across competitions."}
    CARD_PATH.write_text(json.dumps(card, indent=2))
    return card

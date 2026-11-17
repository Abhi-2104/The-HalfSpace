"""
Post-shot xG (PSxG) and goalkeeper rating. PSxG = probability an ON-TARGET shot scores, given where
it is headed (placement left/right, height), how it was struck, how good the chance was (xG v2) and
how far the keeper has to move. Goals prevented = PSxG faced - goals conceded: positive means the
keeper saved more than an average keeper would. Penalties are excluded from the rating.
The keeper comes from the shot's freeze-frame, so shots whose frame lacks the keeper are not attributed.
"""
import json

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import GroupKFold

from halfspace import derive
from halfspace.models.xg import MODEL_DIR

CARD_PATH = MODEL_DIR / "goalkeeper_card.json"
ON_TARGET = {"Goal", "Saved", "Saved to Post"}
CAT = ["body_part", "technique", "shot_type"]
NUM = ["miss_centre", "height", "dist", "keeper_move", "keeper_off_line", "xg", "under_pressure"]
SHRINK_SHOTS = 40  # prior strength for goals-prevented: like 40 average shots faced


def _on_target() -> pd.DataFrame:
    s = derive.load_shots()
    s = s[(s["period"] <= 4) & s["outcome"].isin(ON_TARGET) & s["end_y"].notna() & s["end_z"].notna()].copy()
    s = s.merge(pd.read_sql("SELECT event_id, xg_v2 FROM shot_xg", derive.connect_derived()), on="event_id", how="left")
    s["xg"] = s["xg_v2"].fillna(s["xg_sb"])
    s["miss_centre"] = (s["end_y"] - 40).abs()
    s["height"] = s["end_z"]
    s["dist"] = np.hypot(120 - s["x"], s["y"] - 40)
    s["keeper_move"] = (s["keeper_y"] - s["end_y"]).abs()
    s["keeper_off_line"] = (s["keeper_y"] - 40).abs()
    for c in CAT:
        s[c] = s[c].fillna("Unknown").astype("category")
    return s.reset_index(drop=True)


def _gbm():
    return HistGradientBoostingClassifier(max_iter=200, learning_rate=0.06, max_leaf_nodes=12, min_samples_leaf=40,
                                          l2_regularization=1.0, categorical_features="from_dtype", random_state=0)


def train() -> dict:
    s = _on_target()
    X, y, g = s[NUM + CAT], s["goal"].values, s["match_id"].values
    oof = np.zeros(len(s))
    for tr, te in GroupKFold(5).split(X, y, g):
        oof[te] = _gbm().fit(X.iloc[tr], y[tr]).predict_proba(X.iloc[te])[:, 1]
    s["psxg"] = oof
    base = np.full(len(s), y.mean())  # baseline: every on-target shot scores at the average rate
    m = derive.load_matches()[["match_id", "competition_id", "season_id"]]
    k = s[(s["shot_type"] != "Penalty") & s["keeper_id"].notna()].merge(m, on="match_id")
    k["keeper_id"] = k["keeper_id"].astype(int)
    gk = k.groupby(["keeper_id", "competition_id", "season_id"]).agg(
        shots_faced=("goal", "size"), goals_conceded=("goal", "sum"), psxg_faced=("psxg", "sum")).reset_index()
    gk = gk[gk["shots_faced"] >= 20]
    gk["goals_prevented"] = (gk["psxg_faced"] - gk["goals_conceded"]).round(2)
    gk["prevented_per_100"] = (gk["goals_prevented"] / gk["shots_faced"] * 100 * gk["shots_faced"] / (gk["shots_faced"] + SHRINK_SHOTS)).round(2)
    gk["save_pct"] = ((1 - gk["goals_conceded"] / gk["shots_faced"]) * 100).round(1)
    gk["expected_save_pct"] = ((1 - gk["psxg_faced"] / gk["shots_faced"]) * 100).round(1)
    derive.write_table("goalkeeper_rating", gk.round(3))
    derive.write_table("shot_psxg", s[["event_id", "match_id"]].assign(psxg=oof.round(4)))
    card = {"name": "Post-shot xG / goalkeeper", "method": "HistGradientBoosting on on-target shots, 5-fold CV grouped by match",
            "n_on_target_shots": int(len(s)), "n_goals": int(y.sum()), "keeper_attributed_share": round(float(s["keeper_id"].notna().mean()), 3),
            "oof_metrics": {"psxg": {"auc": round(roc_auc_score(y, oof), 4), "brier": round(brier_score_loss(y, oof), 5)},
                            "constant_rate_baseline": {"brier": round(brier_score_loss(y, base), 5)}},
            "shrinkage": f"goals prevented per 100 shots scaled by shots/(shots+{SHRINK_SHOTS})",
            "limits": "Only shots with the keeper visible in the freeze-frame are attributed. Ratings are noisy under ~150 shots faced; "
                      "no information on keeper distribution, claims or sweeping. Penalties excluded."}
    CARD_PATH.write_text(json.dumps(card, indent=2))
    return card

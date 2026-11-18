"""
xG v2: gradient-boosted shot model using what a shot event really knows - location, body part,
technique, shot type, pressure, play pattern, and the defenders/keeper from the shot's own
freeze-frame (present on ~99% of shots, even in competitions without 360).

Trained on our own features only. StatsBomb's `statsbomb_xg` is NOT a feature; it's reported
as a benchmark. Out-of-fold predictions (grouped by match, so no match is in both train and
test) are stored for every shot, so the numbers shown in the app were never fit on that shot.
"""
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.model_selection import GroupKFold

from halfspace import derive

MODEL_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "models"
MODEL_PATH, CARD_PATH = MODEL_DIR / "xg_v2.joblib", MODEL_DIR / "xg_v2_card.json"
GOAL_Y, GOAL_W = 40.0, 7.32

CATEGORICAL = ["body_part", "technique", "shot_type", "play_pattern"]
NUMERIC = ["dist", "angle", "under_pressure", "first_time", "has_ff", "n_def_cone", "nearest_def", "n_def_5",
           "keeper_dist", "keeper_off_line", "n_team_vis"]
FEATURES = NUMERIC + CATEGORICAL
LITE = ["dist", "angle", "is_header"]  # the old xG-lite baseline, re-fit here for a fair comparison


def featurize(s: pd.DataFrame) -> pd.DataFrame:
    dx = 120.0 - s["x"]
    dy = s["y"] - GOAL_Y
    f = pd.DataFrame(index=s.index)
    f["dist"] = np.hypot(dx, dy)
    f["angle"] = np.where(dx > 0, np.abs(np.arctan2(GOAL_W * dx, dx ** 2 + dy ** 2 - (GOAL_W / 2) ** 2)), 0.0)
    for c in ("under_pressure", "first_time", "has_ff", "n_def_cone", "nearest_def", "n_def_5", "n_team_vis"):
        f[c] = s[c].astype(float)
    f["keeper_dist"] = np.hypot(s["keeper_x"] - s["x"], s["keeper_y"] - s["y"])
    f["keeper_off_line"] = (s["keeper_y"] - GOAL_Y).abs()
    for c in CATEGORICAL:
        f[c] = s[c].fillna("Unknown").astype("category")
    f["is_header"] = (s["body_part"] == "Head").astype(float)
    return f


def _gbm() -> HistGradientBoostingClassifier:
    return HistGradientBoostingClassifier(max_iter=250, learning_rate=0.06, max_leaf_nodes=15,
                                          min_samples_leaf=40, l2_regularization=1.0,
                                          categorical_features="from_dtype", random_state=0)


def _metrics(y, p) -> dict:
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return {"auc": round(roc_auc_score(y, p), 4), "brier": round(brier_score_loss(y, p), 5),
            "log_loss": round(log_loss(y, p), 5), "goals": int(y.sum()), "sum_xg": round(float(p.sum()), 1)}


def train() -> dict:
    shots = derive.load_shots()
    shots = shots[(shots["period"] <= 4) & shots["x"].notna()].reset_index(drop=True)
    X, y, groups = featurize(shots), shots["goal"].values, shots["match_id"].values

    oof, oof_lite = np.zeros(len(X)), np.zeros(len(X))
    for tr, te in GroupKFold(5).split(X, y, groups):
        oof[te] = _gbm().fit(X.iloc[tr][FEATURES], y[tr]).predict_proba(X.iloc[te][FEATURES])[:, 1]
        oof_lite[te] = LogisticRegression(max_iter=500).fit(X.iloc[tr][LITE], y[tr]).predict_proba(X.iloc[te][LITE])[:, 1]

    sb = shots["xg_sb"].values
    ok = ~np.isnan(sb)
    deciles = pd.qcut(oof, 10, duplicates="drop")
    calib = pd.DataFrame({"p": oof, "y": y}).groupby(deciles, observed=True).agg(pred=("p", "mean"), actual=("y", "mean"), n=("y", "size"))
    final = _gbm().fit(X[FEATURES], y)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(final, MODEL_PATH)

    # reference values for the "why this number" attribution: median numeric / mode categorical
    ref = {c: float(X[c].median()) for c in NUMERIC} | {c: X[c].mode()[0] for c in CATEGORICAL}
    card = {
        "name": "xG v2", "method": "HistGradientBoostingClassifier, 5-fold CV grouped by match",
        "n_shots": int(len(X)), "n_goals": int(y.sum()),
        "features": FEATURES, "reference": ref,
        "oof_metrics": {"xg_v2": _metrics(y, oof), "xg_lite_refit": _metrics(y, oof_lite),
                        "statsbomb_xg_benchmark": _metrics(y[ok], sb[ok])},
        "calibration": [{"pred": round(r.pred, 4), "actual": round(r.actual, 4), "n": int(r.n)} for r in calib.itertuples()],
        "limits": "Open-play and set-piece shots pooled; defenders seen only if StatsBomb freeze-frame lists them; "
                  "men's and women's data pooled; no goalkeeper quality or shooter skill.",
    }
    CARD_PATH.write_text(json.dumps(card, indent=2, default=float))
    out = shots[["event_id", "match_id"]].assign(xg_v2=oof.round(4), xg_lite=oof_lite.round(4))
    derive.write_table("shot_xg", out)
    return card


_model, _model_mtime = None, 0.0


def _load():
    """Reload when the file changes, so a rebuild from the admin portal is picked up without a restart."""
    global _model, _model_mtime
    m = MODEL_PATH.stat().st_mtime
    if _model is None or m != _model_mtime:
        _model, _model_mtime = joblib.load(MODEL_PATH), m
    return _model


def predict(shots: pd.DataFrame) -> np.ndarray:
    return _load().predict_proba(featurize(shots)[FEATURES])[:, 1]


def explain(shot_row: pd.Series) -> dict:
    """Approximate attribution: reset one feature at a time to the typical value, report the change.
    Not exact Shapley values; labeled as such in the UI. Positive = pushes xG up."""
    card = json.loads(CARD_PATH.read_text())
    df = pd.DataFrame([shot_row])
    base_f = featurize(df)[FEATURES]
    base = float(_load().predict_proba(base_f)[0, 1])
    parts = []
    for c in FEATURES:
        if pd.isna(base_f[c].iloc[0]):
            continue  # a missing input (e.g. keeper not in the freeze-frame) has no meaningful "effect"
        alt = base_f.copy()
        alt[c] = pd.Categorical([card["reference"][c]], categories=base_f[c].cat.categories.union([card["reference"][c]])) \
            if c in CATEGORICAL else card["reference"][c]
        try:
            delta = base - float(_load().predict_proba(alt)[0, 1])
        except ValueError:
            continue
        parts.append({"feature": c, "value": str(base_f[c].iloc[0]) if c in CATEGORICAL else round(float(base_f[c].iloc[0]), 2),
                      "effect": round(delta, 4)})
    parts.sort(key=lambda p: -abs(p["effect"]))
    return {"xg": round(base, 4), "factors": parts[:6], "method": "one-at-a-time reset to typical value (approximate)"}


def stored_xg(match_id: int) -> dict[str, float]:
    """event_id -> out-of-fold xG v2 for one match (empty if the table isn't built yet)."""
    try:
        conn = derive.connect_derived()
        rows = conn.execute("SELECT event_id, xg_v2 FROM shot_xg WHERE match_id = ?", (match_id,)).fetchall()
        conn.close()
    except Exception:
        return {}
    return {r["event_id"]: r["xg_v2"] for r in rows}


_shots_cache, _shots_mtime = None, 0.0


def explain_event(event_id: str) -> dict | None:
    global _shots_cache, _shots_mtime
    m = (derive.OUT / "shots.pkl").stat().st_mtime
    if _shots_cache is None or m != _shots_mtime:
        _shots_cache, _shots_mtime = derive.load_shots().set_index("event_id"), m
    if event_id not in _shots_cache.index:
        return None
    return {"event_id": event_id, **explain(_shots_cache.loc[event_id])}

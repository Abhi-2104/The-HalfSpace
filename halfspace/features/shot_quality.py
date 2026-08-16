"""
Shot-quality model ("xG-lite"): logistic regression on distance/angle/body-part,
trained on real shot outcomes from the ingested dataset. This is deliberately
a small, fully-inspectable model (3 features, coefficients printable) rather
than a black-box vendor xG number - matches the project's explainability
principle (a result should be able to answer "why did the system reach this
conclusion", and "trust our number" isn't an answer).

Not StatsBomb's own xG field - this is trained fresh on our data so the
methodology is ours to inspect and defend, not imported credibility.
"""
import json
import math
import sqlite3
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, brier_score_loss

MODEL_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "models" / "shot_xg.json"
GOAL_X, GOAL_Y = 120.0, 40.0
GOAL_WIDTH = 7.32


def _shot_features(x: float, y: float, is_header: bool) -> list[float]:
    dx = GOAL_X - x
    dist = math.hypot(dx, y - GOAL_Y)
    if dx > 0:
        angle = abs(math.atan2(GOAL_WIDTH * dx, dx ** 2 + (y - GOAL_Y) ** 2 - (GOAL_WIDTH / 2) ** 2))
    else:
        angle = 0.0
    return [dist, angle, 1.0 if is_header else 0.0]


def _training_rows(conn: sqlite3.Connection):
    rows = conn.execute(
        """SELECT x, y, outcome_name, body_part FROM event
           WHERE type_name = 'Shot' AND period IN (1,2,3,4) AND x IS NOT NULL"""
    ).fetchall()
    X, y = [], []
    for r in rows:
        is_header = (r["body_part"] == "Head")
        X.append(_shot_features(r["x"], r["y"], is_header))
        y.append(1 if r["outcome_name"] == "Goal" else 0)
    return np.array(X), np.array(y)


def train(conn: sqlite3.Connection) -> dict:
    """Fit the model, evaluate on a held-out split, save coefficients. Returns eval metrics."""
    X, y = _training_rows(conn)
    if len(X) < 200:
        raise ValueError(f"only {len(X)} shots available - too few to train a shot-quality model on")

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    model = LogisticRegression()
    model.fit(X_train, y_train)

    probs = model.predict_proba(X_test)[:, 1]
    auc = roc_auc_score(y_test, probs)
    brier = brier_score_loss(y_test, probs)

    result = {
        "n_shots_total": len(X), "n_goals_total": int(y.sum()),
        "coefficients": {"distance_m": model.coef_[0][0], "angle_rad": model.coef_[0][1], "is_header": model.coef_[0][2]},
        "intercept": model.intercept_[0],
        "eval": {"auc": round(auc, 3), "brier_score": round(brier, 4), "n_test": len(y_test)},
    }
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    MODEL_PATH.write_text(json.dumps(result, indent=2))
    return result


def _load() -> dict:
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"no trained model at {MODEL_PATH} - run scripts/train_shot_model.py first")
    return json.loads(MODEL_PATH.read_text())


def score_shot(x: float, y: float, is_header: bool = False) -> float:
    """P(goal) for a shot at (x, y) - our own xG-lite, not StatsBomb's."""
    params = _load()
    feats = _shot_features(x, y, is_header)
    coef = params["coefficients"]
    z = params["intercept"] + coef["distance_m"] * feats[0] + coef["angle_rad"] * feats[1] + coef["is_header"] * feats[2]
    return 1 / (1 + math.exp(-z))

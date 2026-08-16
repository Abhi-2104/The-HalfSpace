#!/usr/bin/env python3
"""CLI: train the shot-quality (xG-lite) model on the ingested dataset, print eval metrics."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from halfspace import db
from halfspace.features import shot_quality


def main():
    conn = db.connect()
    result = shot_quality.train(conn)
    print(f"trained on {result['n_shots_total']} shots ({result['n_goals_total']} goals)")
    print(f"held-out eval: AUC={result['eval']['auc']}, Brier={result['eval']['brier_score']} (n={result['eval']['n_test']})")
    print("coefficients (higher distance/angle -> lower P(goal) is expected, header should be negative):")
    for k, v in result["coefficients"].items():
        print(f"  {k}: {v:.4f}")
    print(f"intercept: {result['intercept']:.4f}")
    print(f"saved to {shot_quality.MODEL_PATH}")


if __name__ == "__main__":
    main()

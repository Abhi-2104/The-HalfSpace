"""
On-ball value (VAEP-style): every on-ball action is valued by how it changes the chance that its team
scores, and the chance it concedes, within the next 10 actions.
  value(a) = [P_score(after a) - P_score(before a)] - [P_concede(after a) - P_concede(before a)]
Probabilities come from gradient-boosted models on the last three actions (type, place, outcome,
whose action). Out-of-fold by match. Open-play passes/carries/dribbles/shots and defensive actions;
set-piece restarts are valued too, so deliveries from corners are credited to the taker.
Season values are shrunk toward the pool mean by minutes.
"""
import json

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupKFold

from halfspace import derive
from halfspace.models.xg import MODEL_DIR

CARD_PATH = MODEL_DIR / "vaep_card.json"
HORIZON = 10
TYPES = ["Pass", "Carry", "Dribble", "Shot", "Interception", "Ball Recovery", "Clearance", "Duel", "Block", "Foul Won",
         "Foul Committed", "Miscontrol", "Dispossessed", "Dribbled Past", "Goal Keeper"]
SHRINK_MINUTES = 500


def _prepare() -> pd.DataFrame:
    ev = derive.load_events()
    ev = ev[(ev["period"] <= 4) & ev["type"].isin(TYPES + ["Own Goal For"]) & ev["team_id"].notna()].sort_values(["match_id", "idx"]).reset_index(drop=True)
    goal = ((ev["type"] == "Shot") & (ev["outcome"] == "Goal")) | (ev["type"] == "Own Goal For")
    ev["goal_team"] = np.where(goal, ev["team_id"], np.nan)
    return ev


def _labels(ev: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """scores[i]: does action i's team score within the next HORIZON actions (same match)? concedes[i]: opponent does."""
    n = len(ev)
    team = ev["team_id"].values
    gt = ev["goal_team"].values
    match = ev["match_id"].values
    s, c = np.zeros(n, dtype=np.int8), np.zeros(n, dtype=np.int8)
    for h in range(0, HORIZON):
        idx = np.arange(n - h)
        ok = match[idx] == match[idx + h]
        g = gt[idx + h]
        s[idx] |= (ok & (g == team[idx])).astype(np.int8)
        c[idx] |= (ok & (g == g) & (g != team[idx])).astype(np.int8)
    return s, c


def _features(ev: pd.DataFrame) -> pd.DataFrame:
    f = pd.DataFrame(index=ev.index)
    ok = ev["outcome"].isna() | (ev["outcome"].isin(["Complete", "Won", "Success", "Saved", "Goal"]))
    for lag in (0, 1, 2):
        sh = ev.shift(lag)
        same = (sh["team_id"] == ev["team_id"]) & (sh["match_id"] == ev["match_id"])
        f[f"type{lag}"] = sh["type"].astype(object).fillna("None").astype("category")
        f[f"x{lag}"], f[f"y{lag}"] = sh["x"], sh["y"]
        f[f"ex{lag}"] = sh["end_x"].fillna(sh["x"])
        f[f"ey{lag}"] = sh["end_y"].fillna(sh["y"])
        f[f"same{lag}"] = same.astype(float) if lag else 1.0
        f[f"ok{lag}"] = ok.shift(lag).astype(float)
    f["pressure"] = ev["under_pressure"].astype(float)
    f["dist_goal"] = np.hypot(120 - f["ex0"], f["ey0"] - 40)
    f["pattern"] = ev["play_pattern"].astype(object).fillna("Unknown").astype("category")
    return f


def _gbm():
    return HistGradientBoostingClassifier(max_iter=120, learning_rate=0.1, max_leaf_nodes=31, min_samples_leaf=300,
                                          categorical_features="from_dtype", random_state=0)


def train() -> dict:
    ev = _prepare()
    s, c = _labels(ev)
    F = _features(ev)
    groups = ev["match_id"].values
    ps, pc = np.zeros(len(ev)), np.zeros(len(ev))
    for tr, te in GroupKFold(3).split(F, s, groups):
        ps[te] = _gbm().fit(F.iloc[tr], s[tr]).predict_proba(F.iloc[te])[:, 1]
        pc[te] = _gbm().fit(F.iloc[tr], c[tr]).predict_proba(F.iloc[te])[:, 1]
    # value of an action = change in probability from the state before it (previous action, same perspective)
    prev_same = ((ev["team_id"] == ev["team_id"].shift(1)) & (ev["match_id"] == ev["match_id"].shift(1))).values
    pps, ppc = np.roll(ps, 1), np.roll(pc, 1)
    before_s = np.where(prev_same, pps, ppc)  # if possession changed, the previous state's "concede" is our "score" chance
    before_c = np.where(prev_same, ppc, pps)
    first = ev["match_id"].ne(ev["match_id"].shift(1)).values
    before_s, before_c = np.where(first, 0.0, before_s), np.where(first, 0.0, before_c)
    ev["value"] = (ps - before_s) - (pc - before_c)

    v = ev[ev["type"] != "Own Goal For"].merge(derive.load_matches()[["match_id", "competition_id", "season_id"]], on="match_id")
    v = v[v["player_id"].notna()]
    v["player_id"] = v["player_id"].astype(int)
    v["kind"] = np.select([v["type"].isin(["Pass"]), v["type"].isin(["Carry", "Dribble"]), v["type"] == "Shot"], ["pass", "carry", "shot"], "defence")
    key = ["player_id", "competition_id", "season_id"]
    a = v.pivot_table(index=key, columns="kind", values="value", aggfunc="sum", fill_value=0).reset_index()
    a["total"] = a[["pass", "carry", "shot", "defence"]].sum(axis=1)
    from halfspace.models.profiles import _minutes
    mins = _minutes().merge(derive.load_matches()[["match_id", "competition_id", "season_id"]], on="match_id").groupby(key)["minutes"].sum().rename("minutes").reset_index()
    a = a.merge(mins, on=key)
    a = a[a["minutes"] >= 300]
    a["per90"] = a["total"] / a["minutes"] * 90
    prof = pd.read_sql("SELECT player_id, competition_id, season_id, position_group FROM player_profile", derive.connect_derived())
    a = a.merge(prof, on=key, how="left")
    pool = ["competition_id", "season_id", "position_group"]
    mu = a.groupby(pool)["per90"].transform("mean")
    w = a["minutes"] / (a["minutes"] + SHRINK_MINUTES)
    a["per90_adj"] = w * a["per90"] + (1 - w) * mu
    a["percentile"] = a.groupby(pool)["per90_adj"].rank(pct=True).mul(100).round(0)
    for k in ("pass", "carry", "shot", "defence"):
        a[f"{k}_p90"] = a[k] / a["minutes"] * 90
    derive.write_table("player_vaep", a.drop(columns=["pass", "carry", "shot", "defence"]).round(4))

    tm = ev.groupby(["match_id", "team_id"])["value"].sum().rename("v").reset_index()
    goals = derive.load_shots().groupby(["match_id", "team_id"])["goal"].sum().rename("g").reset_index()
    tm = tm.merge(goals, on=["match_id", "team_id"], how="left").fillna({"g": 0})
    card = {"name": "On-ball value (VAEP-style)", "method": f"2 gradient-boosted models (score/concede within {HORIZON} actions), 3-fold CV grouped by match",
            "n_actions": int(len(ev)), "oof_auc": {"scores": round(roc_auc_score(s, ps), 4), "concedes": round(roc_auc_score(c, pc), 4)},
            "sanity": {"corr_team_match_value_vs_goals": round(float(tm[["v", "g"]].corr().iloc[0, 1]), 3),
                       "mean_value_of_shot": round(float(ev.loc[ev["type"] == "Shot", "value"].mean()), 4),
                       "mean_value_of_pass": round(float(ev.loc[ev["type"] == "Pass", "value"].mean()), 5)},
            "shrinkage": f"per-90 value shrunk toward the pool mean with weight minutes/(minutes+{SHRINK_MINUTES})",
            "limits": "Credits the on-ball action, not off-ball runs or the receiver's contribution; goalkeepers' values reflect distribution only."}
    CARD_PATH.write_text(json.dumps(card, indent=2))
    return card

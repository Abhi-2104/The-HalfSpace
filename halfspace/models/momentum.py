"""
Match momentum: who is on top at each minute, from what the teams just did. Not a prediction.

  threat(team, minute) = xT gained by completed open-play passes and carries + xG of shots,
                         summed over the trailing WINDOW minutes (xT and xG are both in "goals")
  momentum = 100 * (home_threat - away_threat) / (home_threat + away_threat + PRIOR)   in (-100, 100)

Positive = home on top, negative = away. PRIOR keeps quiet spells near zero. Regulation time
(periods 1-2) only. Validation: does momentum at minute t say anything about who scores in t+1..t+5?
"""
import json

import numpy as np
import pandas as pd

from halfspace import derive
from halfspace.models import xt
from halfspace.models.xg import MODEL_DIR

CARD_PATH = MODEL_DIR / "momentum_card.json"
WINDOW = 10
PRIOR = 0.3  # ~half the median 10-minute combined threat: quiet spells move momentum less
MINUTES = 96  # 0..95 covers both halves and stoppage time


def _per_minute() -> pd.DataFrame:
    xtv, mv = xt.fit()
    mv = mv[mv["ok"] & (mv["period"] <= 2)].copy()
    mv["gain"] = np.clip(xtv[mv["z1"].values] - xtv[mv["z0"].values], 0, None)
    mv["minute"] = (mv["t"] // 60).clip(upper=MINUTES - 1).astype(int)
    a = mv.groupby(["match_id", "team_id", "minute"])["gain"].sum().rename("xt")
    s = derive.load_shots()
    s = s[s["period"] <= 2].merge(pd.read_sql("SELECT event_id, xg_v2 FROM shot_xg", derive.connect_derived()), on="event_id", how="left")
    s["xg"] = s["xg_v2"].fillna(s["xg_sb"]).fillna(0.05)
    s["minute"] = (s["t"] // 60).clip(upper=MINUTES - 1).astype(int)
    b = s.groupby(["match_id", "team_id", "minute"])["xg"].sum()
    return pd.concat([a, b], axis=1).fillna(0).reset_index()


def _series(df: pd.DataFrame, match_id, team) -> tuple[np.ndarray, np.ndarray]:
    xt_, xg_ = np.zeros(MINUTES), np.zeros(MINUTES)
    d = df[(df["match_id"] == match_id) & (df["team_id"] == team)]
    np.add.at(xt_, d["minute"].values, d["xt"].values)
    np.add.at(xg_, d["minute"].values, d["xg"].values)
    return xt_, xg_


def _trail(a: np.ndarray) -> np.ndarray:
    c = np.concatenate([[0], np.cumsum(a)])
    idx = np.arange(1, MINUTES + 1)
    return c[idx] - c[np.maximum(idx - WINDOW, 0)]


def train() -> dict:
    pm = _per_minute()
    matches = derive.load_matches()
    matches = matches[matches["match_id"].isin(pm["match_id"].unique())]
    by = {k: g for k, g in pm.groupby("match_id")}
    rows, pairs = [], []
    goals = derive.load_shots()
    goals = goals[(goals["goal"] == 1) & (goals["period"] <= 2)]
    gby = {k: g for k, g in goals.groupby("match_id")}
    for r in matches.itertuples():
        df = by.get(r.match_id)
        if df is None:
            continue
        hx, hg = _series(df, r.match_id, r.home_team_id)
        ax, ag = _series(df, r.match_id, r.away_team_id)
        th, ta = _trail(hx + hg), _trail(ax + ag)
        mom = 100 * (th - ta) / (th + ta + PRIOR)
        rows.append(pd.DataFrame({"match_id": r.match_id, "minute": np.arange(MINUTES), "momentum": mom.round(1),
                                  "home_threat": th.round(4), "away_threat": ta.round(4)}))
        g = gby.get(r.match_id)
        if g is not None:
            gm = (g["t"] // 60).clip(upper=MINUTES - 1).astype(int)
            hgm = np.bincount(gm[g["team_id"] == r.home_team_id], minlength=MINUTES)
            agm = np.bincount(gm[g["team_id"] == r.away_team_id], minlength=MINUTES)
            net = hgm - agm
        else:
            net = np.zeros(MINUTES)
        nxt = np.array([net[m + 1: m + 6].sum() for m in range(MINUTES)])  # goals in the following 5 minutes
        pairs.append(pd.DataFrame({"momentum": mom, "next5": nxt, "minute": np.arange(MINUTES)}))
    out = pd.concat(rows, ignore_index=True)
    derive.write_table("momentum", out)
    pr = pd.concat(pairs, ignore_index=True)
    pr = pr[pr["minute"] < 90]
    pr["bucket"] = pd.cut(pr["momentum"], [-101, -50, -20, 20, 50, 101], labels=["away >50", "away 20-50", "even", "home 20-50", "home >50"])
    byb = pr.groupby("bucket", observed=True)["next5"].agg(["mean", "size"]).round(4)
    shuffled = pr["next5"].sample(frac=1, random_state=0).values
    card = {"name": "Match momentum", "method": f"trailing {WINDOW}-minute threat share (xT gained + xG), prior {PRIOR}, -100 to 100",
            "n_matches": int(out["match_id"].nunique()),
            "validation": {"corr_momentum_vs_net_goals_next_5min": round(float(np.corrcoef(pr["momentum"], pr["next5"])[0, 1]), 4),
                           "corr_with_shuffled_goals_control": round(float(np.corrcoef(pr["momentum"], shuffled)[0, 1]), 4),
                           "mean_net_goals_next_5min_by_momentum": {k: {"net_goals": float(v["mean"]), "minutes": int(v["size"])} for k, v in byb.iterrows()}},
            "limits": "Descriptive, not predictive: it summarizes the last 10 minutes of play. Open-play passes and carries plus shots only; "
                      "no tracking, no cards or substitutions. Regulation time."}
    CARD_PATH.write_text(json.dumps(card, indent=2))
    return card


def match_story(conn, match_id: int) -> dict | None:
    c = derive.connect_derived()
    curve = pd.read_sql("SELECT minute, momentum, home_threat, away_threat FROM momentum WHERE match_id = ? ORDER BY minute", c, params=(match_id,))
    if curve.empty:
        return None
    m = conn.execute("SELECT home_team_id, away_team_id FROM match WHERE id = ?", (match_id,)).fetchone()
    if m is None:
        return None
    s = pd.read_sql("SELECT x.event_id, x.xg_v2 FROM shot_xg x WHERE x.match_id = ?", c, params=(match_id,))
    sh = derive.load_shots()
    sh = sh[(sh["match_id"] == match_id) & (sh["period"] <= 2)].merge(s, on="event_id", how="left").sort_values("t")
    sh["xg"] = sh["xg_v2"].fillna(sh["xg_sb"]).fillna(0.05)
    ids = [int(p) for p in sh["player_id"].dropna().unique()]
    names = {r["id"]: r["name"] for r in conn.execute(f"SELECT id, name FROM player WHERE id IN ({','.join(map(str, ids)) or '0'})")}
    moments = []
    for r in sh.itertuples():
        if r.goal == 1 or r.xg >= 0.25:
            mm = min(int(r.t // 60), len(curve) - 1)
            side = 1 if r.team_id == m["home_team_id"] else -1
            moments.append({"minute": mm, "kind": "goal" if r.goal else "big_chance", "team_id": int(r.team_id),
                            "player": names.get(int(r.player_id)) if r.player_id == r.player_id else None,
                            "xg": round(float(r.xg), 2), "event_id": r.event_id,
                            "momentum_before": float(curve.iloc[max(mm - 1, 0)]["momentum"]) * side})
    race = {}
    for side, team in (("home", m["home_team_id"]), ("away", m["away_team_id"])):
        by = sh[sh["team_id"] == team].groupby((sh["t"] // 60).clip(upper=len(curve) - 1).astype(int))["xg"].sum()
        race[side] = [round(float(v), 3) for v in by.reindex(range(len(curve)), fill_value=0).cumsum()]
    return {"match_id": match_id, "window_minutes": WINDOW, "minutes": curve["minute"].tolist(),
            "momentum": curve["momentum"].tolist(), "home_threat": curve["home_threat"].tolist(), "away_threat": curve["away_threat"].tolist(),
            "xg_cumulative": race, "moments": moments,
            "note": "Momentum is +100 when only the home team created threat in the last 10 minutes, -100 for only the away team. "
                    "Descriptive, not a prediction. Regulation time only. momentum_before is from the scoring/shooting team's point of view."}

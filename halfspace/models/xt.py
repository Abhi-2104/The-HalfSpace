"""
xT (expected threat): value of each pitch zone = chance the team scores from it, via an iterated
Markov model over open-play moves (passes, carries) and shots. A completed pass or carry earns
xT(end zone) - xT(start zone). Open play only (set-piece restarts would reward corner deliveries).
Counts are pooled across all competitions; zone shot quality uses our xG v2.
"""
import json

import numpy as np
import pandas as pd

from halfspace import derive
from halfspace.models.xg import MODEL_DIR

NX, NY = 16, 12
CARD_PATH, GRID_PATH = MODEL_DIR / "xt_card.json", MODEL_DIR / "xt_grid.json"
OPEN_PLAY_PASS = {None, "Recovery", "Interception"}


def zone(x, y):
    xi = np.clip((np.asarray(x, dtype=float) / 120 * NX).astype(int), 0, NX - 1)
    yi = np.clip((np.asarray(y, dtype=float) / 80 * NY).astype(int), 0, NY - 1)
    return xi * NY + yi  # flat index


def _moves(ev: pd.DataFrame) -> pd.DataFrame:
    m = ev[(ev["period"] <= 4) & ev["type"].isin(["Pass", "Carry"]) & ev["x"].notna() & ev["end_x"].notna()].copy()
    pt = m["pass_type"].astype(object).where(m["pass_type"].notna(), None)
    m = m[(m["type"] == "Carry") | pt.isin(OPEN_PLAY_PASS)]
    m["ok"] = m["outcome"].isna()  # StatsBomb: no outcome on a pass = completed; carries are never failed
    m["z0"], m["z1"] = zone(m["x"], m["y"]), zone(m["end_x"], m["end_y"])
    return m


def fit() -> tuple[np.ndarray, pd.DataFrame]:
    ev = derive.load_events()
    shots = derive.load_shots()
    shots = shots[(shots["period"] <= 4) & shots["x"].notna()]
    xg = pd.read_sql("SELECT event_id, xg_v2 FROM shot_xg", derive.connect_derived())
    shots = shots.merge(xg, on="event_id", how="left")
    shots["xg"] = shots["xg_v2"].fillna(shots["xg_sb"]).fillna(0.05)
    shots["z"] = zone(shots["x"], shots["y"])
    m = _moves(ev)

    n = NX * NY
    n_moves = np.bincount(m["z0"], minlength=n).astype(float)
    n_shots = np.bincount(shots["z"], minlength=n).astype(float)
    g = np.divide(np.bincount(shots["z"], weights=shots["xg"], minlength=n), n_shots, out=np.zeros(n), where=n_shots > 0)
    total = n_moves + n_shots
    p_shot = np.divide(n_shots, total, out=np.zeros(n), where=total > 0)
    ok = m[m["ok"]]
    T = np.zeros((n, n))
    np.add.at(T, (ok["z0"].values, ok["z1"].values), 1.0)
    T = np.divide(T, total[:, None], out=np.zeros_like(T), where=total[:, None] > 0)  # failed moves leak mass: value 0
    xt = np.zeros(n)
    for _ in range(80):
        xt = p_shot * g + T @ xt
    return xt, m


def train() -> dict:
    xt, m = fit()
    m = m[m["ok"]].copy()
    m["gain"] = xt[m["z1"].values] - xt[m["z0"].values]
    m["is_pass"] = m["type"] == "Pass"
    matches = derive.load_matches()[["match_id", "competition_id", "season_id", "gender"]]
    m = m.merge(matches, on="match_id")
    pos = m[m["gain"] > 0]
    agg = m.groupby(["player_id", "competition_id", "season_id", "team_id"]).apply(
        lambda d: pd.Series({"xt_pass": d.loc[d["is_pass"], "gain"].sum(), "xt_carry": d.loc[~d["is_pass"], "gain"].sum(),
                             "n_moves": len(d)}), include_groups=False).reset_index()
    agg["xt_total"] = agg["xt_pass"] + agg["xt_carry"]
    derive.write_table("player_xt", agg.round(4))
    pm = m[m["player_id"].notna()].assign(player_id=lambda d: d["player_id"].astype(int)).groupby(["match_id", "player_id", "team_id"])["gain"].apply(
        lambda s: s.clip(lower=0).sum()).rename("xt").reset_index()
    derive.write_table("player_match_xt", pm.round(4))

    # team-match totals, used for the sanity check and as a match-level number
    tm = pos.groupby(["match_id", "team_id"])["gain"].sum().rename("xt_created").reset_index()
    goals = derive.load_shots().groupby(["match_id", "team_id"])["goal"].sum().rename("goals").reset_index()
    tm = tm.merge(goals, on=["match_id", "team_id"], how="left").fillna({"goals": 0})
    derive.write_table("team_match_xt", tm.round(4))
    card = {"name": "xT (expected threat)", "method": f"{NX}x{NY} zone Markov model, 80 iterations, open-play passes and carries",
            "n_moves": int(len(m)), "grid": xt.reshape(NX, NY).round(4).tolist(),
            "sanity": {"corr_team_match_xt_vs_goals": round(float(tm[["xt_created", "goals"]].corr().iloc[0, 1]), 3),
                       "xt_at_own_box": round(float(xt.reshape(NX, NY)[0].mean()), 4),
                       "xt_at_opp_box_centre": round(float(xt.reshape(NX, NY)[-2, NY // 2]), 4)},
            "limits": "Zone-based: ignores defenders and pass difficulty. Open play only. Men's and women's pooled."}
    CARD_PATH.write_text(json.dumps(card, indent=2))
    GRID_PATH.write_text(json.dumps({"nx": NX, "ny": NY, "values": card["grid"]}))
    return card

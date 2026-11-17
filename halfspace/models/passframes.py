"""
360-powered pass models. For every pass that has a freeze-frame (about a quarter of matches):
  - line-breaking: how many visible opponents the pass bypasses (their x lies between pass start and
    end), whether it completed, and how many defenders stood near the receiver;
  - xPass v2: the xPass model plus these defender features, compared with v1 on the same passes.
Counts are lower bounds: the freeze-frame lists only players the broadcast camera could see.
"""
import json
import math
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold
from sklearn.metrics import brier_score_loss, roc_auc_score

from halfspace import derive
from halfspace.models import xpass
from halfspace.models.xg import MODEL_DIR

CARD_PATH = MODEL_DIR / "passframes_card.json"
PKL = derive.OUT / "pass_frames.pkl"
LINE_BREAK_MIN_BYPASSED, LINE_BREAK_MIN_DX = 6, 8.0  # >=6 of ~8 visible opponents: 8.5% of passes attempted, 4.5% completed


def pass_frame_features(sx, sy, ex, ey, frame) -> dict:
    opp = [p["location"] for p in frame if not p.get("teammate") and not p.get("keeper")]
    lo, hi = min(sx, ex), max(sx, ex)
    return {"n_opp_vis": len(opp),
            "n_bypassed": sum(lo < x < hi for x, _ in opp) if ex > sx else 0,
            "opp_near_start": sum(math.hypot(x - sx, y - sy) <= 5 for x, y in opp),
            "opp_near_end": sum(math.hypot(x - ex, y - ey) <= 5 for x, y in opp)}


def _worker(match_id: int):
    f360 = derive.RAW / "three-sixty" / f"{match_id}.json"
    try:
        frames = {fr["event_uuid"]: fr["freeze_frame"] for fr in json.loads(f360.read_text())}
        events = json.loads((derive.RAW / "events" / f"{match_id}.json").read_text())
    except (json.JSONDecodeError, FileNotFoundError):
        return []
    rows = []
    for e in events:
        if e["type"]["name"] != "Pass" or e["id"] not in frames or e["period"] > 4:
            continue
        end = e["pass"].get("end_location")
        if not end or not e.get("location"):
            continue
        rows.append({"match_id": match_id, "event_id": e["id"],
                     **pass_frame_features(e["location"][0], e["location"][1], end[0], end[1], frames[e["id"]])})
    return rows


def build(workers: int = 12) -> pd.DataFrame:
    have = set(pd.read_pickle(PKL)["match_id"]) if PKL.exists() else set()
    todo = [int(f.stem) for f in sorted((derive.RAW / "three-sixty").glob("*.json")) if f.stat().st_size > 10 and int(f.stem) not in have]
    old = pd.read_pickle(PKL) if PKL.exists() else pd.DataFrame()
    if todo:
        with ProcessPoolExecutor(workers) as pool:
            parts = [pd.DataFrame(r) for r in pool.map(_worker, todo, chunksize=4) if r]
        old = pd.concat([old] + parts, ignore_index=True)
        old.to_pickle(PKL)
    return old


def train() -> dict:
    pf = build()
    p = xpass._passes().merge(pf, on=["match_id", "event_id"])
    cols_v2 = xpass.NUM + ["n_opp_vis", "n_bypassed", "opp_near_start", "opp_near_end"] + xpass.CAT
    y, g = p["done"].values, p["match_id"].values
    o1, o2 = np.zeros(len(p)), np.zeros(len(p))
    for tr, te in GroupKFold(4).split(p, y, g):
        o1[te] = xpass._gbm().fit(p.iloc[tr][xpass.NUM + xpass.CAT], y[tr]).predict_proba(p.iloc[te][xpass.NUM + xpass.CAT])[:, 1]
        o2[te] = xpass._gbm().fit(p.iloc[tr][cols_v2], y[tr]).predict_proba(p.iloc[te][cols_v2])[:, 1]

    p["line_break"] = ((p["n_bypassed"] >= LINE_BREAK_MIN_BYPASSED) & (p["dx"] >= LINE_BREAK_MIN_DX)).astype(int)
    p["lb_done"] = p["line_break"] * p["done"]
    p["exp_v2"] = o2
    m = derive.load_matches()[["match_id", "competition_id", "season_id"]]
    pl = p.merge(m, on="match_id").groupby(["player_id", "competition_id", "season_id"]).agg(
        passes=("done", "size"), line_break_attempts=("line_break", "sum"), line_breaks_completed=("lb_done", "sum"),
        poe_v2=("done", lambda s: 0.0)).reset_index().drop(columns="poe_v2")
    pl["poe_v2"] = (p.assign(d=p["done"] - p["exp_v2"]).merge(m, on="match_id")
                    .groupby(["player_id", "competition_id", "season_id"])["d"].sum().reindex(
        pd.MultiIndex.from_frame(pl[["player_id", "competition_id", "season_id"]])).values).round(2)
    pl["line_breaks_per_100_passes"] = (pl["line_breaks_completed"] / pl["passes"] * 100).round(2)
    pl = pl[pl["passes"] >= 100]
    derive.write_table("player_linebreaks", pl)
    derive.write_table("pass_line_break", p[["event_id", "line_break", "n_bypassed", "n_opp_vis"]])
    card = {"name": "360 pass models", "n_passes_with_frame": int(len(p)), "n_matches": int(p["match_id"].nunique()),
            "oof_metrics": {"xpass_v1_same_passes": {"auc": round(roc_auc_score(y, o1), 4), "brier": round(brier_score_loss(y, o1), 5)},
                            "xpass_v2_with_defenders": {"auc": round(roc_auc_score(y, o2), 4), "brier": round(brier_score_loss(y, o2), 5)}},
            "line_break_rule": f"completed forward pass (>= {LINE_BREAK_MIN_DX} yd) bypassing >= {LINE_BREAK_MIN_BYPASSED} visible opponents",
            "line_break_rate": round(float(p["line_break"].mean()), 4),
            "limits": "Only matches with 360 data. Bypassed counts are lower bounds (camera-visible players only)."}
    CARD_PATH.write_text(json.dumps(card, indent=2))
    return card

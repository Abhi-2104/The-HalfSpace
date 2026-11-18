"""
Tracking-derived measures for the SkillCorner broadcast-tracking matches (10 fps; players off camera are
extrapolated, flagged `is_detected = False`). Two things:

  Pitch control (simplified): every second, each 4 m cell goes to the team whose nearest player could reach
  it first (time = distance / 6 m/s), softened with a logistic so contested cells are ~50/50. Gives each
  team's share of the pitch overall and in its attacking third, plus an average control map. It ignores
  player velocity and the ball, so it is a space-occupation measure, not a full pass-completion model.

  Physical load: distance, high-speed (>= 5.5 m/s) and sprint (>= 7 m/s) distance, sprint count and top
  speed per player, computed ONLY between consecutive frames where the player was actually detected
  (extrapolated positions would invent running). Totals are therefore for the tracked minutes;
  per-tracked-minute rates are the comparable number.
"""
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

from halfspace import derive
from halfspace.models.xg import MODEL_DIR

RAW = derive.RAW / "skillcorner"
CARD_PATH = MODEL_DIR / "tracking_card.json"
FPS, SAMPLE_EVERY = 10, 10
CELL = 4.0
REACH_SPEED, SOFT = 6.0, 0.6
HSR, SPRINT, MAX_SPEED = 5.5, 7.0, 12.0


def _load(match_id: int):
    meta = json.loads((RAW / f"{match_id}_match.json").read_text())
    frames = [json.loads(l) for l in (RAW / f"{match_id}_tracking.jsonl").read_text().splitlines() if l.strip()]
    return meta, frames


def _arrays(meta: dict, frames: list):
    """positions [T, N, 2], detected [T, N], period [T], player ids and teams (N players listed in the match file)."""
    players = [p for p in meta["players"] if p.get("trackable_object") or p.get("id")]
    pid = [p["id"] for p in players]
    idx = {p: i for i, p in enumerate(pid)}
    T, N = len(frames), len(pid)
    pos = np.full((T, N, 2), np.nan)
    det = np.zeros((T, N), dtype=bool)
    period = np.zeros(T, dtype=int)
    for t, fr in enumerate(frames):
        period[t] = fr.get("period") or 0
        for p in fr.get("player_data", []):
            i = idx.get(p.get("player_id"))
            if i is not None and p.get("x") is not None:
                pos[t, i] = (p["x"], p["y"])
                det[t, i] = bool(p.get("is_detected"))
    team = np.array([p["team_id"] for p in players])
    return players, pos, det, period, team


def physical(pos, det, period, fps=FPS) -> list[dict]:
    """Per player: running load over consecutive detected frames. Speeds above MAX_SPEED are tracking glitches and are dropped."""
    T, N, _ = pos.shape
    out = []
    for i in range(N):
        ok = det[:, i] & ~np.isnan(pos[:, i, 0])
        both = ok[1:] & ok[:-1] & (period[1:] == period[:-1]) & (period[1:] > 0)
        step = np.linalg.norm(pos[1:, i] - pos[:-1, i], axis=1)
        v = np.where(both, step * fps, np.nan)
        good = both & (v <= MAX_SPEED)
        sp = np.where(good, v, 0.0)
        # smooth 1 s to damp positional jitter before thresholding speeds
        k = np.ones(fps) / fps
        sm = np.convolve(sp, k, mode="same")
        dist = float((sm / fps).sum())
        hsr = float((sm[sm >= HSR] / fps).sum())
        spr_mask = sm >= SPRINT
        sprint_m = float((sm[spr_mask] / fps).sum())
        runs, cur = 0, 0
        for f in spr_mask:
            cur = cur + 1 if f else 0
            runs += cur == fps  # a sprint = sustained >= 1 s
        tracked_min = float(good.sum() / fps / 60)
        out.append({"i": i, "tracked_min": tracked_min, "distance_m": dist, "hsr_m": hsr, "sprint_m": sprint_m,
                    "sprints": int(runs), "top_speed_kmh": float(sm.max() * 3.6) if len(sm) else 0.0,
                    "detected_share": float(ok.mean())})
    return out


def pitch_control(pos, period, team, home_id, home_dirs, length, width) -> dict:
    gx = np.arange(-length / 2 + CELL / 2, length / 2, CELL)
    gy = np.arange(-width / 2 + CELL / 2, width / 2, CELL)
    G = np.array([(x, y) for x in gx for y in gy])  # [n, 2]
    teams = sorted(set(team.tolist()))
    acc = {t: np.zeros(len(G)) for t in teams}
    n = {1: 0, 2: 0}
    ctl_att = {t: [] for t in teams}
    for t in range(0, len(pos), SAMPLE_EVERY):
        p = period[t]
        if p not in (1, 2):
            continue
        P = pos[t]
        valid = ~np.isnan(P[:, 0])
        if valid.sum() < 16:
            continue
        d = np.linalg.norm(P[valid][:, None, :] - G[None, :, :], axis=2) / REACH_SPEED   # [players, cells]
        tm = team[valid]
        ta = np.min(d[tm == teams[0]], axis=0)
        tb = np.min(d[tm == teams[1]], axis=0)
        pa = 1 / (1 + np.exp(-(tb - ta) / SOFT))                                          # team 0's control probability per cell
        for tid, c in ((teams[0], pa), (teams[1], 1 - pa)):
            sign = 1 if (home_dirs[p - 1] == "left_to_right") == (tid == home_id) else -1   # +1: this team attacks toward +x
            acc[tid] += c if sign == 1 else c.reshape(len(gx), len(gy))[::-1, ::-1].reshape(-1)  # normalise: attack -> +x
            att = G[:, 0] * sign > length / 6
            ctl_att[tid].append(float(c[att].mean()))
        n[p] += 1
    frames = sum(n.values())
    res = {}
    for tid in teams:
        grid = (acc[tid] / max(frames, 1)).reshape(len(gx), len(gy))
        res[tid] = {"share": float(grid.mean()), "share_attacking_third": float(np.mean(ctl_att[tid])) if ctl_att[tid] else None,
                    "grid": np.round(grid, 3).tolist(), "frames": frames}
    return res


def analyze(match_id: int) -> tuple[list[dict], list[dict]]:
    meta, frames = _load(match_id)
    players, pos, det, period, team = _arrays(meta, frames)
    names = {meta["home_team"]["id"]: meta["home_team"]["name"], meta["away_team"]["id"]: meta["away_team"]["name"]}
    dirs = meta.get("home_team_side") or ["left_to_right", "right_to_left"]
    pc = pitch_control(pos, period, team, meta["home_team"]["id"], dirs, meta["pitch_length"], meta["pitch_width"])
    pc_rows = [{"provider": "skillcorner_open_data", "match_id": str(match_id), "team_id": int(t), "team": names.get(t),
                "is_home": int(t == meta["home_team"]["id"]), "control_share": round(v["share"], 4),
                "control_share_attacking_third": round(v["share_attacking_third"], 4) if v["share_attacking_third"] is not None else None,
                "frames_sampled": v["frames"], "grid": json.dumps(v["grid"])} for t, v in pc.items()]
    ph = physical(pos, det, period)
    ph_rows = []
    for r in ph:
        if r["tracked_min"] < 5:
            continue
        p = players[r["i"]]
        ph_rows.append({"provider": "skillcorner_open_data", "match_id": str(match_id), "player_id": p["id"],
                        "player": p.get("short_name"), "team_id": p["team_id"], "team": names.get(p["team_id"]),
                        "position": p["player_role"]["acronym"] if p.get("player_role") else None,
                        "tracked_min": round(r["tracked_min"], 1), "detected_share": round(r["detected_share"], 3),
                        "distance_m": round(r["distance_m"]), "distance_per_tracked_min": round(r["distance_m"] / r["tracked_min"], 1),
                        "hsr_m": round(r["hsr_m"]), "sprint_m": round(r["sprint_m"]), "sprints": r["sprints"],
                        "top_speed_kmh": round(r["top_speed_kmh"], 1)})
    return pc_rows, ph_rows


def train() -> dict:
    ids = sorted(int(f.name.split("_")[0]) for f in RAW.glob("*_tracking.jsonl"))
    pcs, phs = [], []
    for mid in ids:
        a, b = analyze(mid)
        pcs += a
        phs += b
    pc, ph = pd.DataFrame(pcs), pd.DataFrame(phs)
    derive.write_table("tracking_pitch_control", pc)
    derive.write_table("tracking_physical", ph)
    big = ph[ph["tracked_min"] >= 30]
    card = {"name": "Tracking: pitch control and physical load", "method": "simplified distance-to-intercept pitch control (1 sample/second); "
            f"running load from detected consecutive frames only (high speed >= {HSR} m/s, sprint >= {SPRINT} m/s)",
            "n_matches": len(ids), "n_player_matches": int(len(ph)),
            "sanity": {"mean_control_share_sum_per_match": round(float(pc.groupby("match_id")["control_share"].sum().mean()), 3),
                       "median_distance_per_tracked_min_m": round(float(big["distance_per_tracked_min"].median()), 1) if len(big) else None,
                       "max_top_speed_kmh": round(float(ph["top_speed_kmh"].max()), 1)},
            "limits": "Broadcast tracking: players off camera are extrapolated, so physical totals cover only tracked minutes (see detected_share). "
                      "Pitch control ignores velocity and the ball. 27 matches from one league (A-League 2024/25); IDSSE (1 frame per second) is not used for "
                      "running load."}
    CARD_PATH.write_text(json.dumps(card, indent=2))
    return card

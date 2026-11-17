"""
Possession-level table: one row per possession with how it started (StatsBomb `play_pattern`),
its shape, and what it produced (shots, xG v2, goals). The pattern tag is provider-labelled for
EVERY match, so counterattacks and set pieces are read from the tag, not guessed by a heuristic or
a model trained to imitate it. Season rollups per team: counters, corners, free kicks.
"""
import json

import numpy as np
import pandas as pd

from halfspace import derive
from halfspace.models.xg import MODEL_DIR

CARD_PATH = MODEL_DIR / "possessions_card.json"
PATTERNS = {"From Counter": "counter", "From Corner": "corner", "From Free Kick": "free_kick"}


def corner_zone(x, y, start_y, length) -> str:
    """Where a corner's first pass landed. near/far are relative to the side the corner was taken from."""
    if x is None or x != x:
        return "unknown"
    if length == length and length is not None and length < 12:
        return "short"
    if x < 102:
        return "edge_or_back"
    if x >= 114 and 32 <= y <= 48:
        return "six_yard"
    same_side = (y - 40) * (start_y - 40) > 0
    if 28 <= y <= 52 and x < 114:
        return "penalty_spot"
    return "near_post" if same_side else "far_post"


def build() -> pd.DataFrame:
    ev = derive.load_events()
    ev = ev[ev["period"] <= 4].sort_values(["match_id", "idx"])
    shots = derive.load_shots()[["event_id", "xg_sb", "goal"]].merge(
        pd.read_sql("SELECT event_id, xg_v2 FROM shot_xg", derive.connect_derived()), on="event_id", how="left")
    shots["xg"] = shots["xg_v2"].fillna(shots["xg_sb"]).fillna(0.05)
    ev = ev.merge(shots[["event_id", "xg", "goal"]], on="event_id", how="left")
    ev["is_shot"] = (ev["type"] == "Shot").astype(int)
    ev["is_pass"] = (ev["type"] == "Pass").astype(int)
    g = ev.groupby(["match_id", "possession"], sort=False)
    p = g.agg(team_id=("possession_team_id", "first"), pattern=("play_pattern", "first"), period=("period", "first"),
              start_t=("t", "first"), end_t=("t", "last"), events=("idx", "size"), passes=("is_pass", "sum"),
              shots=("is_shot", "sum"), xg=("xg", "sum"), goals=("goal", "sum"), x_start=("x", "first"),
              y_start=("y", "first"), x_max=("x", "max")).reset_index()
    first_pass = ev[ev["type"] == "Pass"].groupby(["match_id", "possession"]).first()[["end_x", "end_y", "pass_length"]]
    first_pass.columns = ["fp_end_x", "fp_end_y", "fp_length"]
    p = p.merge(first_pass.reset_index(), on=["match_id", "possession"], how="left")
    p["duration"] = p["end_t"] - p["start_t"]
    p["pattern"] = p["pattern"].astype(str)
    p["zone"] = None
    c = p["pattern"] == "From Corner"
    p.loc[c, "zone"] = [corner_zone(a, b, sy, ln) for a, b, sy, ln in
                        zip(p.loc[c, "fp_end_x"], p.loc[c, "fp_end_y"], p.loc[c, "y_start"], p.loc[c, "fp_length"])]
    return p


def train() -> dict:
    p = build()
    keep = p[p["pattern"].isin(PATTERNS)].copy()
    derive.write_table("possession_special", keep.drop(columns=["end_t", "period"]).round(3))

    m = derive.load_matches()[["match_id", "competition_id", "season_id"]]
    tm = p.merge(m, on="match_id")
    n_matches = tm.groupby(["competition_id", "season_id", "team_id"])["match_id"].nunique().rename("matches")
    rows = []
    for pat, name in PATTERNS.items():
        d = tm[tm["pattern"] == pat].groupby(["competition_id", "season_id", "team_id"]).agg(
            n=("match_id", "size"), shot_rate=("shots", lambda s: float((s > 0).mean())), xg=("xg", "sum"), goals=("goals", "sum"))
        d.columns = [f"{name}_{c}" for c in d.columns]
        rows.append(d)
    team = pd.concat(rows, axis=1).join(n_matches).reset_index().fillna(0)
    for name in PATTERNS.values():
        team[f"{name}_per_match"] = (team[f"{name}_n"] / team["matches"]).round(2)
        team[f"{name}_xg_each"] = (team[f"{name}_xg"] / team[f"{name}_n"].replace(0, np.nan)).round(3)
    derive.write_table("team_possession_patterns", team.round(3))

    counters = p[p["pattern"] == "From Counter"]
    corners = p[p["pattern"] == "From Corner"]
    card = {"name": "Possession patterns", "method": "StatsBomb play_pattern tags; xG v2 per possession",
            "n_possessions": int(len(p)), "n_counters": int(len(counters)), "n_corners": int(len(corners)),
            "counter_xg_per_possession": round(float(counters["xg"].mean()), 3),
            "open_play_xg_per_possession": round(float(p[p["pattern"] == "Regular Play"]["xg"].mean()), 3),
            "corner_xg_per_corner": round(float(corners["xg"].mean()), 3),
            "corner_zone_share": corners["zone"].value_counts(normalize=True).round(3).to_dict(),
            "limits": "Provider-tagged: a counter is whatever StatsBomb tags as 'From Counter'. Tracking-based counters "
                      "(speed, players ahead) are not available outside the 17 tracking matches."}
    CARD_PATH.write_text(json.dumps(card, indent=2))
    return card

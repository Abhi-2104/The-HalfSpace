"""
Team style fingerprints: per team-season, how they play (possession, directness, width, territory,
pressing, build-up length, shot quality, reliance on counters/set pieces). Standardized, projected
to 2D with PCA for a style map, grouped into archetypes with k-means. Archetype names are generated
from each group's most extreme features, so a label always says what the numbers say.
"""
import json

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA

from halfspace import derive
from halfspace.models.xg import MODEL_DIR

CARD_PATH = MODEL_DIR / "style_card.json"
MIN_MATCHES = 4
K = 6
FEATURES = {  # name -> (high-word, low-word)
    "possession": ("high possession", "low possession"),
    "build_up": ("patient build-up", "quick attacks"),
    "directness": ("direct", "short passing"),
    "width": ("wide play", "central play"),
    "territory": ("pins opponents back", "sits deeper"),
    "press_high": ("high press", "low block"),
    "press_volume": ("heavy pressing", "light pressing"),
    "carry_rate": ("carry-heavy", "pass-heavy"),
    "shot_quality": ("selective shooting", "shoots from anywhere"),
    "shot_volume": ("many shots", "few shots"),
    "set_piece_share": ("set-piece reliant", "open-play based"),
}


def _team_match(ev: pd.DataFrame, shots: pd.DataFrame, poss: pd.DataFrame) -> pd.DataFrame:
    ev = ev[(ev["period"] <= 4) & ev["team_id"].notna()]
    passes = ev[ev["type"] == "Pass"]
    g = passes.groupby(["match_id", "team_id"])
    out = pd.DataFrame({
        "n_pass": g.size(),
        "directness": g.apply(lambda d: (d["end_x"] - d["x"]).clip(lower=0).sum() / d["pass_length"].sum(), include_groups=False),
        "width": g["y"].apply(lambda s: (s - 40).abs().mean()),
        "territory": g["x"].mean(),
    })
    carries = ev[ev["type"] == "Carry"].groupby(["match_id", "team_id"]).size()
    pr = ev[ev["type"] == "Pressure"]
    press_all = pr.groupby(["match_id", "team_id"]).size()
    press_high = pr[pr["x"] >= 60].groupby(["match_id", "team_id"]).size()
    out["carry_rate"] = (carries / out["n_pass"]).reindex(out.index)
    out["press_volume"] = press_all.reindex(out.index)
    out["press_high"] = (press_high / press_all).reindex(out.index)
    tot = out.groupby("match_id")["n_pass"].transform("sum")
    out["possession"] = out["n_pass"] / tot
    s = shots[shots["period"] <= 4].groupby(["match_id", "team_id"]).agg(shot_volume=("xg", "size"), shot_quality=("xg", "mean"))
    out = out.join(s)
    p = poss.groupby(["match_id", "team_id"]).agg(build_up=("passes", "mean"), n_poss=("passes", "size"))
    sp = poss[poss["pattern"].isin(["From Corner", "From Free Kick"])].groupby(["match_id", "team_id"]).size()
    out = out.join(p)
    out["set_piece_share"] = (sp / out["n_poss"]).reindex(out.index).fillna(0)
    return out.reset_index()


def _label(z: pd.Series) -> str:
    top = z.abs().sort_values(ascending=False).index[:2]
    return " + ".join(FEATURES[f][0 if z[f] > 0 else 1] for f in top)


def train() -> dict:
    from halfspace.models import possessions
    ev, shots = derive.load_events(), derive.load_shots()
    shots = shots.merge(pd.read_sql("SELECT event_id, xg_v2 FROM shot_xg", derive.connect_derived()), on="event_id", how="left")
    shots["xg"] = shots["xg_v2"].fillna(shots["xg_sb"]).fillna(0.05)
    tm = _team_match(ev, shots, possessions.build())
    tm = tm.merge(derive.load_matches()[["match_id", "competition_id", "season_id", "gender"]], on="match_id")
    key = ["competition_id", "season_id", "team_id"]
    cols = list(FEATURES)
    ts = tm.groupby(key).agg(matches=("match_id", "nunique"), gender=("gender", "first"), **{c: (c, "mean") for c in cols}).reset_index()
    ts = ts[ts["matches"] >= MIN_MATCHES].dropna(subset=cols).reset_index(drop=True)
    Z = (ts[cols] - ts[cols].mean()) / ts[cols].std()
    pcs = PCA(2, random_state=0).fit(Z)
    xy = pcs.transform(Z)
    km = KMeans(K, n_init=20, random_state=0).fit(Z)
    cent = pd.DataFrame(km.cluster_centers_, columns=cols)
    labels = {i: _label(cent.loc[i]) for i in range(K)}
    ts["pc1"], ts["pc2"], ts["cluster"] = xy[:, 0].round(3), xy[:, 1].round(3), km.labels_
    ts["archetype"] = ts["cluster"].map(labels)
    for c in cols:
        ts[c + "_z"] = Z[c].round(2)
        ts[c] = ts[c].round(3)
    derive.write_table("team_style", ts)
    card = {"name": "Team style fingerprints", "method": f"{len(cols)} standardized features, PCA(2), KMeans k={K}",
            "n_team_seasons": int(len(ts)), "min_matches": MIN_MATCHES,
            "explained_variance_2d": [round(float(v), 3) for v in pcs.explained_variance_ratio_],
            "archetypes": [{"id": i, "label": labels[i], "n": int((km.labels_ == i).sum())} for i in range(K)],
            "features": {c: FEATURES[c] for c in cols},
            "limits": "Compared across all competitions and both genders, so league context shifts values. "
                      "Archetype names describe the two most extreme features of each group; groups overlap."}
    CARD_PATH.write_text(json.dumps(card, indent=2))
    return card

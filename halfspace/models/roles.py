"""
Data-driven player roles. Each player-season (600+ minutes) becomes a vector of WHERE they act
(3x3 pitch occupancy, width) and WHAT they do (share of action types, forward-pass share, pass
length). Standardized, PCA-reduced, clustered with k-means. A role's name = its most common listed
position + the traits that set it apart, so the label always matches the numbers. Also gives a
nearest-neighbour "plays like" list in the same space (across competitions, flagged as such).
"""
import json

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import homogeneity_score

from halfspace import derive
from halfspace import names as pn
from halfspace.models.xg import MODEL_DIR

CARD_PATH = MODEL_DIR / "roles_card.json"
MIN_MINUTES, K = 600, 12
TYPES = {"Pass": "passes", "Carry": "carries", "Dribble": "dribbles", "Pressure": "pressing", "Interception": "interceptions",
         "Ball Recovery": "recoveries", "Shot": "shooting", "Duel": "duels", "Clearance": "clearances", "Foul Won": "fouls_won"}
TRAIT = {"passes": "pass-heavy", "carries": "ball-carrying", "dribbles": "dribbling", "pressing": "pressing", "interceptions": "intercepting",
         "recoveries": "ball-winning", "shooting": "shooting", "duels": "duelling", "clearances": "clearing", "fouls_won": "fouled often",
         "width": "wide", "depth": "advanced", "forward_pass_share": "progressive passing", "pass_length": "long passing",
         "occ_def": "deep-lying", "occ_att": "high up the pitch", "occ_left": "left side", "occ_right": "right side", "occ_centre": "central"}


def _features() -> pd.DataFrame:
    ev = derive.load_events()
    ev = ev[(ev["period"] <= 4) & ev["player_id"].notna() & ev["x"].notna()].copy()
    ev["player_id"] = ev["player_id"].astype(int)
    ev = ev.merge(derive.load_matches()[["match_id", "competition_id", "season_id"]], on="match_id")
    key = ["player_id", "competition_id", "season_id"]
    g = ev.groupby(key)
    n = g.size().rename("n")
    f = pd.DataFrame(n)
    for t, name in TYPES.items():
        f[name] = ev[ev["type"] == t].groupby(key).size().reindex(f.index).fillna(0) / n
    f["width"] = g["y"].apply(lambda s: (s - 40).abs().mean())
    f["depth"] = g["x"].mean()
    f["occ_def"] = g["x"].apply(lambda s: (s < 40).mean())
    f["occ_att"] = g["x"].apply(lambda s: (s > 80).mean())
    f["occ_left"] = g["y"].apply(lambda s: (s < 27).mean())
    f["occ_right"] = g["y"].apply(lambda s: (s > 53).mean())
    f["occ_centre"] = g["y"].apply(lambda s: ((s >= 27) & (s <= 53)).mean())
    ps = ev[(ev["type"] == "Pass") & ev["end_x"].notna()]
    f["forward_pass_share"] = ps.assign(fw=(ps["end_x"] - ps["x"] > 10)).groupby(key)["fw"].mean().reindex(f.index)
    f["pass_length"] = ps.groupby(key)["pass_length"].mean().reindex(f.index)
    pos = ev.dropna(subset=["position"]).groupby(key)["position"].agg(lambda s: s.mode().iloc[0]).rename("position")
    return f.join(pos).reset_index()


def train() -> dict:
    from halfspace.models.profiles import _minutes
    f = _features()
    mins = _minutes().merge(derive.load_matches()[["match_id", "competition_id", "season_id"]], on="match_id") \
        .groupby(["player_id", "competition_id", "season_id"])["minutes"].sum().rename("minutes").reset_index()
    f = f.merge(mins, on=["player_id", "competition_id", "season_id"])
    f = f[(f["minutes"] >= MIN_MINUTES)].dropna().reset_index(drop=True)
    cols = [c for c in f.columns if c in set(TYPES.values()) | {"width", "depth", "occ_def", "occ_att", "occ_left", "occ_right", "occ_centre",
                                                                  "forward_pass_share", "pass_length"}]
    Z = (f[cols] - f[cols].mean()) / f[cols].std()
    pca = PCA(8, random_state=0).fit(Z)
    P = pca.transform(Z)
    km = KMeans(K, n_init=20, random_state=0).fit(P)
    f["role_id"] = km.labels_
    f["pc1"], f["pc2"] = P[:, 0].round(3), P[:, 1].round(3)
    zc = Z.groupby(f["role_id"]).mean()
    labels = {}
    for r, row in zc.iterrows():
        modal = f.loc[f["role_id"] == r, "position"].mode().iloc[0]
        top = [TRAIT[c] for c in row.abs().sort_values(ascending=False).index[:6] if c in TRAIT and row[c] > 0][:2]
        labels[r] = f"{modal} ({', '.join(top)})" if top else modal
    f["role"] = f["role_id"].map(labels)
    for i in range(P.shape[1]):
        f[f"e{i}"] = P[:, i].round(3)
    derive.write_table("player_role", f.round(4))
    purity = homogeneity_score(f["position"], f["role_id"])
    card = {"name": "Player roles", "method": f"{len(cols)} where/what features, PCA(8), KMeans k={K}", "n_player_seasons": int(len(f)),
            "min_minutes": MIN_MINUTES, "homogeneity_vs_listed_position": round(float(purity), 3),
            "roles": [{"id": int(r), "label": labels[r], "n": int((f["role_id"] == r).sum())} for r in sorted(labels)],
            "limits": "Roles are statistical groups of how players played in that season, not coaching labels. "
                      "Pooled across competitions and both genders; goalkeepers form their own groups."}
    CARD_PATH.write_text(json.dumps(card, indent=2))
    return card


def similar_players(conn, player_id: int, competition_id: int, season_id: int, top_n: int = 8) -> dict:
    t = pd.read_sql("SELECT * FROM player_role", derive.connect_derived())
    ecols = [c for c in t.columns if c.startswith("e") and c[1:].isdigit()]
    me = t[(t["player_id"] == player_id) & (t["competition_id"] == competition_id) & (t["season_id"] == season_id)]
    if me.empty:
        return {"error": "no role data for this player-season (needs 600+ minutes)"}
    d = ((t[ecols] - me.iloc[0][ecols]) ** 2).sum(axis=1) ** 0.5
    near = t.assign(distance=d)[t["player_id"] != player_id].sort_values("distance").iloc[:top_n]  # other players only
    ids = [int(i) for i in near["player_id"]]
    names = {r["id"]: r["name"] for r in conn.execute(f"SELECT id, name FROM player WHERE id IN ({','.join(map(str, ids))})")}
    shown = pn.display_names(conn, ids)
    cs = {(r["cid"], r["sid"]): f"{r['c']} {r['s']}" for r in conn.execute(
        "SELECT c.id cid, s.id sid, c.name c, s.name s FROM competition c JOIN season s ON s.competition_id=c.id")}
    return {"player_id": player_id, "role": me.iloc[0]["role"],
            "plays_like": [{"player_id": int(r.player_id), "name": names.get(int(r.player_id)), "display_name": shown.get(int(r.player_id)),
                            "competition": cs.get((int(r.competition_id), int(r.season_id))), "role": r.role,
                            "distance": round(float(r.distance), 2)} for r in near.itertuples()],
            "note": "Nearest players in role space across all competitions. Cross-league similarity is style, not quality."}

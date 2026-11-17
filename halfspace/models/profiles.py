"""
Player profiles with honest uncertainty: per-90 rates, empirical-Bayes shrinkage toward the pool
mean (weight = minutes / (minutes + k), k from each metric's own split-half reliability), and
percentiles within a pool = competition-season x position group. Small samples are pulled toward
average and carry a `confidence` (the shrinkage weight) so the UI can say "limited sample".
"""
import json
import sqlite3

import numpy as np
import pandas as pd

from halfspace import db, derive
from halfspace.models import xt
from halfspace.models.xg import MODEL_DIR

CARD_PATH = MODEL_DIR / "profiles_card.json"
MIN_MINUTES = 300
METRICS = ["goals_np", "shots_np", "npxg", "xa", "xt", "passes", "pass_pct", "dribbles", "carries", "pressures",
           "interceptions", "recoveries"]
RATE = [m for m in METRICS if m != "pass_pct"]  # pass_pct is a ratio, shrunk on attempts instead
GROUP = {"Goalkeeper": "GK", "Center Back": "DEF", "Left Center Back": "DEF", "Right Center Back": "DEF",
         "Left Back": "DEF", "Right Back": "DEF", "Left Wing Back": "DEF", "Right Wing Back": "DEF",
         "Center Defensive Midfield": "MID", "Left Defensive Midfield": "MID", "Right Defensive Midfield": "MID",
         "Center Midfield": "MID", "Left Center Midfield": "MID", "Right Center Midfield": "MID",
         "Left Midfield": "MID", "Right Midfield": "MID", "Center Attacking Midfield": "MID",
         "Left Attacking Midfield": "MID", "Right Attacking Midfield": "MID"}


def _match_player_counts() -> pd.DataFrame:
    ev = derive.load_events()
    ev = ev[(ev["period"] <= 4) & ev["player_id"].notna()].copy()
    ev["player_id"] = ev["player_id"].astype(int)
    shots = derive.load_shots()
    shots = shots[(shots["period"] <= 4) & shots["x"].notna()].merge(
        pd.read_sql("SELECT event_id, xg_v2 FROM shot_xg", derive.connect_derived()), on="event_id", how="left")
    shots["xg"] = shots["xg_v2"].fillna(shots["xg_sb"]).fillna(0.05)
    np_s = shots[shots["shot_type"] != "Penalty"]

    cnt = {}
    def put(name, df, col="player_id", w=None):
        cnt[name] = (df.groupby(["match_id", col])[w].sum() if w else df.groupby(["match_id", col]).size())
    put("goals_np", np_s[np_s["goal"] == 1].assign(n=1), w="n")
    put("shots_np", np_s.assign(n=1), w="n")
    put("npxg", np_s, w="xg")
    # approx xA: the completed pass immediately before a shot, same team, same possession
    e = ev.sort_values(["match_id", "idx"])
    prev = e.groupby("match_id").shift(1)
    s_idx = e[e["type"] == "Shot"].index
    ass = pd.DataFrame({"match_id": e.loc[s_idx, "match_id"], "player_id": prev.loc[s_idx, "player_id"],
                        "ptype": prev.loc[s_idx, "type"], "pteam": prev.loc[s_idx, "team_id"], "poss": prev.loc[s_idx, "possession"],
                        "event_id": e.loc[s_idx, "event_id"], "team": e.loc[s_idx, "team_id"], "sposs": e.loc[s_idx, "possession"],
                        "pout": prev.loc[s_idx, "outcome"]})
    ass = ass[(ass["ptype"] == "Pass") & (ass["pteam"] == ass["team"]) & (ass["poss"] == ass["sposs"]) & ass["pout"].isna()]
    ass = ass.merge(shots[["event_id", "xg", "shot_type"]], on="event_id")
    ass = ass[ass["shot_type"] != "Penalty"].dropna(subset=["player_id"]).astype({"player_id": int})
    put("xa", ass, w="xg")
    passes = ev[(ev["type"] == "Pass")]
    put("passes", passes)
    put("pass_ok", passes[passes["outcome"].isna()])
    put("dribbles", ev[(ev["type"] == "Dribble") & (ev["outcome"] == "Complete")])
    put("carries", ev[ev["type"] == "Carry"])
    put("pressures", ev[ev["type"] == "Pressure"])
    put("interceptions", ev[ev["type"] == "Interception"])
    put("recoveries", ev[ev["type"] == "Ball Recovery"])
    # xT from open-play passes and carries
    xtv, mv = xt.fit()
    mv = mv[mv["ok"] & (mv["period"] <= 4) & mv["player_id"].notna()].copy()
    mv["gain"] = xtv[mv["z1"].values] - xtv[mv["z0"].values]
    mv["player_id"] = mv["player_id"].astype(int)
    put("xt", mv, w="gain")
    df = pd.concat(cnt, axis=1).fillna(0).reset_index().rename(columns={"level_1": "player_id"})
    pos = ev.dropna(subset=["position"]).groupby(["match_id", "player_id"])["position"].agg(lambda s: s.mode().iloc[0]).rename("position").reset_index()
    team = ev.groupby(["match_id", "player_id"])["team_id"].agg(lambda s: s.mode().iloc[0]).rename("team_id").reset_index()
    return df.merge(pos, on=["match_id", "player_id"], how="left").merge(team, on=["match_id", "player_id"], how="left")


def _minutes() -> pd.DataFrame:
    # read-only handle: db.connect() runs CREATE statements, which would fight a running ingest for the write lock
    conn = sqlite3.connect(f"file:{db.DEFAULT_DB_PATH}?mode=ro", uri=True, timeout=60)
    return pd.read_sql("SELECT match_id, player_id, minutes FROM player_match_minutes", conn)


def _per90(d: pd.DataFrame, minutes: pd.Series) -> pd.DataFrame:
    out = pd.DataFrame({m: d[m] / minutes * 90 for m in RATE})
    out["pass_pct"] = np.where(d["passes"] > 0, d["pass_ok"] / d["passes"].clip(lower=1) * 100, np.nan)
    return out


def train() -> dict:
    mp = _match_player_counts().merge(_minutes(), on=["match_id", "player_id"])
    mp = mp.merge(derive.load_matches()[["match_id", "competition_id", "season_id", "date"]], on="match_id")
    mp["group"] = mp["position"].map(GROUP).fillna("ATT")
    mp = mp.sort_values(["player_id", "competition_id", "season_id", "date"])
    mp["half"] = mp.groupby(["player_id", "competition_id", "season_id"]).cumcount() % 2
    sums = ["minutes", "goals_np", "shots_np", "npxg", "xa", "xt", "passes", "pass_ok", "dribbles", "carries", "pressures", "interceptions", "recoveries"]
    key = ["player_id", "competition_id", "season_id"]

    # split-half reliability per metric -> shrinkage constant k (minutes)
    halves = mp.groupby(key + ["half"])[sums].sum().reset_index()
    a, b = halves[halves["half"] == 0].set_index(key), halves[halves["half"] == 1].set_index(key)
    j = a.join(b, lsuffix="_a", rsuffix="_b", how="inner")
    j = j[(j["minutes_a"] >= 300) & (j["minutes_b"] >= 300)]
    pg = mp.groupby(key)["group"].agg(lambda s: s.mode().iloc[0]).rename("pg")
    j = j.join(pg)  # reliability is measured WITHIN position groups: pooling GKs with strikers would inflate it
    rel, kmin = {}, {}
    for m in RATE:
        ra = j[m + "_a"] / j["minutes_a"] * 90
        rb = j[m + "_b"] / j["minutes_b"] * 90
        ra, rb = ra - ra.groupby(j["pg"]).transform("mean"), rb - rb.groupby(j["pg"]).transform("mean")
        r_h = float(np.corrcoef(ra, rb)[0, 1]) if len(j) > 30 and ra.std() > 0 and rb.std() > 0 else 0.0
        r = max(min(2 * r_h / (1 + r_h), 0.98), 0.05) if r_h > 0 else 0.05
        rel[m] = round(r, 3)
        kmin[m] = float(j["minutes_a"].add(j["minutes_b"]).mean() * (1 - r) / r)
    pass_k = 1500.0  # pass accuracy: shrink on attempts, fixed prior strength

    pl = mp.groupby(key)[sums].sum().reset_index()
    pl = pl[pl["minutes"] >= MIN_MINUTES]
    grp = mp.groupby(key)["group"].agg(lambda s: s.mode().iloc[0]).rename("position_group").reset_index()
    team = mp.groupby(key)["team_id"].agg(lambda s: s.mode().iloc[0]).reset_index()
    pl = pl.merge(grp, on=key).merge(team, on=key)
    raw = _per90(pl, pl["minutes"])
    out = pl[key + ["team_id", "position_group", "minutes"]].copy()
    for m in RATE:
        out[m] = raw[m].round(3)
    out["pass_pct"] = raw["pass_pct"].round(1)
    pool = ["competition_id", "season_id", "position_group"]
    for m in RATE:
        mu = out.groupby(pool)[m].transform(lambda s: np.average(s, weights=out.loc[s.index, "minutes"]))
        w = out["minutes"] / (out["minutes"] + kmin[m])
        out[m + "_adj"] = (w * out[m] + (1 - w) * mu).round(3)
        out[m + "_pct"] = out.groupby(pool)[m + "_adj"].rank(pct=True).mul(100).round(0)
    pm = out.groupby(pool)["pass_pct"].transform("mean")
    wp = pl["passes"] / (pl["passes"] + pass_k)
    out["pass_pct_adj"] = (wp * out["pass_pct"] + (1 - wp) * pm).round(1)
    out["pass_pct_pct"] = out.groupby(pool)["pass_pct_adj"].rank(pct=True).mul(100).round(0)
    out["confidence"] = (out["minutes"] / (out["minutes"] + float(np.median(list(kmin.values()))))).round(2)
    out["pool_size"] = out.groupby(pool)["player_id"].transform("size")
    derive.write_table("player_profile", out)
    card = {"name": "Player profiles", "method": "per-90 rates, empirical-Bayes shrinkage, pool percentiles",
            "min_minutes": MIN_MINUTES, "n_player_seasons": int(len(out)),
            "split_half_reliability": rel, "shrink_k_minutes": {k: round(v) for k, v in kmin.items()},
            "limits": "Percentiles are within one competition-season and position group; not comparable across leagues. "
                      "xA is approximate (the completed pass directly before a shot)."}
    CARD_PATH.write_text(json.dumps(card, indent=2))
    return card

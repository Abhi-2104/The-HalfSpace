"""Read-side functions over the model outputs in data/derived.db. Used by BOTH api_models.py and
the agent tools (same rule as lookups.py: the agent has no separate path to the data)."""
import json

import pandas as pd

from halfspace import derive
from halfspace.models import momentum, xg
from halfspace.models.profiles import METRICS

LABELS = {"goals_np": "non-penalty goals", "shots_np": "non-penalty shots", "npxg": "non-penalty xG",
          "xa": "xA (approx)", "xt": "xT (expected threat)", "passes": "passes", "pass_pct": "pass accuracy %",
          "dribbles": "dribbles completed", "carries": "carries", "pressures": "pressures",
          "interceptions": "interceptions", "recoveries": "ball recoveries"}


def _names(conn, ids) -> dict:
    ids = [int(i) for i in ids if i == i]
    if not ids:
        return {}
    return {r["id"]: r["name"] for r in conn.execute(f"SELECT id, name FROM player WHERE id IN ({','.join(map(str, ids))})")}


def player_profile(conn, competition_id: int, season_id: int, player_id: int) -> dict | None:
    d = derive.connect_derived()
    row = d.execute("SELECT * FROM player_profile WHERE competition_id=? AND season_id=? AND player_id=?",
                    (competition_id, season_id, player_id)).fetchone()
    if row is None:
        return None
    r = dict(row)
    metrics = [{"metric": m, "label": LABELS[m], "per90": r[m], "per90_adjusted": r[m + "_adj"], "percentile": r[m + "_pct"]}
               for m in METRICS]
    passing = {}
    for table, cols in (("player_xpass", "passes, actual_pct, exp_pct AS expected_pct, poe_per100, avg_difficulty"),
                        ("player_linebreaks", "line_breaks_completed, line_breaks_per_100_passes")):
        try:
            row = d.execute(f"SELECT {cols} FROM {table} WHERE competition_id=? AND season_id=? AND player_id=?",
                            (competition_id, season_id, player_id)).fetchone()
        except Exception:
            row = None
        if row:
            passing.update(dict(row))
    try:
        role = d.execute("SELECT role FROM player_role WHERE competition_id=? AND season_id=? AND player_id=?",
                         (competition_id, season_id, player_id)).fetchone()
    except Exception:
        role = None
    try:
        v = d.execute("SELECT per90, per90_adj, percentile, pass_p90, carry_p90, shot_p90, defence_p90 FROM player_vaep "
                      "WHERE competition_id=? AND season_id=? AND player_id=?", (competition_id, season_id, player_id)).fetchone()
    except Exception:
        v = None
    return {"player_id": player_id, "name": _names(conn, [player_id]).get(player_id), "competition_id": competition_id,
            "season_id": season_id, "position_group": r["position_group"], "role": role["role"] if role else None,
            "on_ball_value": None if v is None else {"per90": v["per90"], "per90_adjusted": v["per90_adj"], "percentile": v["percentile"],
                                                      "by_action_per90": {"pass": v["pass_p90"], "carry": v["carry_p90"], "shot": v["shot_p90"], "defence": v["defence_p90"]}}, "minutes": round(r["minutes"]),
            "confidence": r["confidence"], "pool_size": r["pool_size"], "metrics": metrics,
            "passing": passing or None,
            "note": "per90_adjusted shrinks small samples toward the pool average. Percentile is within this "
                    "competition-season and position group only. passing: poe_per100 = completions above expected per 100 "
                    "passes (xPass, shrunk); line_breaks_* only exist for matches with 360 data."}


def leaders(conn, competition_id: int, season_id: int, metric: str, position_group: str | None = None, top_n: int = 15) -> dict:
    if metric not in METRICS:
        return {"error": f"unknown metric '{metric}'; use one of {', '.join(METRICS)}"}
    q = "SELECT player_id, position_group, minutes, confidence, {m} AS per90, {m}_adj AS adjusted, {m}_pct AS percentile " \
        "FROM player_profile WHERE competition_id=? AND season_id=?".format(m=metric)
    args = [competition_id, season_id]
    if position_group:
        q += " AND position_group=?"
        args.append(position_group.upper())
    rows = derive.connect_derived().execute(q + " ORDER BY adjusted DESC LIMIT ?", (*args, top_n)).fetchall()
    names = _names(conn, [r["player_id"] for r in rows])
    return {"metric": metric, "label": LABELS[metric], "ranked_by": "per-90 adjusted for sample size",
            "players": [{"player_id": r["player_id"], "name": names.get(r["player_id"]), **{k: r[k] for k in
                         ("position_group", "minutes", "per90", "adjusted", "percentile", "confidence")}} for r in rows]}


def match_momentum_summary(conn, match_id: int) -> dict | None:
    """Compact momentum story for the agent (the full curve is ~300 numbers)."""
    s = momentum.match_story(conn, match_id)
    if s is None:
        return None
    mom = s["momentum"]
    pick = [m for m in range(10, min(len(mom), 91), 10)]
    return {"match_id": match_id, "window_minutes": s["window_minutes"],
            "momentum_by_minute": {str(m): mom[m] for m in pick},
            "home_peak": {"minute": int(max(range(len(mom)), key=mom.__getitem__)), "momentum": max(mom)},
            "away_peak": {"minute": int(min(range(len(mom)), key=mom.__getitem__)), "momentum": min(mom)},
            "xg_home": s["xg_cumulative"]["home"][-1], "xg_away": s["xg_cumulative"]["away"][-1],
            "key_moments": s["moments"], "note": s["note"]}


def team_style_ready() -> bool:
    try:
        derive.connect_derived().execute("SELECT 1 FROM team_style LIMIT 1")
        return True
    except Exception:
        return False


def all_cards() -> list[dict]:
    return [json.loads(p.read_text()) | {"id": p.stem.removesuffix("_card")} for p in sorted(xg.MODEL_DIR.glob("*_card.json"))]


KINDS = {"counter": "From Counter", "corner": "From Corner", "free_kick": "From Free Kick"}


def _team_names(conn, ids) -> dict:
    ids = [int(i) for i in ids]
    return {r["id"]: r["name"] for r in conn.execute(f"SELECT id, name FROM team WHERE id IN ({','.join(map(str, ids)) or '0'})")}


def match_possessions(conn, match_id: int, kind: str) -> dict:
    if kind not in KINDS:
        return {"error": f"kind must be one of {', '.join(KINDS)}"}
    rows = derive.connect_derived().execute(
        "SELECT * FROM possession_special WHERE match_id=? AND pattern=? ORDER BY start_t", (match_id, KINDS[kind])).fetchall()
    names = _team_names(conn, {r["team_id"] for r in rows})
    return {"match_id": match_id, "kind": kind, "provider_tag": KINDS[kind],
            "possessions": [{"team": names.get(r["team_id"]), "team_id": r["team_id"], "minute": int(r["start_t"] // 60),
                             "duration_s": r["duration"], "passes": r["passes"], "shots": r["shots"], "xg": round(r["xg"], 3),
                             "goals": r["goals"], "zone": r["zone"]} for r in rows],
            "note": "Tagged by the data provider (StatsBomb play_pattern), not inferred."}


def team_patterns(conn, competition_id: int, season_id: int, kind: str, top_n: int = 20) -> dict:
    if kind not in KINDS:
        return {"error": f"kind must be one of {', '.join(KINDS)}"}
    k = kind
    rows = derive.connect_derived().execute(
        f"SELECT team_id, matches, {k}_n AS n, {k}_per_match AS per_match, {k}_xg AS xg, {k}_xg_each AS xg_each, "
        f"{k}_shot_rate AS shot_rate, {k}_goals AS goals FROM team_possession_patterns "
        "WHERE competition_id=? AND season_id=? AND matches >= 3 ORDER BY xg_each DESC", (competition_id, season_id)).fetchall()
    names = _team_names(conn, {r["team_id"] for r in rows})
    return {"kind": kind, "ranked_by": "xG per possession of this type",
            "teams": [{"team": names.get(r["team_id"]), **{c: r[c] for c in ("team_id", "matches", "n", "per_match", "xg", "xg_each", "shot_rate", "goals")}}
                      for r in rows[:top_n]],
            "note": "Small samples: set-piece numbers per team are noisy below ~30 corners or ~15 counters."}


def _style_rows() -> pd.DataFrame:
    return pd.read_sql("SELECT * FROM team_style", derive.connect_derived())


def team_styles(conn, competition_id: int, season_id: int) -> dict:
    t = _style_rows()
    t = t[(t["competition_id"] == competition_id) & (t["season_id"] == season_id)]
    if t.empty:
        return {"error": "no team style data for this competition/season (needs teams with 4+ matches)"}
    names = _team_names(conn, t["team_id"])
    feats = [c for c in t.columns if c.endswith("_z")]
    return {"teams": [{"team_id": int(r.team_id), "team": names.get(int(r.team_id)), "matches": int(r.matches),
                       "x": r.pc1, "y": r.pc2, "archetype": r.archetype, "cluster": int(r.cluster),
                       "z": {f[:-2]: getattr(r, f) for f in feats}} for r in t.itertuples()],
            "note": "x/y are a 2D projection of standardized style features; z values are vs all team-seasons in the data."}


def similar_styles(conn, team_id: int, competition_id: int, season_id: int, top_n: int = 6) -> dict:
    t = _style_rows().reset_index(drop=True)
    feats = [c for c in t.columns if c.endswith("_z")]
    me = t[(t["team_id"] == team_id) & (t["competition_id"] == competition_id) & (t["season_id"] == season_id)]
    if me.empty:
        return {"error": "no style data for this team-season (needs 4+ matches)"}
    d = ((t[feats] - me.iloc[0][feats]) ** 2).sum(axis=1) ** 0.5
    near = t.assign(distance=d).sort_values("distance").iloc[1:top_n + 1]
    names = _team_names(conn, near["team_id"])
    cs = {(r["cid"], r["sid"]): f"{r['c']} {r['s']}" for r in conn.execute(
        "SELECT c.id cid, s.id sid, c.name c, s.name s FROM competition c JOIN season s ON s.competition_id=c.id")}
    return {"team_id": team_id, "archetype": me.iloc[0]["archetype"],
            "most_similar": [{"team": names.get(int(r.team_id)), "competition": cs.get((int(r.competition_id), int(r.season_id))),
                              "distance": round(float(r.distance), 2), "archetype": r.archetype} for r in near.itertuples()]}


def goalkeepers(conn, competition_id: int, season_id: int, top_n: int = 10) -> dict:
    rows = derive.connect_derived().execute(
        "SELECT * FROM goalkeeper_rating WHERE competition_id=? AND season_id=? ORDER BY prevented_per_100 DESC",
        (competition_id, season_id)).fetchall()
    if not rows:
        return {"error": "no goalkeeper ratings for this competition/season (needs 20+ on-target shots faced)"}
    names = _names(conn, [r["keeper_id"] for r in rows])
    return {"ranked_by": "goals prevented per 100 on-target shots, shrunk for sample size", "goalkeepers": [
        {"player_id": r["keeper_id"], "name": names.get(r["keeper_id"]), "shots_faced": r["shots_faced"],
         "goals_conceded": r["goals_conceded"], "expected_goals_conceded": round(r["psxg_faced"], 1),
         "goals_prevented": r["goals_prevented"], "prevented_per_100": r["prevented_per_100"],
         "save_pct": r["save_pct"], "expected_save_pct": r["expected_save_pct"]} for r in rows[:top_n]],
        "note": "Noisy below ~150 shots faced. Excludes penalties. Positive = saved more than an average keeper would."}

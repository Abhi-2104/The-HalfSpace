"""
Auto match report, built from the model outputs with plain templates - no LLM, so it is free, instant,
deterministic and every sentence maps to a number in `facts`. xG, momentum and moments cover regulation and any extra time (never the shoot-out).
"""
import pandas as pd

from halfspace import derive
from halfspace import names as pn
from halfspace.models import momentum


def _top_players(conn, match_id: int) -> dict:
    d = derive.connect_derived()
    xtr = d.execute("SELECT player_id, team_id, xt FROM player_match_xt WHERE match_id=? ORDER BY xt DESC LIMIT 3", (match_id,)).fetchall()
    sh = derive.load_shots()
    sh = sh[(sh["match_id"] == match_id) & (sh["period"] <= 4)].merge(
        pd.read_sql("SELECT event_id, xg_v2 FROM shot_xg WHERE match_id = ?", d, params=(match_id,)), on="event_id", how="left")
    sh["xg"] = sh["xg_v2"].fillna(sh["xg_sb"]).fillna(0.05)
    sx = sh.groupby(["player_id", "team_id"])["xg"].sum().sort_values(ascending=False).head(3)
    ids = {int(r["player_id"]) for r in xtr} | {int(p) for p, _ in sx.index if p == p}
    names = {r["id"]: r["name"] for r in conn.execute(f"SELECT id, name FROM player WHERE id IN ({','.join(map(str, ids)) or '0'})")}
    shown = pn.display_names(conn, ids)
    return {"threat_creators": [{"player": names.get(int(r["player_id"])), "display_name": shown.get(int(r["player_id"])), "team_id": int(r["team_id"]), "xt": round(r["xt"], 2)} for r in xtr],
            "shooters": [{"player": names.get(int(p)), "display_name": shown.get(int(p)), "team_id": int(t), "xg": round(float(v), 2)} for (p, t), v in sx.items()]}


def _stretches(mom: list[float], thresh=35, min_len=6) -> list[tuple[str, int, int]]:
    out, cur, start = [], 0, 0
    for m, v in enumerate(list(mom) + [0]):
        side = 1 if v >= thresh else -1 if v <= -thresh else 0
        if side != cur:
            if cur and m - start >= min_len:
                out.append(("home" if cur > 0 else "away", start, m - 1))
            cur, start = side, m
    return out


def match_report(conn, match_id: int) -> dict | None:
    row = conn.execute("""SELECT m.home_score, m.away_score, m.home_team_id, m.away_team_id, ht.name AS home, at.name AS away,
                                 c.name AS comp, s.name AS season
                          FROM match m JOIN team ht ON ht.id=m.home_team_id JOIN team at ON at.id=m.away_team_id
                          JOIN competition c ON c.id=m.competition_id JOIN season s ON s.id=m.season_id WHERE m.id=?""", (match_id,)).fetchone()
    story = momentum.match_story(conn, match_id)
    if row is None or story is None:
        return None
    home, away = row["home"], row["away"]
    xh, xa = story["xg_cumulative"]["home"][-1], story["xg_cumulative"]["away"][-1]
    lines = [f"{home} {row['home_score']}-{row['away_score']} {away} ({row['comp']} {row['season']}). "
             f"Shot quality (xG): {home} {xh:.2f}, {away} {xa:.2f}."]
    mt = derive.load_matches()
    maxp = int(mt.loc[mt["match_id"] == match_id, "max_period"].iloc[0]) if (mt["match_id"] == match_id).any() else 2
    if maxp >= 3:
        lines.append("Extra time was played: xG, momentum and key moments below include it; the penalty shoot-out is not counted.")
    gap = xh - xa
    if abs(gap) < 0.4:
        lines.append("The chances were close to even.")
    else:
        better, worse = (home, away) if gap > 0 else (away, home)
        won = (row["home_score"] - row["away_score"]) * (1 if gap > 0 else -1)
        lines.append(f"{better} created the better chances by {abs(gap):.1f} xG" +
                     (", though the result did not reflect it." if won < 0 else (", and the scoreline agreed." if won > 0 else ", but the match was level.")))
    for side, a, b in _stretches(story["momentum"]):
        lines.append(f"{home if side == 'home' else away} were on top from minute {a} to {b} (momentum above 35 for the trailing 10 minutes).")
    names = {row["home_team_id"]: home, row["away_team_id"]: away}
    for mo in story["moments"]:
        tag = "Goal" if mo["kind"] == "goal" else "Big chance"
        lines.append(f"{mo['minute']}': {tag} - {mo.get('display_name') or mo['player']} ({names.get(mo['team_id'])}), xG {mo['xg']:.2f}.")
    tp = _top_players(conn, match_id)
    if tp["threat_creators"]:
        lines.append("Most threat created (xT): " + ", ".join(f"{p['display_name'] or p['player']} {p['xt']}" for p in tp["threat_creators"]) + ".")
    poss = derive.connect_derived().execute("SELECT team_id, pattern, COUNT(*) n, SUM(xg) xg FROM possession_special WHERE match_id=? GROUP BY team_id, pattern", (match_id,)).fetchall()
    sp = [f"{names.get(r['team_id'])}: {r['n']} {r['pattern'].replace('From ', '').lower()}s ({r['xg']:.2f} xG)" for r in poss if r["pattern"] in ("From Counter", "From Corner")]
    if sp:
        lines.append("Counters and corners - " + "; ".join(sp) + ".")
    return {"match_id": match_id, "text": lines, "facts": {"xg": {"home": round(xh, 2), "away": round(xa, 2)}, "moments": story["moments"],
            "top_players": tp, "on_top_stretches": _stretches(story["momentum"])},
            "note": "Generated from model outputs by templates; includes extra time when played, never the shoot-out. See the How this works page for the methods."}

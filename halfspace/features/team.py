"""
Team intelligence: season-level tactical profile. PPDA aggregation ported
from the scratchpad script that validated it against real WC2022 results
(Spain/Germany as top pressers, Morocco/Qatar/Costa Rica as deep blocks).
"""
import sqlite3

from halfspace.features import ppda


def season_team_profiles(conn: sqlite3.Connection, competition_id: int, season_id: int) -> list[dict]:
    """PPDA + shot/goal volume per team, averaged across their matches in this competition/season."""
    matches = conn.execute(
        "SELECT id, home_team_id, away_team_id FROM match WHERE competition_id = ? AND season_id = ?",
        (competition_id, season_id),
    ).fetchall()

    per_team = {}

    def bucket(team_id):
        return per_team.setdefault(team_id, {"team_id": team_id, "matches": 0, "ppda_values": [], "goals": 0, "shots": 0})

    for m in matches:
        match_ppda = ppda(conn, m["id"])
        for team_id, val in match_ppda.items():
            bucket(team_id)["ppda_values"].append(val)

        shot_rows = conn.execute(
            "SELECT team_id, outcome_name FROM event WHERE match_id = ? AND type_name = 'Shot' AND period IN (1,2,3,4)",
            (m["id"],),
        ).fetchall()
        for r in shot_rows:
            if r["team_id"] is None:
                continue
            b = bucket(r["team_id"])
            b["shots"] += 1
            if r["outcome_name"] == "Goal":
                b["goals"] += 1

        for tid in (m["home_team_id"], m["away_team_id"]):
            if tid is not None:
                bucket(tid)["matches"] += 1

    team_names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM team").fetchall()}

    out = []
    for tid, b in per_team.items():
        if b["matches"] == 0:
            continue
        avg_ppda = sum(b["ppda_values"]) / len(b["ppda_values"]) if b["ppda_values"] else None
        out.append({
            "team_id": tid, "team": team_names.get(tid), "matches": b["matches"],
            "avg_ppda": round(avg_ppda, 2) if avg_ppda is not None else None,
            "goals_per_match": round(b["goals"] / b["matches"], 2),
            "shots_per_match": round(b["shots"] / b["matches"], 2),
            "low_sample": b["matches"] < 4,
        })
    out.sort(key=lambda t: t["avg_ppda"] if t["avg_ppda"] is not None else 999)
    return out

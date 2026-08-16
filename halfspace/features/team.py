"""
Team intelligence: season-level tactical profile. PPDA aggregation ported
from the scratchpad script that validated it against real WC2022 results
(Spain/Germany as top pressers, Morocco/Qatar/Costa Rica as deep blocks).
"""
import sqlite3

from halfspace.features import ppda

# Same rationale as halfspace.features.player._profile_cache: this computes PPDA
# per match in a Python loop over every match in the competition/season (380 for
# La Liga), measured at 4+ seconds uncached. Events are static between ingestion
# runs, so process-lifetime caching is a real fix - restart the server after
# re-ingesting to pick up new data.
_profile_cache: dict[tuple[int, int], list[dict]] = {}


def season_team_profiles(conn: sqlite3.Connection, competition_id: int, season_id: int) -> list[dict]:
    """PPDA + shot/goal volume per team, averaged across their matches in this competition/season."""
    cache_key = (competition_id, season_id)
    if cache_key in _profile_cache:
        return _profile_cache[cache_key]

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
    _profile_cache[cache_key] = out
    return out


def compare_teams(conn: sqlite3.Connection, team_a: int, team_b: int, competition_id: int, season_id: int) -> dict:
    profiles = {t["team_id"]: t for t in season_team_profiles(conn, competition_id, season_id)}
    a, b = profiles.get(team_a), profiles.get(team_b)
    if not a or not b:
        missing = [tid for tid in (team_a, team_b) if tid not in profiles]
        return {"error": f"team(s) not found in this competition/season: {missing}"}

    caveat = None
    if a["low_sample"] or b["low_sample"]:
        low = [t["team"] for t in (a, b) if t["low_sample"]]
        caveat = f"{', '.join(low)} played fewer than 4 matches in this competition - PPDA comparison is low-confidence."
    return {
        "team_a": a, "team_b": b,
        "diff_a_minus_b": {"avg_ppda": round((a["avg_ppda"] or 0) - (b["avg_ppda"] or 0), 2),
                            "goals_per_match": round(a["goals_per_match"] - b["goals_per_match"], 2)},
        "caveat": caveat,
    }

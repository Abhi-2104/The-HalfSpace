"""
Player intelligence: season-level per-90 profiles + role-aware similarity.
Ported from the scratchpad prototype that validated this against real facts
(Suárez topping goals/90 for his actual Pichichi-winning season, Messi's top
similarity match landing on Neymar) - same logic, now reading the canonical
DB instead of ad-hoc pandas over raw JSON.
"""
import sqlite3

import numpy as np

from halfspace.features import is_progressive_pass

MIN_MINUTES = 900  # ~10 full matches - reliability floor, matches scratchpad validation

# attacking positions only - role peer group for similarity (project spec: role/position-aware comparison)
ATTACK_POSITIONS = {
    "Right Wing", "Left Wing", "Center Forward", "Left Center Forward",
    "Right Center Forward", "Secondary Striker",
}

SIMILARITY_FEATURES = [
    "goals_p90", "shots_p90", "key_passes_p90", "prog_passes_p90",
    "prog_carries_p90", "dribbles_completed_p90", "pressures_p90", "touches_p90",
]


# Process-level cache: computing this scans every event for the competition/season
# (700k+ rows for a full league season) with a per-row Python check for progressive
# actions - real measured cost was 4+ seconds for La Liga 2015/16, turning every
# player-detail/similarity page load into a multi-second spinner. The underlying
# events don't change between ingestion runs, so caching for the life of the API
# process is a real fix, not a workaround - restart the server after re-ingesting
# a competition to pick up new data.
_profile_cache: dict[tuple[int, int], list[dict]] = {}


def season_player_profiles(conn: sqlite3.Connection, competition_id: int, season_id: int) -> list[dict]:
    """One row per player with >=MIN_MINUTES in this competition/season, per-90 features."""
    cache_key = (competition_id, season_id)
    if cache_key in _profile_cache:
        return _profile_cache[cache_key]

    minutes_rows = conn.execute(
        """SELECT player_id, SUM(minutes) AS minutes,
                  (SELECT position FROM player_match_minutes p2
                   WHERE p2.player_id = pmm.player_id
                   GROUP BY position ORDER BY COUNT(*) DESC LIMIT 1) AS position,
                  (SELECT team_id FROM player_match_minutes p3
                   WHERE p3.player_id = pmm.player_id
                   GROUP BY team_id ORDER BY COUNT(*) DESC LIMIT 1) AS team_id
           FROM player_match_minutes pmm
           JOIN match m ON m.id = pmm.match_id
           WHERE m.competition_id = ? AND m.season_id = ?
           GROUP BY player_id
           HAVING SUM(minutes) >= ?""",
        (competition_id, season_id, MIN_MINUTES),
    ).fetchall()

    profiles = {}
    for r in minutes_rows:
        profiles[r["player_id"]] = {
            "player_id": r["player_id"], "minutes": r["minutes"],
            "position": r["position"], "team_id": r["team_id"],
            "goals": 0, "shots": 0, "key_passes": 0, "prog_passes": 0,
            "prog_carries": 0, "dribbles_completed": 0, "pressures": 0, "touches": 0,
        }
    if not profiles:
        return []

    player_ids = tuple(profiles.keys())
    placeholders = ",".join("?" * len(player_ids))
    events = conn.execute(
        f"""SELECT e.player_id, e.type_name, e.outcome_name, e.x, e.end_x, e.shot_assist
            FROM event e JOIN match m ON m.id = e.match_id
            WHERE m.competition_id = ? AND m.season_id = ? AND e.player_id IN ({placeholders})""",
        (competition_id, season_id, *player_ids),
    ).fetchall()

    for e in events:
        p = profiles[e["player_id"]]
        p["touches"] += 1
        if e["type_name"] == "Shot":
            p["shots"] += 1
            if e["outcome_name"] == "Goal":
                p["goals"] += 1
        elif e["type_name"] == "Pass":
            if e["shot_assist"]:
                p["key_passes"] += 1
            if is_progressive_pass(e["x"], e["end_x"]):
                p["prog_passes"] += 1
        elif e["type_name"] == "Carry":
            if is_progressive_pass(e["x"], e["end_x"]):
                p["prog_carries"] += 1
        elif e["type_name"] == "Dribble" and e["outcome_name"] == "Complete":
            p["dribbles_completed"] += 1
        elif e["type_name"] == "Pressure":
            p["pressures"] += 1

    names = {r["id"]: r["name"] for r in conn.execute(
        f"SELECT id, name FROM player WHERE id IN ({placeholders})", player_ids).fetchall()}
    team_names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM team").fetchall()}

    out = []
    for p in profiles.values():
        minutes = p["minutes"]
        row = {
            "player_id": p["player_id"], "name": names.get(p["player_id"]),
            "team": team_names.get(p["team_id"]), "position": p["position"], "minutes": round(minutes, 1),
        }
        for key in ("goals", "shots", "key_passes", "prog_passes", "prog_carries", "dribbles_completed", "pressures", "touches"):
            row[f"{key}_p90"] = round(p[key] / minutes * 90, 2)
        out.append(row)
    _profile_cache[cache_key] = out
    return out


def similar_players(conn: sqlite3.Connection, competition_id: int, season_id: int, player_id: int, top_n: int = 8) -> dict:
    """
    Role-aware similarity: cosine distance over standardized per-90 features,
    restricted to the target's attacking-position peer group when the target
    plays an attacking position (project spec: explain similarity, don't just
    output a percentage - the feature breakdown IS the explanation here).
    """
    profiles = season_player_profiles(conn, competition_id, season_id)
    if not profiles:
        return {"error": "no players with sufficient minutes in this competition/season"}

    target = next((p for p in profiles if p["player_id"] == player_id), None)
    if target is None:
        return {"error": f"player {player_id} not found with >= {MIN_MINUTES} minutes in this competition/season"}

    pool = profiles
    peer_group = "all positions (target's position not in the attacking peer-group list)"
    if target["position"] in ATTACK_POSITIONS:
        pool = [p for p in profiles if p["position"] in ATTACK_POSITIONS]
        peer_group = "attacking positions only"

    if len(pool) < 2:
        return {"error": "peer group too small for a meaningful comparison", "peer_group_size": len(pool)}

    X = np.array([[p[f] for f in SIMILARITY_FEATURES] for p in pool], dtype=float)
    mu, sigma = X.mean(axis=0), X.std(axis=0)
    sigma[sigma == 0] = 1
    Z = (X - mu) / sigma

    target_idx = next(i for i, p in enumerate(pool) if p["player_id"] == player_id)
    target_vec = Z[target_idx]
    norms = np.linalg.norm(Z, axis=1) * np.linalg.norm(target_vec) + 1e-9
    sims = (Z @ target_vec) / norms

    ranked = sorted(
        ((pool[i], float(sims[i])) for i in range(len(pool)) if i != target_idx),
        key=lambda t: -t[1],
    )[:top_n]

    return {
        "target": target,
        "peer_group": peer_group,
        "peer_group_size": len(pool),
        "reliability_note": f"minimum {MIN_MINUTES} minutes required; small peer groups reduce confidence" if len(pool) < 15 else None,
        "most_similar": [
            {"player_id": p["player_id"], "name": p["name"], "team": p["team"], "similarity": round(sim, 3),
             "features": {f: p[f] for f in SIMILARITY_FEATURES}}
            for p, sim in ranked
        ],
    }


def compare_players(conn: sqlite3.Connection, player_a: int, player_b: int, competition_id: int, season_id: int) -> dict:
    """Head-to-head. Flags role_mismatch + a caveat when the comparison isn't
    apples-to-apples - a judgment the tool itself makes, not left to whatever
    calls it (API route or agent) to remember to apply."""
    profiles = {p["player_id"]: p for p in season_player_profiles(conn, competition_id, season_id)}
    a, b = profiles.get(player_a), profiles.get(player_b)
    if not a or not b:
        missing = [pid for pid in (player_a, player_b) if pid not in profiles]
        return {"error": f"player(s) not found with >= {MIN_MINUTES} minutes: {missing}"}

    diff = {f: round(a[f] - b[f], 2) for f in SIMILARITY_FEATURES}
    role_mismatch = a["position"] != b["position"]
    caveat = None
    if role_mismatch:
        caveat = (f"{a['name']} ({a['position']}) and {b['name']} ({b['position']}) play different positions - "
                  "a raw stat comparison may not be meaningful. Consider find_similar_players within a role "
                  "peer group instead of a direct head-to-head.")
    return {"player_a": a, "player_b": b, "diff_a_minus_b": diff, "role_mismatch": role_mismatch, "caveat": caveat}

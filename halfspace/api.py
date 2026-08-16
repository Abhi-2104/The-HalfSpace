"""
FastAPI surface. Thin: it calls halfspace.features, it doesn't reimplement logic -
this is also what the agent layer will call later (same tools, no separate DB access
path for the agent - see project spec section 19/23).
"""
from fastapi import FastAPI, HTTPException, Query

from halfspace import db, features, tactical
from halfspace.features import player as player_features
from halfspace.features import team as team_features
from halfspace.features import sequences, spatial

app = FastAPI(title="HalfSpace API")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/matches/{match_id}/profile")
def match_profile(match_id: int):
    conn = db.connect()
    match = conn.execute("SELECT * FROM match WHERE id = ?", (match_id,)).fetchone()
    if not match:
        raise HTTPException(404, f"match {match_id} not ingested yet")

    coverage = conn.execute("SELECT * FROM data_coverage WHERE match_id = ?", (match_id,)).fetchone()

    return {
        "match_id": match_id,
        "coverage": dict(coverage) if coverage else None,
        "shots": features.shot_summary(conn, match_id),
        "goals": features.goals_timeline(conn, match_id),
        "ppda": features.ppda(conn, match_id),
        "progressive_passes_by_player": features.player_progressive_passes(conn, match_id),
    }


@app.get("/matches/{match_id}/sequences")
def match_sequences(match_id: int):
    conn = db.connect()
    match = conn.execute("SELECT 1 FROM match WHERE id = ?", (match_id,)).fetchone()
    if not match:
        raise HTTPException(404, f"match {match_id} not ingested yet")
    return {"match_id": match_id, "counterattacks": sequences.find_counterattacks(conn, match_id)}


@app.get("/competitions/{competition_id}/seasons/{season_id}/players")
def season_players(competition_id: int, season_id: int):
    conn = db.connect()
    profiles = player_features.season_player_profiles(conn, competition_id, season_id)
    if not profiles:
        raise HTTPException(404, "no players with sufficient minutes for this competition/season")
    return {"competition_id": competition_id, "season_id": season_id, "min_minutes": player_features.MIN_MINUTES,
            "players": sorted(profiles, key=lambda p: -p["goals_p90"])}


@app.get("/competitions/{competition_id}/seasons/{season_id}/players/{player_id}/similar")
def similar_players(competition_id: int, season_id: int, player_id: int, top_n: int = Query(8, ge=1, le=25)):
    conn = db.connect()
    result = player_features.similar_players(conn, competition_id, season_id, player_id, top_n=top_n)
    if "error" in result:
        raise HTTPException(404, result["error"])
    return result


@app.get("/players/compare")
def compare_players(
    player_a: int, player_b: int, competition_id: int, season_id: int,
):
    conn = db.connect()
    profiles = {p["player_id"]: p for p in player_features.season_player_profiles(conn, competition_id, season_id)}
    a, b = profiles.get(player_a), profiles.get(player_b)
    if not a or not b:
        missing = [pid for pid in (player_a, player_b) if pid not in profiles]
        raise HTTPException(404, f"player(s) not found with >= {player_features.MIN_MINUTES} minutes: {missing}")

    diff = {f: round(a[f] - b[f], 2) for f in player_features.SIMILARITY_FEATURES}
    role_mismatch = a["position"] != b["position"]
    caveat = None
    if role_mismatch:
        caveat = (f"{a['name']} ({a['position']}) and {b['name']} ({b['position']}) play different positions - "
                  "a raw stat comparison may not be meaningful. Consider find_similar_players within a role "
                  "peer group instead of a direct head-to-head.")
    return {"player_a": a, "player_b": b, "diff_a_minus_b": diff, "role_mismatch": role_mismatch, "caveat": caveat}


@app.get("/competitions/{competition_id}/seasons/{season_id}/teams")
def season_teams(competition_id: int, season_id: int):
    conn = db.connect()
    profiles = team_features.season_team_profiles(conn, competition_id, season_id)
    if not profiles:
        raise HTTPException(404, "no team data for this competition/season")
    return {"competition_id": competition_id, "season_id": season_id, "teams": profiles}


@app.get("/teams/compare")
def compare_teams(team_a: int, team_b: int, competition_id: int, season_id: int):
    conn = db.connect()
    profiles = {t["team_id"]: t for t in team_features.season_team_profiles(conn, competition_id, season_id)}
    a, b = profiles.get(team_a), profiles.get(team_b)
    if not a or not b:
        missing = [tid for tid in (team_a, team_b) if tid not in profiles]
        raise HTTPException(404, f"team(s) not found in this competition/season: {missing}")

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


@app.get("/tracking")
def tracking_data(provider: str | None = None):
    conn = db.connect()
    return {"rows": spatial.team_shape(conn, provider)}


@app.get("/tracking/{provider}/{provider_match_id}")
def tracking_match(provider: str, provider_match_id: str):
    conn = db.connect()
    rows = spatial.match_shape(conn, provider, provider_match_id)
    if not rows:
        raise HTTPException(404, f"no tracking data for {provider}/{provider_match_id}")
    return {"rows": rows}


@app.get("/tactical-concepts")
def tactical_concepts():
    concepts = tactical.load_concepts()
    return {"concepts": [{"slug": c["slug"], "name": c["name"], "confidence": c["confidence"]} for c in concepts]}


@app.get("/tactical-concepts/{slug}")
def tactical_concept(slug: str):
    concept = tactical.get_concept(slug)
    if not concept:
        raise HTTPException(404, f"unknown tactical concept '{slug}'")
    return concept

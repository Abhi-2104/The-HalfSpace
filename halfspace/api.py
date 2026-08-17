"""
FastAPI surface. Thin: it calls halfspace.features, it doesn't reimplement logic -
this is also what the agent layer will call later (same tools, no separate DB access
path for the agent - see project spec section 19/23).
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from halfspace import db, lookups, tactical
from halfspace.features import player as player_features
from halfspace.features import team as team_features
from halfspace.features import sequences, spatial, pitch


def warm_caches():
    """player/team season profiles are process-cached (see halfspace/features/player.py,
    team.py) because computing them scans every event in the competition/season - without
    this, whichever user's request happens to be first for a given competition eats a
    multi-second cold-compute. Precomputing at startup means nobody ever sees that."""
    conn = db.connect()
    for row in conn.execute("SELECT DISTINCT competition_id, season_id FROM match").fetchall():
        player_features.season_player_profiles(conn, row["competition_id"], row["season_id"])
        team_features.season_team_profiles(conn, row["competition_id"], row["season_id"])


@asynccontextmanager
async def lifespan(app: FastAPI):
    warm_caches()
    yield


app = FastAPI(title="HalfSpace API", lifespan=lifespan)

# dev-only: frontend runs on Vite's default port, backend on uvicorn's.
# Both are localhost, no real cross-origin trust boundary to defend at this stage.
app.add_middleware(
    CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET"], allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/overview")
def overview():
    return lookups.get_overview(db.connect())


@app.get("/competitions")
def competitions():
    return {"competitions": lookups.list_competitions(db.connect())}


@app.get("/matches")
def list_matches(competition_id: int, season_id: int):
    return {"matches": lookups.list_matches(db.connect(), competition_id, season_id)}


@app.get("/matches/{match_id}/shots")
def match_shots(match_id: int):
    conn = db.connect()
    shots = lookups.get_match_shots(conn, match_id)
    if not shots and not lookups.get_match(conn, match_id):
        raise HTTPException(404, f"match {match_id} not ingested yet")
    return {"match_id": match_id, "shots": shots}


@app.get("/matches/{match_id}")
def match_detail(match_id: int):
    match = lookups.get_match(db.connect(), match_id)
    if not match:
        raise HTTPException(404, f"match {match_id} not ingested yet")
    return match


@app.get("/matches/{match_id}/profile")
def match_profile(match_id: int):
    profile = lookups.get_match_profile(db.connect(), match_id)
    if not profile:
        raise HTTPException(404, f"match {match_id} not ingested yet")
    return profile


@app.get("/matches/{match_id}/sequences")
def match_sequences(match_id: int):
    conn = db.connect()
    if not lookups.get_match(conn, match_id):
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
def compare_players(player_a: int, player_b: int, competition_id: int, season_id: int):
    result = player_features.compare_players(db.connect(), player_a, player_b, competition_id, season_id)
    if "error" in result:
        raise HTTPException(404, result["error"])
    return result


@app.get("/competitions/{competition_id}/seasons/{season_id}/teams")
def season_teams(competition_id: int, season_id: int):
    conn = db.connect()
    profiles = team_features.season_team_profiles(conn, competition_id, season_id)
    if not profiles:
        raise HTTPException(404, "no team data for this competition/season")
    return {"competition_id": competition_id, "season_id": season_id, "teams": profiles}


@app.get("/teams/compare")
def compare_teams(team_a: int, team_b: int, competition_id: int, season_id: int):
    result = team_features.compare_teams(db.connect(), team_a, team_b, competition_id, season_id)
    if "error" in result:
        raise HTTPException(404, result["error"])
    return result


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


# --- pitch visualization endpoints (6B) ---

@app.get("/matches/{match_id}/shots-xg")
def match_shots_xg(match_id: int):
    """Shots with xG-lite score + freeze-frame availability - drives the upgraded shot map."""
    conn = db.connect()
    if not lookups.get_match(conn, match_id):
        raise HTTPException(404, f"match {match_id} not ingested yet")
    return {"match_id": match_id, "shots": pitch.match_shots_with_xg(conn, match_id)}


@app.get("/events/{event_id}/freeze-frame")
def event_freeze_frame(event_id: str):
    """360 freeze-frame for one event (usually a shot): every visible player's position."""
    frame = pitch.shot_freeze_frame(db.connect(), event_id)
    if not frame:
        raise HTTPException(404, f"no 360 freeze-frame for event {event_id}")
    return frame


@app.get("/matches/{match_id}/players/{player_id}/heatmap")
def player_heatmap(match_id: int, player_id: int):
    return pitch.player_heatmap(db.connect(), match_id, player_id)


@app.get("/competitions/{competition_id}/seasons/{season_id}/players/{player_id}/heatmap")
def season_player_heatmap(competition_id: int, season_id: int, player_id: int):
    return pitch.season_player_heatmap(db.connect(), competition_id, season_id, player_id)


@app.get("/matches/{match_id}/teams/{team_id}/heatmap")
def team_heatmap(match_id: int, team_id: int):
    return pitch.team_heatmap(db.connect(), match_id, team_id)


@app.get("/matches/{match_id}/teams/{team_id}/pass-network")
def pass_network(match_id: int, team_id: int):
    conn = db.connect()
    if not lookups.get_match(conn, match_id):
        raise HTTPException(404, f"match {match_id} not ingested yet")
    return pitch.pass_network(conn, match_id, team_id)

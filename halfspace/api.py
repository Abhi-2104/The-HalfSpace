"""
FastAPI surface. Thin: it calls halfspace.features, it doesn't reimplement logic -
this is also what the agent layer will call later (same tools, no separate DB access
path for the agent - see project spec section 19/23).
"""
import asyncio
import os
from contextlib import asynccontextmanager

from dataclasses import asdict
from typing import Literal

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from halfspace import db, lookups, tactical
from halfspace.agent.llm import LLMClient, groq_client
from halfspace.agent.orchestrator import Agent
from halfspace.features import player as player_features
from halfspace.features import team as team_features
from halfspace.features import sequences, spatial, pitch
from halfspace.api_models import router as models_router


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
    # Warm in the background so the API answers straight away, even while a long ingest is
    # writing to the database. Requests that arrive first just compute their own profile.
    async def _warm():
        try:
            await asyncio.to_thread(warm_caches)
        except Exception as exc:  # a busy database must not stop the API from serving
            print(f"cache warm-up skipped: {exc}")

    # ponytail: opt-in (HALFSPACE_WARM=1). Scanning every season on a busy, growing database starved the
    # request loop for minutes; profiles are cached after their first request anyway.
    task = asyncio.create_task(_warm()) if os.environ.get("HALFSPACE_WARM") else None
    yield
    if task:
        task.cancel()


app = FastAPI(
    title="The Halfspace API",
    description="Real open football data: matches, players, teams, tactics and an analyst agent. By Abhijith Varma.",
    lifespan=lifespan,
)
app.include_router(models_router)

# dev-only: frontend runs on Vite's default port, backend on uvicorn's.
# Both are localhost, no real cross-origin trust boundary to defend at this stage.
app.add_middleware(
    CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST"], allow_headers=["*"],
)


def get_llm() -> LLMClient:
    """Dependency so tests (and a future fallback wrapper) can swap the model."""
    try:
        return groq_client()
    except KeyError:
        raise HTTPException(503, "agent unavailable: GROQ_API_KEY not set")


class Turn(BaseModel):
    # only user/assistant: a client must not be able to inject system or tool messages
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    history: list[Turn] = Field(default_factory=list, max_length=20)


# sync def: the agent loop is blocking httpx, so FastAPI runs it in its threadpool.
# ponytail: stateless - the client holds the conversation and sends it back as `history`
# (no sessions/DB on the server). No streaming; add SSE if latency hurts the chat UI.
@app.post("/agent/ask")
def agent_ask(req: AskRequest, llm: LLMClient = Depends(get_llm)):
    try:
        answer = Agent(llm).run(req.question, [t.model_dump() for t in req.history])
    except httpx.HTTPStatusError as e:
        code = 429 if e.response.status_code == 429 else 502
        raise HTTPException(code, f"LLM provider error: HTTP {e.response.status_code}")
    except httpx.HTTPError as e:
        raise HTTPException(502, f"LLM provider unreachable: {type(e).__name__}")
    return asdict(answer)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/overview")
def overview():
    return lookups.get_overview(db.connect())


@app.get("/competitions")
def competitions():
    return {"competitions": lookups.list_competitions(db.connect())}


@app.get("/matches/search")
def search_matches(team: str, opponent: str | None = None, competition_id: int | None = None,
                   season_id: int | None = None, limit: int = Query(12, le=50)):
    """Find matches by team name (substring), optionally vs an opponent, optionally within one competition/season."""
    return {"matches": lookups.find_matches(db.connect(), team, opponent, competition_id, season_id, limit)}


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

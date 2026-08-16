"""
FastAPI surface. Thin: it calls halfspace.features, it doesn't reimplement logic -
this is also what the agent layer will call later (same tools, no separate DB access
path for the agent - see project spec section 19/23).
"""
from fastapi import FastAPI, HTTPException

from halfspace import db, features

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

"""Endpoints backed by trained models (xG v2, win probability, ...). Kept in its own router so
api.py stays a thin list of lookups. Model files and cards live in data/models/."""
import json

from fastapi import APIRouter, HTTPException

from halfspace import db, lookups
from halfspace.models import momentum, report, roles, serve, xg

router = APIRouter()


@router.get("/models")
def list_models():
    return {"models": serve.all_cards()}


@router.get("/models/{name}")
def model_card(name: str):
    path = xg.MODEL_DIR / f"{name}_card.json"
    if not name.replace("_", "").isalnum() or not path.exists():
        raise HTTPException(404, f"no model card '{name}'")
    return json.loads(path.read_text())


@router.get("/events/{event_id}/xg-explain")
def xg_explain(event_id: str):
    """Why this shot has the xG it has: top factors, approximate one-at-a-time attribution."""
    out = xg.explain_event(event_id)
    if out is None:
        raise HTTPException(404, f"no shot {event_id} in the derived shot table")
    return out


@router.get("/matches/{match_id}/momentum")
def match_momentum(match_id: int):
    """Who is on top each minute (trailing 10-minute threat share, -100..100), key moments, cumulative xG."""
    conn = db.connect()
    if not lookups.get_match(conn, match_id):
        raise HTTPException(404, f"match {match_id} not ingested yet")
    story = momentum.match_story(conn, match_id)
    if story is None:
        raise HTTPException(404, f"no momentum data for match {match_id} (run scripts/build_models.py)")
    return story


@router.get("/competitions/{competition_id}/seasons/{season_id}/players/{player_id}/profile")
def player_profile(competition_id: int, season_id: int, player_id: int):
    """Scouting card: per-90 values, sample-size-adjusted values and pool percentiles."""
    out = serve.player_profile(db.connect(), competition_id, season_id, player_id)
    if out is None:
        raise HTTPException(404, "no profile (needs 300+ minutes in this competition-season)")
    return out


@router.get("/competitions/{competition_id}/seasons/{season_id}/leaders")
def leaders(competition_id: int, season_id: int, metric: str = "npxg", position_group: str | None = None, top_n: int = 15):
    out = serve.leaders(db.connect(), competition_id, season_id, metric, position_group, min(top_n, 50))
    if "error" in out:
        raise HTTPException(400, out["error"])
    return out


@router.get("/models/xt/grid")
def xt_grid():
    """The xT value of each pitch zone (16 x 12, attacking left to right), for a heat-map."""
    path = xg.MODEL_DIR / "xt_grid.json"
    if not path.exists():
        raise HTTPException(404, "xT not built yet")
    return json.loads(path.read_text())


@router.get("/matches/{match_id}/possessions/{kind}")
def match_possessions(match_id: int, kind: str):
    """Counterattacks, corners or free kicks in one match (kind = counter | corner | free_kick), with xG each."""
    out = serve.match_possessions(db.connect(), match_id, kind)
    if "error" in out:
        raise HTTPException(400, out["error"])
    return out


@router.get("/competitions/{competition_id}/seasons/{season_id}/patterns/{kind}")
def team_patterns(competition_id: int, season_id: int, kind: str):
    out = serve.team_patterns(db.connect(), competition_id, season_id, kind)
    if "error" in out:
        raise HTTPException(400, out["error"])
    return out


@router.get("/competitions/{competition_id}/seasons/{season_id}/team-styles")
def team_styles(competition_id: int, season_id: int):
    """Style-map points (x, y, archetype, z-scores) for every team with 4+ matches."""
    out = serve.team_styles(db.connect(), competition_id, season_id)
    if "error" in out:
        raise HTTPException(404, out["error"])
    return out


@router.get("/teams/{team_id}/similar-styles")
def similar_styles(team_id: int, competition_id: int, season_id: int):
    out = serve.similar_styles(db.connect(), team_id, competition_id, season_id)
    if "error" in out:
        raise HTTPException(404, out["error"])
    return out


@router.get("/competitions/{competition_id}/seasons/{season_id}/goalkeepers")
def goalkeepers(competition_id: int, season_id: int, top_n: int = 15):
    out = serve.goalkeepers(db.connect(), competition_id, season_id, min(top_n, 50))
    if "error" in out:
        raise HTTPException(404, out["error"])
    return out


@router.get("/competitions/{competition_id}/seasons/{season_id}/players/{player_id}/plays-like")
def plays_like(competition_id: int, season_id: int, player_id: int, top_n: int = 8):
    """Players with the closest data-driven role/style across all competitions (style, not quality)."""
    out = roles.similar_players(db.connect(), player_id, competition_id, season_id, min(top_n, 20))
    if "error" in out:
        raise HTTPException(404, out["error"])
    return out


@router.get("/matches/{match_id}/report")
def match_report(match_id: int):
    """Template-built match report (text lines + the facts behind them)."""
    out = report.match_report(db.connect(), match_id)
    if out is None:
        raise HTTPException(404, f"no report for match {match_id} (not ingested or models not built)")
    return out

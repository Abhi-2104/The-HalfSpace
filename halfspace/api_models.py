"""Endpoints backed by trained models (xG v2, win probability, ...). Kept in its own router so
api.py stays a thin list of lookups. Model files and cards live in data/models/."""
import json

from fastapi import APIRouter, HTTPException

from halfspace import db, lookups
from halfspace.models import momentum, report, roles, search, serve, xg

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


# --- fixtures, results and standings (current season, from the serving DB) ---

def _fx_conn():
    from halfspace.ingest import fixtures
    return fixtures._conn()


def _best_source(c, code: str):
    """football-data.org when we have it for this competition (richer, official), else openfootball."""
    row = c.execute("SELECT source FROM fixture WHERE competition_code=? GROUP BY source "
                    "ORDER BY (source = 'football-data.org') DESC, MAX(updated_at) DESC LIMIT 1", (code,)).fetchone()
    return row["source"] if row else None


@router.get("/fixtures/competitions")
def fixture_competitions():
    c = _fx_conn()
    rows = c.execute("SELECT competition_code, competition, season, source, COUNT(*) n, SUM(status='FINISHED') finished, "
                     "MAX(updated_at) updated_at FROM fixture GROUP BY competition_code, source ORDER BY competition_code").fetchall()
    return {"competitions": [dict(r) for r in rows]}


@router.get("/fixtures")
def fixtures(competition: str, status: str | None = None, team: str | None = None, date_from: str | None = None,
             date_to: str | None = None, limit: int = 50):
    """Fixtures and results for one competition code (PL, PD, BL1, SA, FL1, PPL, DED, ...). status: SCHEDULED | FINISHED | LIVE."""
    c = _fx_conn()
    src = _best_source(c, competition.upper())
    if src is None:
        raise HTTPException(404, f"no fixtures for '{competition}' (run the refresh_fixtures job)")
    q, args = "SELECT * FROM fixture WHERE competition_code=? AND source=?", [competition.upper(), src]
    if status:
        q += " AND status=?"
        args.append(status.upper())
    if team:
        q += " AND (home LIKE ? OR away LIKE ?)"
        args += [f"%{team}%", f"%{team}%"]
    if date_from:
        q += " AND kickoff >= ?"
        args.append(date_from)
    if date_to:
        q += " AND kickoff <= ?"
        args.append(date_to + "T99")
    rows = c.execute(q + " ORDER BY kickoff LIMIT ?", (*args, min(limit, 500))).fetchall()
    return {"competition": competition.upper(), "source": src, "fixtures": [dict(r) for r in rows],
            "note": "Scores are delayed on the free football-data.org tier. openfootball is community-maintained and may lag."}


@router.get("/standings/{competition}")
def standings(competition: str):
    c = _fx_conn()
    src = _best_source(c, competition.upper())
    rows = c.execute("SELECT * FROM standing WHERE competition_code=? AND source=? ORDER BY position", (competition.upper(), src)).fetchall() if src else []
    if not rows:
        raise HTTPException(404, f"no standings for '{competition}'")
    return {"competition": competition.upper(), "source": src, "season": rows[0]["season"], "updated_at": rows[0]["updated_at"],
            "table": [dict(r) for r in rows],
            "note": "From openfootball results (computed) or football-data.org (official), whichever is available."}


# --- tracking-derived measures ---

@router.get("/tracking/{provider}/{match_id}/pitch-control")
def tracking_pitch_control(provider: str, match_id: str, grid: bool = True):
    out = serve.tracking_pitch_control(provider, match_id, grid)
    if out is None:
        raise HTTPException(404, "no pitch-control data for this match (only SkillCorner matches; run build_models tracking)")
    return out


@router.get("/tracking/{provider}/{match_id}/physical")
def tracking_physical(provider: str, match_id: str):
    out = serve.tracking_physical(provider, match_id)
    if out is None:
        raise HTTPException(404, "no physical data for this match")
    return out


@router.get("/tracking-physical/leaders")
def tracking_physical_leaders(metric: str = "sprints", top_n: int = 10):
    out = serve.tracking_physical_leaders(metric, min(top_n, 50))
    if "error" in out:
        raise HTTPException(400, out["error"])
    return out


@router.get("/search")
def search_all(q: str, kind: str | None = None, limit: int = 10):
    """Search players, teams, matches and tactical concepts by what they are like (kind: player|team|match|concept)."""
    if kind and kind not in ("player", "team", "match", "concept"):
        raise HTTPException(400, "kind must be player, team, match or concept")
    if not search.INDEX_PATH.exists():
        raise HTTPException(503, "search index not built yet (run build_models search)")
    return search.query(q[:200], kind, min(limit, 30))

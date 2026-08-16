"""
Tool registry for the agent - every tool is a thin wrapper over the exact
same functions the FastAPI routes call (halfspace.lookups, halfspace.features,
halfspace.tactical). No separate DB access path for the agent vs the frontend
(project spec section 19/23) - this is the enforcement of that, not just a
docstring claim: there is no tool here that queries the DB directly.
"""
from dataclasses import dataclass
from typing import Callable

from halfspace import db, lookups, tactical
from halfspace.features import player as player_features
from halfspace.features import team as team_features
from halfspace.features import sequences, spatial


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: dict  # JSON Schema, for whichever LLM's tool-calling format consumes it
    handler: Callable[..., dict]


def _wrap(fn):
    """Tool execution never raises into the agent loop - a bad call becomes
    an {"error": ...} the LLM can read and react to (retry, ask the user to
    clarify, or say it can't answer), not a crash."""
    def wrapped(**kwargs) -> dict:
        try:
            return fn(**kwargs)
        except Exception as exc:
            return {"error": f"{type(exc).__name__}: {exc}"}
    return wrapped


@_wrap
def list_competitions() -> dict:
    return {"competitions": lookups.list_competitions(db.connect())}


@_wrap
def list_matches(competition_id: int, season_id: int) -> dict:
    return {"matches": lookups.list_matches(db.connect(), competition_id, season_id)}


@_wrap
def get_match(match_id: int) -> dict:
    match = lookups.get_match(db.connect(), match_id)
    return match or {"error": f"match {match_id} not ingested"}


@_wrap
def get_match_profile(match_id: int) -> dict:
    profile = lookups.get_match_profile(db.connect(), match_id)
    return profile or {"error": f"match {match_id} not ingested"}


@_wrap
def get_match_sequences(match_id: int) -> dict:
    conn = db.connect()
    if not lookups.get_match(conn, match_id):
        return {"error": f"match {match_id} not ingested"}
    return {"match_id": match_id, "counterattacks": sequences.find_counterattacks(conn, match_id)}


@_wrap
def get_season_players(competition_id: int, season_id: int) -> dict:
    profiles = player_features.season_player_profiles(db.connect(), competition_id, season_id)
    if not profiles:
        return {"error": "no players with sufficient minutes for this competition/season"}
    return {"players": sorted(profiles, key=lambda p: -p["goals_p90"]), "min_minutes": player_features.MIN_MINUTES}


@_wrap
def get_similar_players(competition_id: int, season_id: int, player_id: int, top_n: int = 8) -> dict:
    return player_features.similar_players(db.connect(), competition_id, season_id, player_id, top_n=top_n)


@_wrap
def compare_players(player_a: int, player_b: int, competition_id: int, season_id: int) -> dict:
    return player_features.compare_players(db.connect(), player_a, player_b, competition_id, season_id)


@_wrap
def get_season_teams(competition_id: int, season_id: int) -> dict:
    profiles = team_features.season_team_profiles(db.connect(), competition_id, season_id)
    if not profiles:
        return {"error": "no team data for this competition/season"}
    return {"teams": profiles}


@_wrap
def compare_teams(team_a: int, team_b: int, competition_id: int, season_id: int) -> dict:
    return team_features.compare_teams(db.connect(), team_a, team_b, competition_id, season_id)


@_wrap
def get_tracking(provider: str = None) -> dict:
    return {"rows": spatial.team_shape(db.connect(), provider)}


@_wrap
def get_tactical_concepts() -> dict:
    concepts = tactical.load_concepts()
    return {"concepts": [{"slug": c["slug"], "name": c["name"], "confidence": c["confidence"]} for c in concepts]}


@_wrap
def get_tactical_concept(slug: str) -> dict:
    concept = tactical.get_concept(slug)
    return concept or {"error": f"unknown tactical concept '{slug}'"}


TOOLS: list[ToolSpec] = [
    ToolSpec("list_competitions", "List every ingested competition/season with match counts.", {"type": "object", "properties": {}}, list_competitions),
    ToolSpec("list_matches", "List matches in a competition/season.",
             {"type": "object", "properties": {"competition_id": {"type": "integer"}, "season_id": {"type": "integer"}}, "required": ["competition_id", "season_id"]},
             list_matches),
    ToolSpec("get_match", "Basic info for one match: teams, score, date.",
             {"type": "object", "properties": {"match_id": {"type": "integer"}}, "required": ["match_id"]}, get_match),
    ToolSpec("get_match_profile", "Shot summary, goals, PPDA, progressive passes for one match.",
             {"type": "object", "properties": {"match_id": {"type": "integer"}}, "required": ["match_id"]}, get_match_profile),
    ToolSpec("get_match_sequences", "Heuristically-detected counterattacks in one match (medium confidence).",
             {"type": "object", "properties": {"match_id": {"type": "integer"}}, "required": ["match_id"]}, get_match_sequences),
    ToolSpec("get_season_players", "Per-90 player profiles for a competition/season (min 900 minutes).",
             {"type": "object", "properties": {"competition_id": {"type": "integer"}, "season_id": {"type": "integer"}}, "required": ["competition_id", "season_id"]},
             get_season_players),
    ToolSpec("get_similar_players", "Role-aware most-similar players to a given player.",
             {"type": "object", "properties": {"competition_id": {"type": "integer"}, "season_id": {"type": "integer"},
                                                "player_id": {"type": "integer"}, "top_n": {"type": "integer"}},
              "required": ["competition_id", "season_id", "player_id"]},
             get_similar_players),
    ToolSpec("compare_players", "Head-to-head player comparison. Flags role_mismatch if positions differ.",
             {"type": "object", "properties": {"player_a": {"type": "integer"}, "player_b": {"type": "integer"},
                                                "competition_id": {"type": "integer"}, "season_id": {"type": "integer"}},
              "required": ["player_a", "player_b", "competition_id", "season_id"]},
             compare_players),
    ToolSpec("get_season_teams", "Team PPDA/goals/shots profiles for a competition/season.",
             {"type": "object", "properties": {"competition_id": {"type": "integer"}, "season_id": {"type": "integer"}}, "required": ["competition_id", "season_id"]},
             get_season_teams),
    ToolSpec("compare_teams", "Head-to-head team comparison. Flags low_sample if either played <4 matches.",
             {"type": "object", "properties": {"team_a": {"type": "integer"}, "team_b": {"type": "integer"},
                                                "competition_id": {"type": "integer"}, "season_id": {"type": "integer"}},
              "required": ["team_a", "team_b", "competition_id", "season_id"]},
             compare_teams),
    ToolSpec("get_tracking", "Team compactness (width/length) from tracking data, optionally filtered by provider.",
             {"type": "object", "properties": {"provider": {"type": "string"}}}, get_tracking),
    ToolSpec("get_tactical_concepts", "List all tactical concepts with their confidence tier.",
             {"type": "object", "properties": {}}, get_tactical_concepts),
    ToolSpec("get_tactical_concept", "Full detail for one tactical concept by slug.",
             {"type": "object", "properties": {"slug": {"type": "string"}}, "required": ["slug"]}, get_tactical_concept),
]

TOOLS_BY_NAME: dict[str, ToolSpec] = {t.name: t for t in TOOLS}

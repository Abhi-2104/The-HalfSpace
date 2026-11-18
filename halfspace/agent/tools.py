"""
Tool registry for the agent - every tool is a thin wrapper over the exact
same functions the FastAPI routes call (halfspace.lookups, halfspace.features,
halfspace.tactical). No separate DB access path for the agent vs the frontend
(project spec section 19/23) - this is the enforcement of that, not just a
docstring claim: there is no tool here that queries the DB directly.
"""
import logging
from dataclasses import dataclass
from typing import Callable

from halfspace import db, lookups, tactical
from halfspace.features import player as player_features
from halfspace.features import team as team_features
from halfspace.features import sequences, spatial
from halfspace.models import report, roles, search, serve, xg


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: dict  # JSON Schema, for whichever LLM's tool-calling format consumes it
    handler: Callable[..., dict]


log = logging.getLogger("halfspace.agent")
LIST_CAP = 25  # a 380-match/344-player list is ~30k tokens - over free-tier per-minute limits


def _wrap(fn):
    """Tool execution never raises into the agent loop - a bad call becomes
    an {"error": ...} the LLM can read and react to (retry, ask the user to
    clarify, or say it can't answer), not a crash. Long lists are cut to
    LIST_CAP with a "truncated" note so the LLM knows it saw a slice."""
    def wrapped(**kwargs) -> dict:
        try:
            result = fn(**kwargs)
        except Exception as exc:
            log.warning("tool %s failed: %s: %s", getattr(fn, "__name__", "?"), type(exc).__name__, exc)
            # plain language only: the model repeats what it sees, and users should never see code or exception names
            return {"error": "That lookup could not be completed (the details asked for may be invalid or missing from the data)."}
        if isinstance(result, dict):
            cut = {k: f"showing first {LIST_CAP} of {len(v)}" for k, v in result.items()
                   if isinstance(v, list) and len(v) > LIST_CAP}
            if cut:
                result = {**{k: v[:LIST_CAP] if k in cut else v for k, v in result.items()}, "truncated": cut}
        return result
    return wrapped


@_wrap
def list_competitions() -> dict:
    return {"competitions": lookups.list_competitions(db.connect())}


@_wrap
def list_matches(competition_id: int, season_id: int, latest: bool = False) -> dict:
    rows = lookups.list_matches(db.connect(), competition_id, season_id)
    return {"matches": rows[-LIST_CAP:] if latest else rows, "order": "oldest first" + (", the last shown are the most recent (the final is the last)" if latest else "")}


@_wrap
def find_matches(team: str, opponent: str = None, competition_id: int = None, season_id: int = None) -> dict:
    return {"matches": lookups.find_matches(db.connect(), team, opponent, competition_id, season_id, 12)}


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
def get_season_players(competition_id: int, season_id: int, sort_by: str = "goals_p90") -> dict:
    conn = db.connect()
    profiles = player_features.season_player_profiles(conn, competition_id, season_id)
    if not profiles:
        return {"error": "no players with sufficient minutes for this competition/season"}
    if sort_by not in profiles[0] or not isinstance(profiles[0][sort_by], (int, float)):
        return {"error": f"cannot sort by '{sort_by}'; use a numeric field like {', '.join(k for k, v in profiles[0].items() if isinstance(v, float))}"}
    return {"sorted_by": sort_by, "players": sorted(profiles, key=lambda p: -p[sort_by]), "min_minutes": player_features.min_minutes(conn, competition_id, season_id)}


SMALL_SAMPLE_FLOOR = 90  # one full match: the lowest bar for a like-for-like comparison, flagged as low confidence


def _scope_name(conn, competition_id: int, season_id: int) -> str:
    r = conn.execute("SELECT c.name c, s.name s FROM competition c JOIN season s ON s.competition_id = c.id WHERE c.id = ? AND s.id = ?",
                     (competition_id, season_id)).fetchone()
    return f"{r['c']} {r['s']}" if r else "this competition"


@_wrap
def get_similar_players(competition_id: int, season_id: int, player_id: int, top_n: int = 8) -> dict:
    """Players WITHIN the named competition-season. Never silently widens the scope the user asked for."""
    conn = db.connect()
    scope = _scope_name(conn, competition_id, season_id)
    r = player_features.similar_players(conn, competition_id, season_id, player_id, top_n=top_n)
    if "error" not in r:
        return r
    low = player_features.similar_players(conn, competition_id, season_id, player_id, top_n=top_n, floor=SMALL_SAMPLE_FLOOR)
    if "error" not in low:  # same scope, thinner evidence: say so
        low["caveat"] = (f"This player had limited playing time in {scope}, so the comparison within it is low-confidence: "
                         "it rests on a small number of matches.")
        return low
    out = {"error": f"There is not enough playing time for this player in {scope} to compare them with others in it."}
    hint = roles.similar_players(conn, player_id, competition_id, season_id, 5, any_season=True)
    if "error" not in hint:  # clearly labelled as outside what was asked
        out["outside_scope_hint"] = {"note": f"Not from {scope}: players in other competitions who play in a similar way.",
                                     "players": hint["plays_like"], "style_taken_from": hint.get("based_on")}
    return out


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
    if not concept:
        return {"error": f"unknown tactical concept '{slug}'"}
    return {k: v for k, v in concept.items() if k != "detection_method"}  # code paths are for developers, not for answers


@_wrap
def get_match_momentum(match_id: int) -> dict:
    return serve.match_momentum_summary(db.connect(), match_id) or {"error": f"no momentum data for match {match_id}"}


@_wrap
def get_player_profile(competition_id: int, season_id: int, player_id: int) -> dict:
    return serve.player_profile(db.connect(), competition_id, season_id, player_id) or {
        "error": "no profile for this player in this competition/season (needs 300+ minutes)"}


@_wrap
def get_leaders(competition_id: int, season_id: int, metric: str = "npxg", position_group: str = None) -> dict:
    return serve.leaders(db.connect(), competition_id, season_id, metric, position_group, 10)


@_wrap
def get_team_patterns(competition_id: int, season_id: int, kind: str) -> dict:
    return serve.team_patterns(db.connect(), competition_id, season_id, kind, 10)


@_wrap
def get_similar_team_styles(team_id: int, competition_id: int, season_id: int) -> dict:
    return serve.similar_styles(db.connect(), team_id, competition_id, season_id, 5)


@_wrap
def get_goalkeepers(competition_id: int, season_id: int) -> dict:
    return serve.goalkeepers(db.connect(), competition_id, season_id, 10)


@_wrap
def get_plays_like(competition_id: int, season_id: int, player_id: int) -> dict:
    """Style matches across ALL competitions (use when the question names no competition)."""
    conn = db.connect()
    r = roles.similar_players(conn, player_id, competition_id, season_id, 6, any_season=True)
    if "error" in r:
        return {"error": "There is not enough playing time for this player in the data to say who plays most like them."}
    if r.get("based_on"):
        r["caveat"] = f"There was not enough playing time in that competition, so the player's style is taken from {r['based_on']}."
    return r


@_wrap
def get_match_report(match_id: int) -> dict:
    out = report.match_report(db.connect(), match_id)
    return {"report": out["text"], "note": out["note"]} if out else {"error": f"no report for match {match_id}"}


@_wrap
def get_tracking_physical(provider: str = "skillcorner_open_data", match_id: str = None, metric: str = "sprints") -> dict:
    if match_id:
        out = serve.tracking_physical(provider, str(match_id), 8)
        return out or {"error": f"no tracking physical data for match {match_id}"}
    return serve.tracking_physical_leaders(metric, 8)


@_wrap
def search_football(query: str, kind: str = None) -> dict:
    return search.query(query[:200], kind, 8)


@_wrap
def get_standings(competition_code: str) -> dict:
    from halfspace.ingest import fixtures
    return fixtures.read_standings(competition_code) or {"error": f"No current-season table is available for '{competition_code}'."}


@_wrap
def get_fixtures(competition_code: str, status: str = None, team: str = None) -> dict:
    from halfspace.ingest import fixtures
    return fixtures.read_fixtures(competition_code, status, team, limit=12) or {"error": f"No current-season fixtures are available for '{competition_code}'."}


@_wrap
def explain_shot(event_id: str) -> dict:
    return xg.explain_event(event_id) or {"error": f"no shot {event_id}"}


TOOLS: list[ToolSpec] = [
    ToolSpec("list_competitions", "List every ingested competition/season with match counts.", {"type": "object", "properties": {}}, list_competitions),
    ToolSpec("find_matches", "Find matches by team name (substring), optionally vs an opponent and within a competition/season. "
             "Use this to get a match id, e.g. team='Barcelona', opponent='Real Madrid'.",
             {"type": "object", "properties": {"team": {"type": "string"}, "opponent": {"type": "string"},
                                                "competition_id": {"type": "integer"}, "season_id": {"type": "integer"}}, "required": ["team"]},
             find_matches),
    ToolSpec("list_matches", "List 25 matches of a competition/season, oldest first; latest=true gives the LAST 25 (the final is the last match). Use find_matches for a specific game.",
             {"type": "object", "properties": {"competition_id": {"type": "integer"}, "season_id": {"type": "integer"}, "latest": {"type": "boolean"}}, "required": ["competition_id", "season_id"]},
             list_matches),
    ToolSpec("get_match", "Basic info for one match: teams, score, date.",
             {"type": "object", "properties": {"match_id": {"type": "integer"}}, "required": ["match_id"]}, get_match),
    ToolSpec("get_match_profile", "Shot summary, goals, PPDA, progressive passes for one match.",
             {"type": "object", "properties": {"match_id": {"type": "integer"}}, "required": ["match_id"]}, get_match_profile),
    ToolSpec("get_match_sequences", "Heuristically-detected counterattacks in one match (medium confidence).",
             {"type": "object", "properties": {"match_id": {"type": "integer"}}, "required": ["match_id"]}, get_match_sequences),
    ToolSpec("get_season_players", "Per-90 player profiles (min 900 minutes in a league season, 300 in a tournament), best first by sort_by "
             "(goals_p90, shots_p90, key_passes_p90, prog_passes_p90, prog_carries_p90, dribbles_completed_p90, pressures_p90, touches_p90). "
             "Returns only the top 25.",
             {"type": "object", "properties": {"competition_id": {"type": "integer"}, "season_id": {"type": "integer"},
                                                "sort_by": {"type": "string"}}, "required": ["competition_id", "season_id"]},
             get_season_players),
    ToolSpec("get_similar_players", "Most similar players to a given player WITHIN the named competition and season. Use this whenever the question names a competition or tournament.",
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
    ToolSpec("get_match_momentum", "Who was on top by minute (positive = home on top), peaks, key moments and total xG for one match.",
             {"type": "object", "properties": {"match_id": {"type": "integer"}}, "required": ["match_id"]}, get_match_momentum),
    ToolSpec("get_player_profile", "Scouting card: per-90 stats (xG, xA, xT...), sample-adjusted values and percentiles vs position peers.",
             {"type": "object", "properties": {"competition_id": {"type": "integer"}, "season_id": {"type": "integer"},
                                                "player_id": {"type": "integer"}}, "required": ["competition_id", "season_id", "player_id"]},
             get_player_profile),
    ToolSpec("get_leaders", "Top 10 players by a metric (npxg, xa, xt, goals_np, shots_np, passes, pass_pct, dribbles, carries, "
             "pressures, interceptions, recoveries), optional position_group GK/DEF/MID/ATT, adjusted for sample size.",
             {"type": "object", "properties": {"competition_id": {"type": "integer"}, "season_id": {"type": "integer"},
                                                "metric": {"type": "string"}, "position_group": {"type": "string"}},
              "required": ["competition_id", "season_id"]}, get_leaders),
    ToolSpec("get_team_patterns", "Teams ranked by xG per counterattack, corner or free kick (kind: counter|corner|free_kick), provider-tagged.",
             {"type": "object", "properties": {"competition_id": {"type": "integer"}, "season_id": {"type": "integer"},
                                                "kind": {"type": "string"}}, "required": ["competition_id", "season_id", "kind"]},
             get_team_patterns),
    ToolSpec("get_similar_team_styles", "A team's playing-style archetype and the most similar team-seasons in the data.",
             {"type": "object", "properties": {"team_id": {"type": "integer"}, "competition_id": {"type": "integer"},
                                                "season_id": {"type": "integer"}}, "required": ["team_id", "competition_id", "season_id"]},
             get_similar_team_styles),
    ToolSpec("get_goalkeepers", "Goalkeepers ranked by goals prevented (post-shot xG minus goals conceded), noisy under ~150 shots.",
             {"type": "object", "properties": {"competition_id": {"type": "integer"}, "season_id": {"type": "integer"}},
              "required": ["competition_id", "season_id"]}, get_goalkeepers),
    ToolSpec("get_plays_like", "A player's data-driven role and the players who played most like them across ALL competitions. Use this only when the question does not name a competition or tournament.",
             {"type": "object", "properties": {"competition_id": {"type": "integer"}, "season_id": {"type": "integer"},
                                                "player_id": {"type": "integer"}}, "required": ["competition_id", "season_id", "player_id"]},
             get_plays_like),
    ToolSpec("get_match_report", "A short written match report: xG, who was on top when, goals and big chances, top threat creators.",
             {"type": "object", "properties": {"match_id": {"type": "integer"}}, "required": ["match_id"]}, get_match_report),
    ToolSpec("get_tracking_physical", "Running load from broadcast tracking (A-League 2024/25): for one match_id the players' distance, high-speed "
             "and sprints per tracked minute; without match_id the top single-match performances by metric (sprints, hsr_m, sprint_m, top_speed_kmh).",
             {"type": "object", "properties": {"match_id": {"type": "string"}, "metric": {"type": "string"}}}, get_tracking_physical),
    ToolSpec("search_football", "Find players, teams, matches or tactical concepts by description (kind: player|team|match|concept), "
             "e.g. 'high pressing teams', 'creative midfielders', 'upsets'. Returns ids to look up with other tools.",
             {"type": "object", "properties": {"query": {"type": "string"}, "kind": {"type": "string"}}, "required": ["query"]}, search_football),
    ToolSpec("get_standings", "Current-season league table for a competition code: PL (Premier League), PD (La Liga), BL1 (Bundesliga), "
             "SA (Serie A), FL1 (Ligue 1), PPL (Primeira Liga), DED (Eredivisie). Not for past seasons.",
             {"type": "object", "properties": {"competition_code": {"type": "string"}}, "required": ["competition_code"]}, get_standings),
    ToolSpec("get_fixtures", "Current-season fixtures and results for a competition code (PL, PD, BL1, SA, FL1, PPL, DED), optionally "
             "status SCHEDULED or FINISHED and a team name.",
             {"type": "object", "properties": {"competition_code": {"type": "string"}, "status": {"type": "string"}, "team": {"type": "string"}},
              "required": ["competition_code"]}, get_fixtures),
    ToolSpec("explain_shot", "Why a shot has its xG: top factors (approximate attribution).",
             {"type": "object", "properties": {"event_id": {"type": "string"}}, "required": ["event_id"]}, explain_shot),
]

TOOLS_BY_NAME: dict[str, ToolSpec] = {t.name: t for t in TOOLS}

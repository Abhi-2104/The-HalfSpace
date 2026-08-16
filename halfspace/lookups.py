"""
Shared read queries used by both the FastAPI routes and the agent's tool
layer - one code path, not two copies of the same SQL. Matches the project
principle that the agent has no separate DB access path from the frontend
(spec section 19/23): both call into these same functions.
"""
import sqlite3

from halfspace import features


def get_overview(conn: sqlite3.Connection) -> dict:
    return {
        "matches": conn.execute("SELECT COUNT(*) n FROM match").fetchone()["n"],
        "events": conn.execute("SELECT COUNT(*) n FROM event").fetchone()["n"],
        "players": conn.execute("SELECT COUNT(DISTINCT player_id) n FROM player_match_minutes").fetchone()["n"],
        "teams": conn.execute("SELECT COUNT(DISTINCT team_id) n FROM player_match_minutes").fetchone()["n"],
        "tracking_matches": conn.execute("SELECT COUNT(DISTINCT provider_match_id) n FROM tracking_team_match").fetchone()["n"],
    }


def list_competitions(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """SELECT c.id AS competition_id, c.name AS competition_name,
                  s.id AS season_id, s.name AS season_name,
                  COUNT(m.id) AS matches
           FROM competition c
           JOIN season s ON s.competition_id = c.id
           JOIN match m ON m.competition_id = c.id AND m.season_id = s.id
           GROUP BY c.id, s.id
           ORDER BY matches DESC"""
    ).fetchall()
    return [dict(r) for r in rows]


def list_matches(conn: sqlite3.Connection, competition_id: int, season_id: int) -> list[dict]:
    rows = conn.execute(
        """SELECT m.id, m.match_date, m.home_score, m.away_score,
                  ht.name AS home_team, at.name AS away_team,
                  dc.has_events, dc.has_tracking
           FROM match m
           JOIN team ht ON ht.id = m.home_team_id
           JOIN team at ON at.id = m.away_team_id
           LEFT JOIN data_coverage dc ON dc.match_id = m.id
           WHERE m.competition_id = ? AND m.season_id = ?
           ORDER BY m.match_date""",
        (competition_id, season_id),
    ).fetchall()
    return [dict(r) for r in rows]


def get_match(conn: sqlite3.Connection, match_id: int) -> dict | None:
    row = conn.execute(
        """SELECT m.id, m.match_date, m.home_score, m.away_score,
                  m.home_team_id, m.away_team_id, ht.name AS home_team, at.name AS away_team,
                  m.competition_id, m.season_id, c.name AS competition_name, s.name AS season_name
           FROM match m
           JOIN team ht ON ht.id = m.home_team_id
           JOIN team at ON at.id = m.away_team_id
           JOIN competition c ON c.id = m.competition_id
           JOIN season s ON s.id = m.season_id
           WHERE m.id = ?""",
        (match_id,),
    ).fetchone()
    return dict(row) if row else None


def get_match_profile(conn: sqlite3.Connection, match_id: int) -> dict | None:
    match = conn.execute("SELECT 1 FROM match WHERE id = ?", (match_id,)).fetchone()
    if not match:
        return None
    coverage = conn.execute("SELECT * FROM data_coverage WHERE match_id = ?", (match_id,)).fetchone()
    return {
        "match_id": match_id,
        "coverage": dict(coverage) if coverage else None,
        "shots": features.shot_summary(conn, match_id),
        "goals": features.goals_timeline(conn, match_id),
        "ppda": features.ppda(conn, match_id),
        "progressive_passes_by_player": features.player_progressive_passes(conn, match_id),
    }


def get_match_shots(conn: sqlite3.Connection, match_id: int) -> list[dict]:
    rows = conn.execute(
        """SELECT e.id, e.team_id, t.name AS team_name, e.player_id, p.name AS player_name,
                  e.minute, e.second, e.x, e.y, e.outcome_name, e.body_part
           FROM event e
           JOIN team t ON t.id = e.team_id
           LEFT JOIN player p ON p.id = e.player_id
           WHERE e.match_id = ? AND e.type_name = 'Shot' AND e.period IN (1,2,3,4)
           ORDER BY e.minute, e.second""",
        (match_id,),
    ).fetchall()
    return [dict(r) for r in rows]

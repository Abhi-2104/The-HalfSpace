"""
Spatial/tracking intelligence: reads the provider-agnostic tracking_team_match
table (populated by halfspace/ingest/skillcorner.py and halfspace/ingest/idsse.py).
Team compactness (width = std-dev of player Y, length = std-dev of player X)
is the one tractable first spatial feature - deliberately not attempting full
tactical recognition from tracking (per project spec §18).
"""
import sqlite3


def team_shape(conn: sqlite3.Connection, provider: str = None) -> list[dict]:
    q = "SELECT * FROM tracking_team_match"
    params = ()
    if provider:
        q += " WHERE provider = ?"
        params = (provider,)
    q += " ORDER BY provider, provider_match_id, is_home DESC"
    return [dict(r) for r in conn.execute(q, params).fetchall()]


def match_shape(conn: sqlite3.Connection, provider: str, provider_match_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM tracking_team_match WHERE provider = ? AND provider_match_id = ?",
        (provider, provider_match_id),
    ).fetchall()
    return [dict(r) for r in rows]

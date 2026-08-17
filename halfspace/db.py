"""
Canonical schema. SQLite for the vertical-slice/dev phase.
# ponytail: sqlite3 (stdlib), no ORM, no server to run. Swap for Postgres+pgvector
# when similarity search needs to scale past "fits in memory" or multi-writer access
# matters - schema below is plain SQL so the migration is a port, not a rewrite.
"""
import os
import sqlite3
from pathlib import Path

# HALFSPACE_DB env overrides the default location - lets a verification/CI run
# point at a throwaway DB without touching the real one, and lets deployment
# put the DB wherever it wants.
DEFAULT_DB_PATH = Path(os.environ.get("HALFSPACE_DB",
                       Path(__file__).resolve().parent.parent / "data" / "halfspace.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS data_source (
    id INTEGER PRIMARY KEY,
    provider TEXT NOT NULL,          -- 'statsbomb_open_data', 'skillcorner_open_data'
    license TEXT NOT NULL,
    retrieved_at TEXT NOT NULL,      -- when WE pulled it
    source_updated_at TEXT,          -- provider's own freshness claim, if known
    notes TEXT
);

CREATE TABLE IF NOT EXISTS competition (
    id INTEGER PRIMARY KEY,          -- statsbomb competition_id
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS season (
    id INTEGER PRIMARY KEY,          -- statsbomb season_id
    competition_id INTEGER NOT NULL REFERENCES competition(id),
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS player (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS match (
    id INTEGER PRIMARY KEY,          -- statsbomb match_id
    competition_id INTEGER NOT NULL REFERENCES competition(id),
    season_id INTEGER NOT NULL REFERENCES season(id),
    match_date TEXT,
    home_team_id INTEGER REFERENCES team(id),   -- nullable: unknown when ingested without match-list metadata (e.g. tests)
    away_team_id INTEGER REFERENCES team(id),
    home_score INTEGER,
    away_score INTEGER,
    data_source_id INTEGER REFERENCES data_source(id)
);

-- coverage is explicit and per-match, per section 8/9 of the project spec:
-- don't let missing tracking/event depth silently degrade what the UI implies.
CREATE TABLE IF NOT EXISTS data_coverage (
    match_id INTEGER PRIMARY KEY REFERENCES match(id),
    has_events INTEGER NOT NULL DEFAULT 0,
    has_360 INTEGER NOT NULL DEFAULT 0,
    has_tracking INTEGER NOT NULL DEFAULT 0,
    tracking_variant TEXT             -- e.g. 'extrapolated' vs 'raw' (SkillCorner distinction - matters, see spatial.py finding)
);

-- one row per StatsBomb event, kept close to source shape (canonical-lite, not fully SPADL yet)
CREATE TABLE IF NOT EXISTS event (
    id TEXT PRIMARY KEY,             -- statsbomb event uuid
    match_id INTEGER NOT NULL REFERENCES match(id),
    period INTEGER NOT NULL,         -- 1/2 regular, 3/4 extra time, 5 = penalty shootout
    minute INTEGER NOT NULL,
    second INTEGER NOT NULL,
    team_id INTEGER REFERENCES team(id),
    player_id INTEGER REFERENCES player(id),
    type_name TEXT NOT NULL,
    x REAL, y REAL,
    end_x REAL, end_y REAL,          -- pass/carry end location, if applicable
    outcome_name TEXT,               -- shot/pass/dribble outcome, if applicable
    shot_assist INTEGER DEFAULT 0,
    body_part TEXT
);
CREATE INDEX IF NOT EXISTS idx_event_match ON event(match_id);
CREATE INDEX IF NOT EXISTS idx_event_player ON event(player_id);

-- StatsBomb 360 freeze-frames: one row per event that has 360 coverage.
-- freeze_frame/visible_area stored as JSON text rather than exploded into a
-- row-per-visible-player: ~2900 events x ~12 players/match would be millions
-- of rows across the dataset for no query benefit - we always want a whole
-- frame at once (render all players for an event), never one player's dot in
-- isolation. Keyed by event_id so the shot -> "who was where" lookup is O(1).
CREATE TABLE IF NOT EXISTS freeze_frame (
    event_id TEXT PRIMARY KEY REFERENCES event(id),
    match_id INTEGER NOT NULL REFERENCES match(id),
    freeze_frame TEXT NOT NULL,   -- JSON: [{teammate, actor, keeper, location:[x,y]}, ...]
    visible_area TEXT             -- JSON: [x1,y1,x2,y2,...] camera-visible polygon
);
CREATE INDEX IF NOT EXISTS idx_freeze_match ON freeze_frame(match_id);

CREATE TABLE IF NOT EXISTS player_match_minutes (
    match_id INTEGER NOT NULL REFERENCES match(id),
    player_id INTEGER NOT NULL REFERENCES player(id),
    team_id INTEGER NOT NULL REFERENCES team(id),
    minutes REAL NOT NULL,
    position TEXT,
    PRIMARY KEY (match_id, player_id)
);

-- Tracking-derived team-shape features. Deliberately NOT foreign-keyed to
-- match/team above: the tracking providers (SkillCorner open data, IDSSE)
-- cover different competitions than the ingested StatsBomb data with no real
-- entity overlap - reusing those tables would imply a link that doesn't
-- exist. provider + provider_match_id is the natural key here instead.
CREATE TABLE IF NOT EXISTS tracking_team_match (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    provider_match_id TEXT NOT NULL,
    team_name TEXT NOT NULL,
    is_home INTEGER,
    frames_used INTEGER NOT NULL,
    avg_players_tracked REAL NOT NULL,
    width_std_y REAL NOT NULL,
    length_std_x REAL NOT NULL,
    tracking_variant TEXT NOT NULL,   -- e.g. 'extrapolated' (SkillCorner) vs 'observed' (IDSSE/DFL)
    UNIQUE (provider, provider_match_id, team_name)
);
"""


def connect(db_path: Path = DEFAULT_DB_PATH) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn

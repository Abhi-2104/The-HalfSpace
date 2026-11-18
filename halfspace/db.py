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
    id INTEGER NOT NULL,             -- statsbomb season_id: NOT unique on its own (Euro 2024 and Copa America 2024 are both 282)
    competition_id INTEGER NOT NULL REFERENCES competition(id),
    name TEXT NOT NULL,
    PRIMARY KEY (competition_id, id)
);

CREATE TABLE IF NOT EXISTS team (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS player (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,              -- full legal name from the provider
    display_name TEXT                -- name the player is known by (nickname, else a guess); see halfspace/names.py
);

CREATE TABLE IF NOT EXISTS match (
    id INTEGER PRIMARY KEY,          -- statsbomb match_id
    competition_id INTEGER NOT NULL REFERENCES competition(id),
    season_id INTEGER NOT NULL,      -- with competition_id identifies the season
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
-- freeze_frame/visible_area are packed blobs (see halfspace/framepack.py), not exploded
-- into a row-per-visible-player: that would be millions of rows for no query benefit - we
-- always want a whole frame at once, never one player's dot in isolation. Keyed by
-- event_id so the shot -> "who was where" lookup is O(1).
CREATE TABLE IF NOT EXISTS freeze_frame (
    event_id TEXT PRIMARY KEY REFERENCES event(id),
    match_id INTEGER NOT NULL REFERENCES match(id),
    freeze_frame BLOB NOT NULL,   -- packed players: x, y (0.1 yd), teammate/actor/keeper flags
    visible_area BLOB             -- packed camera-visible polygon [x1,y1,x2,y2,...]
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


def _migrate_season_key(conn: sqlite3.Connection) -> None:
    """Old databases keyed `season` on StatsBomb's season_id alone, so competitions sharing an id (Euro 2024 / Copa America 2024)
    collapsed into one row and 10 of 24 competition-seasons vanished from every list. Rebuild it keyed on (competition_id, id),
    one row per competition-season that has matches."""
    pk = {r[1] for r in conn.execute("PRAGMA table_info(season)") if r[5]}
    if pk == {"competition_id", "id"}:
        return
    import json
    names = {}
    f = Path(__file__).resolve().parent.parent / "data" / "raw" / "competitions.json"
    if f.exists():
        names = {(c["competition_id"], c["season_id"]): c["season_name"] for c in json.loads(f.read_text())}
    old = {(r[0], r[1]): r[2] for r in conn.execute("SELECT competition_id, id, name FROM season")}
    pairs = {tuple(r) for r in conn.execute("SELECT DISTINCT competition_id, season_id FROM match")} | set(old)
    conn.execute("CREATE TABLE season_new (id INTEGER NOT NULL, competition_id INTEGER NOT NULL REFERENCES competition(id), "
                 "name TEXT NOT NULL, PRIMARY KEY (competition_id, id))")
    conn.executemany("INSERT INTO season_new VALUES (?, ?, ?)",
                     [(sid, cid, names.get((cid, sid)) or old.get((cid, sid)) or str(sid)) for cid, sid in sorted(pairs)])
    conn.execute("DROP TABLE season")
    conn.execute("ALTER TABLE season_new RENAME TO season")
    conn.commit()


_ready: set[str] = set()  # databases whose schema/WAL setup already ran in this process


def connect(db_path: Path = DEFAULT_DB_PATH) -> sqlite3.Connection:
    """Open the DB. Wait up to 30s for a lock instead of failing, and run the schema + switch to WAL once per
    process: WAL lets the API read while an ingest writes (a request used to run CREATE statements, which
    fought the ingest for the write lock and failed with 'database is locked')."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 30000")
    key = str(db_path)
    if key not in _ready:
        try:
            conn.execute("PRAGMA journal_mode = WAL")  # persists in the file; needs a moment with no other writer
            conn.execute("PRAGMA synchronous = NORMAL")
        except sqlite3.OperationalError:
            pass  # another process holds it right now; the next process to connect switches it
        conn.executescript(SCHEMA)
        _migrate_season_key(conn)
        if "display_name" not in {r[1] for r in conn.execute("PRAGMA table_info(player)")}:
            conn.execute("ALTER TABLE player ADD COLUMN display_name TEXT")  # databases created before display names existed
            conn.commit()
        _ready.add(key)
    return conn

def season_match_count(conn: sqlite3.Connection, competition_id: int, season_id: int) -> int:
    """Cheap data-version for per-season caches: ingesting new matches changes it."""
    return conn.execute("SELECT COUNT(*) FROM match WHERE competition_id=? AND season_id=?",
                        (competition_id, season_id)).fetchone()[0]

"""
StatsBomb Open Data ingestion: fetch raw JSON, load into canonical schema.
Raw JSON is NOT committed to git - it's re-fetched on demand (reproducible per
source, per section 10 of the project spec). Test fixtures are the one exception
(see tests/fixtures/), kept small and committed so tests don't need network.
"""
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen

BASE = "https://raw.githubusercontent.com/statsbomb/open-data/master/data"
LICENSE = "StatsBomb Open Data - free for research/non-commercial use, attribution required, no resale"


def _fetch_json(url: str):
    with urlopen(url) as resp:
        return json.loads(resp.read())


def _mmss_to_min(s: str) -> float:
    m, sec = s.split(":")
    return int(m) + int(sec) / 60


def _ensure_data_source(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT id FROM data_source WHERE provider = 'statsbomb_open_data'").fetchone()
    if row:
        return row["id"]
    cur = conn.execute(
        "INSERT INTO data_source (provider, license, retrieved_at) VALUES (?, ?, ?)",
        ("statsbomb_open_data", LICENSE, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    return cur.lastrowid


def ingest_match(conn: sqlite3.Connection, match_id: int, events_path: Path = None, lineups_path: Path = None,
                  competition_id: int = None, season_id: int = None) -> None:
    """
    Load one match's events + lineups into the canonical schema.
    Pass events_path/lineups_path to load from local files (tests, offline);
    omit to fetch live from the StatsBomb open-data repo.
    """
    events = json.loads(events_path.read_text()) if events_path else _fetch_json(f"{BASE}/events/{match_id}.json")
    lineups = json.loads(lineups_path.read_text()) if lineups_path else _fetch_json(f"{BASE}/lineups/{match_id}.json")

    source_id = _ensure_data_source(conn)

    teams = {}
    for e in events:
        if "team" in e:
            teams[e["team"]["id"]] = e["team"]["name"]
    for tid, name in teams.items():
        conn.execute("INSERT OR IGNORE INTO team (id, name) VALUES (?, ?)", (tid, name))

    players = {}
    for e in events:
        if "player" in e:
            players[e["player"]["id"]] = e["player"]["name"]
    for pid, name in players.items():
        conn.execute("INSERT OR IGNORE INTO player (id, name) VALUES (?, ?)", (pid, name))

    if competition_id is not None:
        conn.execute("INSERT OR IGNORE INTO competition (id, name) VALUES (?, ?)", (competition_id, f"competition_{competition_id}"))
    if season_id is not None and competition_id is not None:
        conn.execute("INSERT OR IGNORE INTO season (id, competition_id, name) VALUES (?, ?, ?)",
                     (season_id, competition_id, f"season_{season_id}"))

    team_ids = list(teams.keys())
    if competition_id is not None and season_id is not None and len(team_ids) == 2:
        conn.execute(
            """INSERT OR REPLACE INTO match (id, competition_id, season_id, home_team_id, away_team_id, data_source_id)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (match_id, competition_id, season_id, team_ids[0], team_ids[1], source_id),
        )

    # events - period is stored explicitly; period 5 = penalty shootout (see features.py docstring)
    for e in events:
        loc = e.get("location") or [None, None]
        end_loc = None
        if e["type"]["name"] == "Pass":
            end_loc = e.get("pass", {}).get("end_location")
        elif e["type"]["name"] == "Carry":
            end_loc = e.get("carry", {}).get("end_location")
        end_loc = end_loc or [None, None]

        outcome = None
        if e["type"]["name"] == "Shot":
            outcome = e.get("shot", {}).get("outcome", {}).get("name")
        elif e["type"]["name"] == "Pass":
            outcome = e.get("pass", {}).get("outcome", {}).get("name")
        elif e["type"]["name"] == "Dribble":
            outcome = e.get("dribble", {}).get("outcome", {}).get("name")

        conn.execute(
            """INSERT OR REPLACE INTO event
               (id, match_id, period, minute, second, team_id, player_id, type_name, x, y, end_x, end_y, outcome_name, shot_assist, body_part)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                e["id"], match_id, e["period"], e["minute"], e["second"],
                e.get("team", {}).get("id"), e.get("player", {}).get("id"), e["type"]["name"],
                loc[0], loc[1], end_loc[0], end_loc[1], outcome,
                1 if e.get("pass", {}).get("shot_assist") else 0,
                e.get("shot", {}).get("body_part", {}).get("name"),
            ),
        )

    # minutes played - reconstructed from lineup position segments, not assumed from presence.
    # (this is the exact logic validated on the full La Liga 2015/16 season in the scratchpad test)
    match_end_min = max((e["minute"] for e in events if e.get("period") in (1, 2)), default=95)
    for team in lineups:
        for p in team["lineup"]:
            total = 0.0
            position = None
            for seg in p["positions"]:
                if position is None:
                    position = seg["position"]
                start = _mmss_to_min(seg["from"])
                end = _mmss_to_min(seg["to"]) if seg["to"] else match_end_min
                total += max(0, end - start)
            if total > 0:
                conn.execute(
                    """INSERT OR REPLACE INTO player_match_minutes (match_id, player_id, team_id, minutes, position)
                       VALUES (?, ?, ?, ?, ?)""",
                    (match_id, p["player_id"], team["team_id"], total, position),
                )

    conn.execute(
        """INSERT OR REPLACE INTO data_coverage (match_id, has_events, has_360, has_tracking, tracking_variant)
           VALUES (?, 1, 0, 0, NULL)""",
        (match_id,),
    )
    conn.commit()

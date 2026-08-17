"""
StatsBomb Open Data ingestion: fetch raw JSON, load into canonical schema.

Raw JSON is cached to data/raw/ (gitignored) on first fetch - re-running
ingestion doesn't re-hit the network. This IS the "raw" layer of the
raw->canonical->derived architecture (section 10), it's just cached, not
committed - source data is reproducible from the fetch logic, not from git.
Test fixtures are the one deliberate exception (see tests/fixtures/).
"""
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen

BASE = "https://raw.githubusercontent.com/statsbomb/open-data/master/data"
LICENSE = "StatsBomb Open Data - free for research/non-commercial use, attribution required, no resale"
RAW_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "raw"


def _fetch_json_cached(url: str, cache_path: Path):
    if cache_path.exists():
        return json.loads(cache_path.read_text())
    with urlopen(url) as resp:
        data = json.loads(resp.read())
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(data))
    return data


def fetch_match_list(competition_id: int, season_id: int) -> list:
    """The competition/season match list - has real home/away team ids and final scores,
    which per-event data does NOT reliably give you (event order != home/away)."""
    url = f"{BASE}/matches/{competition_id}/{season_id}.json"
    cache_path = RAW_DIR / "matches" / f"{competition_id}_{season_id}.json"
    return _fetch_json_cached(url, cache_path)


def fetch_competition_season_names(competition_id: int, season_id: int) -> tuple[str, str]:
    """Real names (e.g. 'FIFA World Cup', '2022') - ingest_match previously used
    placeholder names like 'competition_43' since it only ever saw per-match JSON,
    which doesn't carry the competition's display name."""
    rows = _fetch_json_cached(f"{BASE}/competitions.json", RAW_DIR / "competitions.json")
    for row in rows:
        if row["competition_id"] == competition_id and row["season_id"] == season_id:
            return row["competition_name"], row["season_name"]
    return f"competition_{competition_id}", f"season_{season_id}"


def _fetch_360(match_id: int) -> list | None:
    """Fetch a match's 360 freeze-frames. Returns None (not an error) if the
    match has no 360 coverage - most historical matches don't; the tournaments
    that do (WC2022, Euro 2024, Copa America 2024, Women's Euro 2025) are the
    point of ingesting it. HTTP 404 -> None, cached as an empty marker so we
    don't re-hit the network on every re-run for a match we know lacks 360."""
    import urllib.error
    cache_path = RAW_DIR / "three-sixty" / f"{match_id}.json"
    if cache_path.exists():
        text = cache_path.read_text()
        return json.loads(text) if text.strip() else None
    try:
        with urlopen(f"{BASE}/three-sixty/{match_id}.json") as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_text("")  # negative-cache marker: known to have no 360
            return None
        raise
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(data))
    return data


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
                  competition_id: int = None, season_id: int = None, match_meta: dict = None,
                  three_sixty_path: Path = None, fetch_360: bool = False) -> None:
    """
    Load one match's events + lineups into the canonical schema.

    events_path/lineups_path: load from local files (tests, offline). Omit to
    fetch live (cached to data/raw/ after first fetch).

    match_meta: {home_team_id, away_team_id, home_score, away_score, match_date}
    from the competition's match-list endpoint. Without it, home/away and score
    are left NULL rather than guessed from event order (event order is not
    reliably home-team-first - guessing produced wrong scores before this fix).

    fetch_360: also pull 360 freeze-frames (only tournaments with 360 coverage
    have them; a match without 360 just gets has_360=0, not an error).
    three_sixty_path: load 360 from a local file instead (tests/offline).
    """
    events = (json.loads(events_path.read_text()) if events_path
              else _fetch_json_cached(f"{BASE}/events/{match_id}.json", RAW_DIR / "events" / f"{match_id}.json"))
    lineups = (json.loads(lineups_path.read_text()) if lineups_path
               else _fetch_json_cached(f"{BASE}/lineups/{match_id}.json", RAW_DIR / "lineups" / f"{match_id}.json"))

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

    if competition_id is not None and season_id is not None:
        meta = match_meta or {}
        conn.execute(
            """INSERT OR REPLACE INTO match
               (id, competition_id, season_id, match_date, home_team_id, away_team_id, home_score, away_score, data_source_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (match_id, competition_id, season_id, meta.get("match_date"),
             meta.get("home_team_id"), meta.get("away_team_id"),
             meta.get("home_score"), meta.get("away_score"), source_id),
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
    # match_end covers periods 1-4 (regulation + extra time) - period 5 (shootout) is not
    # playing time. Segments are merged as intervals, not summed raw: a real anomaly found
    # via test_data_quality.py (WC2022 final, Messi) has an overlapping/mislabeled segment
    # that summed to 185 minutes - merging overlapping intervals fixes that class of bug
    # generally, not just this one match.
    match_end_min = max((e["minute"] for e in events if e.get("period") in (1, 2, 3, 4)), default=95)
    for team in lineups:
        for p in team["lineup"]:
            intervals = []
            position = p["positions"][0]["position"] if p["positions"] else None
            for seg in p["positions"]:
                start = _mmss_to_min(seg["from"])
                end = _mmss_to_min(seg["to"]) if seg["to"] else match_end_min
                if end > start:
                    intervals.append((start, end))
            intervals.sort()
            merged = []
            for s, e in intervals:
                if merged and s <= merged[-1][1]:
                    merged[-1] = (merged[-1][0], max(merged[-1][1], e))
                else:
                    merged.append((s, e))
            total = sum(e - s for s, e in merged)
            if total > 0:
                conn.execute(
                    """INSERT OR REPLACE INTO player_match_minutes (match_id, player_id, team_id, minutes, position)
                       VALUES (?, ?, ?, ?, ?)""",
                    (match_id, p["player_id"], team["team_id"], total, position),
                )

    # 360 freeze-frames, if requested and available for this match
    has_360 = 0
    frames = None
    if three_sixty_path:
        frames = json.loads(three_sixty_path.read_text())
    elif fetch_360:
        frames = _fetch_360(match_id)
    if frames:
        event_ids = {e["id"] for e in events}
        for fr in frames:
            eid = fr.get("event_uuid")
            if eid not in event_ids:  # 360 frames reference events; skip any orphan
                continue
            conn.execute(
                """INSERT OR REPLACE INTO freeze_frame (event_id, match_id, freeze_frame, visible_area)
                   VALUES (?, ?, ?, ?)""",
                (eid, match_id, json.dumps(fr.get("freeze_frame", [])), json.dumps(fr.get("visible_area", []))),
            )
        has_360 = 1

    conn.execute(
        """INSERT OR REPLACE INTO data_coverage (match_id, has_events, has_360, has_tracking, tracking_variant)
           VALUES (?, 1, ?, 0, NULL)""",
        (match_id, has_360),
    )
    conn.commit()

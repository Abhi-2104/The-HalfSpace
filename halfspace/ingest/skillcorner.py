"""
SkillCorner Open Data: broadcast-derived tracking, 10 matches, 2024/25
Australian A-League. Real gotcha (documented in README before this module
existed): tracking files are Git-LFS - raw.githubusercontent.com silently
returns a 133-byte pointer file, not data. Must use the LFS media URL.

Computes team compactness (width = std-dev of player Y, length = std-dev of
player X) per team per match - the same tractable first spatial feature
validated in the scratchpad prototype. Raw tracking JSONL is NOT persisted
frame-by-frame into SQLite (59k frames x 22 players would be ~1.3M rows for
one match alone) - only the computed aggregate is stored; the cached raw
file remains the reproducible source if frame-level detail is needed later.
"""
import json
import sqlite3
from pathlib import Path
from urllib.request import urlopen

import numpy as np

RAW_BASE = "https://raw.githubusercontent.com/SkillCorner/opendata/master/data"
LFS_BASE = "https://media.githubusercontent.com/media/SkillCorner/opendata/master/data"
RAW_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "raw" / "skillcorner"
LICENSE = "SkillCorner Open Data - free, research use, see repo LICENSE for redistribution terms"


def _fetch_cached(url: str, cache_path: Path) -> bytes:
    if cache_path.exists():
        return cache_path.read_bytes()
    with urlopen(url) as resp:
        data = resp.read()
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_bytes(data)
    return data


def fetch_match_list() -> list:
    data = _fetch_cached(f"{RAW_BASE}/matches.json", RAW_DIR / "matches.json")
    return json.loads(data)


def fetch_match_meta(match_id: int) -> dict:
    data = _fetch_cached(f"{RAW_BASE}/matches/{match_id}/{match_id}_match.json", RAW_DIR / f"{match_id}_match.json")
    return json.loads(data)


def fetch_tracking(match_id: int) -> list:
    """The tracking file is Git-LFS - must use the media.githubusercontent.com URL,
    not raw.githubusercontent.com (which returns a pointer file, not data)."""
    data = _fetch_cached(
        f"{LFS_BASE}/matches/{match_id}/{match_id}_tracking_extrapolated.jsonl",
        RAW_DIR / f"{match_id}_tracking.jsonl",
    )
    return [json.loads(line) for line in data.decode().splitlines() if line.strip()]


def compute_team_compactness(match_meta: dict, frames: list, min_players: int = 5) -> list[dict]:
    player_team = {p["id"]: p["team_id"] for p in match_meta.get("players", [])}
    team_names = {match_meta["home_team"]["id"]: match_meta["home_team"]["name"],
                  match_meta["away_team"]["id"]: match_meta["away_team"]["name"]}
    home_id = match_meta["home_team"]["id"]

    by_team = {}
    for frame in frames:
        if frame.get("period") is None:
            continue
        by_frame_team = {}
        for p in frame.get("player_data", []):
            tid = player_team.get(p.get("player_id"))
            if tid is None or p.get("x") is None:
                continue
            by_frame_team.setdefault(tid, []).append((p["x"], p["y"]))
        for tid, pts in by_frame_team.items():
            if len(pts) < min_players:
                continue
            xs = np.array([p[0] for p in pts])
            ys = np.array([p[1] for p in pts])
            acc = by_team.setdefault(tid, {"frames": 0, "n_sum": 0, "width_sum": 0.0, "length_sum": 0.0})
            acc["frames"] += 1
            acc["n_sum"] += len(pts)
            acc["width_sum"] += ys.std()
            acc["length_sum"] += xs.std()

    out = []
    for tid, acc in by_team.items():
        n = acc["frames"]
        out.append({
            "team_name": team_names.get(tid, str(tid)), "is_home": tid == home_id,
            "frames_used": n, "avg_players_tracked": round(acc["n_sum"] / n, 2),
            "width_std_y": round(acc["width_sum"] / n, 2), "length_std_x": round(acc["length_sum"] / n, 2),
        })
    return out


def _ensure_data_source(conn: sqlite3.Connection) -> int:
    from datetime import datetime, timezone
    row = conn.execute("SELECT id FROM data_source WHERE provider = 'skillcorner_open_data'").fetchone()
    if row:
        return row["id"]
    cur = conn.execute(
        "INSERT INTO data_source (provider, license, retrieved_at) VALUES (?, ?, ?)",
        ("skillcorner_open_data", LICENSE, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    return cur.lastrowid


def ingest_match(conn: sqlite3.Connection, match_id: int) -> list[dict]:
    _ensure_data_source(conn)
    meta = fetch_match_meta(match_id)
    frames = fetch_tracking(match_id)
    results = compute_team_compactness(meta, frames)
    for r in results:
        conn.execute(
            """INSERT OR REPLACE INTO tracking_team_match
               (provider, provider_match_id, team_name, is_home, frames_used,
                avg_players_tracked, width_std_y, length_std_x, tracking_variant)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            ("skillcorner_open_data", str(match_id), r["team_name"], int(r["is_home"]),
             r["frames_used"], r["avg_players_tracked"], r["width_std_y"], r["length_std_x"], "extrapolated"),
        )
    conn.commit()
    return results

"""
IDSSE (spoho-datascience/idsse-data, mirrored on HuggingFace as pysport/idsse-data):
7 real Bundesliga 2022/23 matches, TRUE optical tracking (25fps, DFL/Sportec,
not broadcast-derived/modeled like SkillCorner) synchronized with real match
events. CC-BY 4.0, genuinely public - "gated": false on the HF API, despite
an earlier assumption in this project that it needed auth resolution. That
assumption was wrong; corrected here rather than left standing.

DFL's positions_raw file is ~350-420MB of XML per match: one <FrameSet> per
entity (player/referee/ball) containing thousands of <Frame> elements at
25fps. Streamed with lxml.etree.iterparse (not loaded into memory as a full
tree) and downsampled by stride - team-shape aggregates don't need 25fps
resolution, and holding every frame for 22 players in memory isn't worth it.
"""
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen

import numpy as np
from lxml import etree

HF_BASE = "https://huggingface.co/datasets/pysport/idsse-data/resolve/main"
RAW_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "raw" / "idsse"
LICENSE = "IDSSE (Sportec/DFL) - CC-BY 4.0, released with DFL authorization"
STRIDE = 25  # ~1 sample/sec at 25fps - enough resolution for a team-shape aggregate


def _fetch_cached(url: str, cache_path: Path) -> bytes:
    if cache_path.exists():
        return cache_path.read_bytes()
    with urlopen(url) as resp:
        data = resp.read()
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_bytes(data)
    return data


def match_file_stems(match_key: str) -> dict:
    """match_key like 'DFL-COM-000001_DFL-MAT-J03WMX' - the suffix common to all 3 files for a match."""
    return {
        "info": f"DFL_02_01_matchinformation_{match_key}.xml",
        "events": f"DFL_03_02_events_raw_{match_key}.xml",
        "positions": f"DFL_04_03_positions_raw_observed_{match_key}.xml",
    }


def parse_match_info(xml_bytes: bytes) -> dict:
    root = etree.fromstring(xml_bytes)
    general = root.find(".//General")
    teams = {}
    for team in root.findall(".//Teams/Team"):
        teams[team.get("TeamId")] = team.get("TeamName")
    return {
        "home_team_id": general.get("HomeTeamId"), "home_team_name": general.get("HomeTeamName"),
        "away_team_id": general.get("GuestTeamId"), "away_team_name": general.get("GuestTeamName"),
        "competition": general.get("CompetitionName"), "season": general.get("Season"),
        "match_id": general.get("MatchId"), "teams": teams,
    }


def compute_team_compactness(positions_path: Path, match_info: dict, stride: int = STRIDE) -> list[dict]:
    """Stream-parse the positions file. frame_data[N][team_id] = [(x,y), ...]."""
    frame_data: dict[int, dict[str, list]] = {}
    valid_team_ids = {match_info["home_team_id"], match_info["away_team_id"]}

    context = etree.iterparse(str(positions_path), events=("start", "end"), tag=("FrameSet", "Frame"))
    current_team = None
    for event, elem in context:
        if elem.tag == "FrameSet" and event == "start":
            current_team = elem.get("TeamId")
        elif elem.tag == "Frame" and event == "end":
            if current_team in valid_team_ids:
                n = int(elem.get("N"))
                if n % stride == 0:
                    x, y = float(elem.get("X")), float(elem.get("Y"))
                    frame_data.setdefault(n, {}).setdefault(current_team, []).append((x, y))
            elem.clear()
        elif elem.tag == "FrameSet" and event == "end":
            elem.clear()

    per_team = {tid: {"frames": 0, "n_sum": 0, "width_sum": 0.0, "length_sum": 0.0} for tid in valid_team_ids}
    for n, teams_at_frame in frame_data.items():
        for tid, pts in teams_at_frame.items():
            if len(pts) < 5:
                continue
            xs = np.array([p[0] for p in pts])
            ys = np.array([p[1] for p in pts])
            acc = per_team[tid]
            acc["frames"] += 1
            acc["n_sum"] += len(pts)
            acc["width_sum"] += ys.std()
            acc["length_sum"] += xs.std()

    names = match_info["teams"]
    out = []
    for tid, acc in per_team.items():
        if acc["frames"] == 0:
            continue
        n = acc["frames"]
        out.append({
            "team_name": names.get(tid, tid), "is_home": tid == match_info["home_team_id"],
            "frames_used": n, "avg_players_tracked": round(acc["n_sum"] / n, 2),
            "width_std_y": round(acc["width_sum"] / n, 2), "length_std_x": round(acc["length_sum"] / n, 2),
        })
    return out


def _ensure_data_source(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT id FROM data_source WHERE provider = 'idsse_open_data'").fetchone()
    if row:
        return row["id"]
    cur = conn.execute(
        "INSERT INTO data_source (provider, license, retrieved_at) VALUES (?, ?, ?)",
        ("idsse_open_data", LICENSE, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    return cur.lastrowid


def ingest_match(conn: sqlite3.Connection, match_key: str) -> list[dict]:
    _ensure_data_source(conn)
    files = match_file_stems(match_key)

    info_bytes = _fetch_cached(f"{HF_BASE}/{files['info']}", RAW_DIR / files["info"])
    match_info = parse_match_info(info_bytes)

    positions_path = RAW_DIR / files["positions"]
    if not positions_path.exists():
        data = _fetch_cached(f"{HF_BASE}/{files['positions']}", positions_path)  # noqa: F841 - cached to disk, not held in memory further

    results = compute_team_compactness(positions_path, match_info)
    for r in results:
        conn.execute(
            """INSERT OR REPLACE INTO tracking_team_match
               (provider, provider_match_id, team_name, is_home, frames_used,
                avg_players_tracked, width_std_y, length_std_x, tracking_variant)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            ("idsse_open_data", match_info["match_id"], r["team_name"], int(r["is_home"]),
             r["frames_used"], r["avg_players_tracked"], r["width_std_y"], r["length_std_x"], "observed"),
        )
    conn.commit()
    return results

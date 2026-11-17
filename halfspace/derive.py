"""
Derived tables for models, built from the cached raw StatsBomb JSON (data/raw/).

The canonical SQLite DB keeps a thin event table; models need more (possession ids, play
pattern, pressure, shot detail, pass detail, and the defender positions inside each shot).
Rather than bloat the hosted DB, we parse raw once into local pickles (data/derived/, gitignored,
never hosted) and models write only their small outputs into data/derived.db.

  events.pkl   one row per on-ball event (no Ball Receipt*), rich columns
  shots.pkl    one row per shot + features read from the shot's own freeze-frame
  matches.pkl  one row per match: competition, season, gender, teams, score

Incremental: build() skips matches already in the pickles.
"""
import json
import math
import sqlite3
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "derived"
GOAL_X = 120.0
POST_LO, POST_HI = 36.34, 43.66  # goalposts (7.32 yd goal centred on y=40)

SKIP_TYPES = {"Ball Receipt*", "Starting XI", "Half Start", "Half End", "Tactical Shift", "Substitution",
              "Player On", "Player Off", "Injury Stoppage", "Referee Ball-Drop", "Camera On", "Camera off",
              "Offside", "Bad Behaviour", "Error", "Shield", "50/50"}


def _outcome(e: dict) -> str | None:
    for k in ("shot", "pass", "dribble", "duel", "clearance", "interception", "goalkeeper", "block"):
        o = e.get(k, {}).get("outcome")
        if o:
            return o["name"]
    return None


def _in_triangle(px, py, ax, ay, bx, by, cx, cy) -> bool:
    d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
    d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
    d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
    neg, pos = (d1 < 0) or (d2 < 0) or (d3 < 0), (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (neg and pos)


def shot_frame_features(x: float, y: float, frame: list[dict]) -> dict:
    """Defender / keeper features from the shot's own freeze-frame (opponents are teammate=False)."""
    opp = [p["location"] for p in frame if not p.get("teammate")]
    kp = next((p for p in frame if not p.get("teammate") and p.get("position", {}).get("name") == "Goalkeeper"), None)
    keeper = kp["location"] if kp else None
    outfield = [loc for loc in opp if loc is not keeper]
    in_cone = sum(_in_triangle(px, py, x, y, GOAL_X, POST_LO, GOAL_X, POST_HI) for px, py in outfield)
    nearest = min((math.hypot(px - x, py - y) for px, py in outfield), default=None)
    return {
        "has_ff": 1 if frame else 0,
        "keeper_x": keeper[0] if keeper else None, "keeper_y": keeper[1] if keeper else None,
        "keeper_id": kp.get("player", {}).get("id") if kp else None,
        "n_def_cone": in_cone, "nearest_def": nearest,
        "n_def_5": sum(math.hypot(px - x, py - y) <= 5 for px, py in outfield),
        "n_team_vis": sum(1 for p in frame if p.get("teammate")),
    }


def parse_match(match_id: int, events: list[dict]) -> tuple[pd.DataFrame, pd.DataFrame]:
    rows, shots = [], []
    for e in events:
        t = e["type"]["name"]
        if t in SKIP_TYPES:
            continue
        loc = e.get("location") or [None, None]
        p, c, s = e.get("pass", {}), e.get("carry", {}), e.get("shot", {})
        end = p.get("end_location") or c.get("end_location") or s.get("end_location") or [None, None, None]
        pos = e.get("position", {}).get("name")
        rows.append((
            match_id, e["index"], e["period"], e["minute"] * 60 + e["second"], t, e["id"],
            e.get("team", {}).get("id"), e.get("player", {}).get("id"), pos,
            e["possession"], e.get("possession_team", {}).get("id"), e.get("play_pattern", {}).get("name"),
            loc[0], loc[1], end[0], end[1], 1 if e.get("under_pressure") else 0, 1 if e.get("counterpress") else 0,
            _outcome(e), p.get("recipient", {}).get("id"), p.get("length"), p.get("angle"),
            p.get("height", {}).get("name"), p.get("type", {}).get("name"),
            (p.get("body_part") or s.get("body_part") or {}).get("name"),
        ))
        if t == "Shot":
            ff = shot_frame_features(loc[0], loc[1], s.get("freeze_frame") or [])
            shots.append({
                "match_id": match_id, "event_id": e["id"], "period": e["period"], "t": e["minute"] * 60 + e["second"],
                "team_id": e["team"]["id"], "player_id": e.get("player", {}).get("id"), "x": loc[0], "y": loc[1],
                "end_y": end[1], "end_z": end[2] if len(end) > 2 else None, "xg_sb": s.get("statsbomb_xg"),
                "outcome": s["outcome"]["name"], "body_part": s.get("body_part", {}).get("name"),
                "technique": s.get("technique", {}).get("name"), "shot_type": s.get("type", {}).get("name"),
                "under_pressure": 1 if e.get("under_pressure") else 0, "first_time": 1 if s.get("first_time") else 0,
                "play_pattern": e.get("play_pattern", {}).get("name"),
                "goal": 1 if s["outcome"]["name"] == "Goal" else 0, **ff,
            })
    cols = ["match_id", "idx", "period", "t", "type", "event_id", "team_id", "player_id", "position", "possession",
            "possession_team_id", "play_pattern", "x", "y", "end_x", "end_y", "under_pressure", "counterpress",
            "outcome", "recipient_id", "pass_length", "pass_angle", "pass_height", "pass_type", "body_part"]
    return pd.DataFrame(rows, columns=cols), pd.DataFrame(shots)


def _worker(path: str):
    p = Path(path)
    try:
        return parse_match(int(p.stem), json.loads(p.read_text()))
    except json.JSONDecodeError:  # file still being written by a running ingest; picked up next build
        return pd.DataFrame(), pd.DataFrame()


def build_matches() -> pd.DataFrame:
    comps = {(c["competition_id"], c["season_id"]): c for c in json.loads((RAW / "competitions.json").read_text())}
    rows = []
    for f in (RAW / "matches").glob("*.json"):
        for m in json.loads(f.read_text()):
            c = comps.get((m["competition"]["competition_id"], m["season"]["season_id"]), {})
            rows.append({"match_id": m["match_id"], "competition_id": m["competition"]["competition_id"],
                         "season_id": m["season"]["season_id"], "competition": c.get("competition_name"),
                         "season": c.get("season_name"), "gender": c.get("competition_gender"),
                         "date": m.get("match_date"), "home_team_id": m["home_team"]["home_team_id"],
                         "away_team_id": m["away_team"]["away_team_id"], "home_score": m.get("home_score"),
                         "away_score": m.get("away_score")})
    return pd.DataFrame(rows)


def build(workers: int = 12) -> dict:
    """Parse any cached raw match not yet in the pickles, append, rewrite. Returns counts."""
    OUT.mkdir(parents=True, exist_ok=True)
    ev_p, sh_p = OUT / "events.pkl", OUT / "shots.pkl"
    ev = pd.read_pickle(ev_p) if ev_p.exists() else pd.DataFrame()
    sh = pd.read_pickle(sh_p) if sh_p.exists() else pd.DataFrame()
    have = set(ev["match_id"].unique()) if len(ev) else set()
    todo = [str(f) for f in sorted((RAW / "events").glob("*.json")) if int(f.stem) not in have]
    if todo:
        with ProcessPoolExecutor(workers) as pool:
            parts = list(pool.map(_worker, todo, chunksize=8))
        ev = pd.concat([ev] + [a for a, _ in parts if len(a)], ignore_index=True)
        sh = pd.concat([sh] + [b for _, b in parts if len(b)], ignore_index=True)
        for col in ("type", "position", "play_pattern", "outcome", "pass_height", "pass_type", "body_part"):
            ev[col] = ev[col].astype("category")
        ev.to_pickle(ev_p)
        sh.to_pickle(sh_p)
    mt = build_matches()
    mt["max_period"] = mt["match_id"].map(ev.groupby("match_id")["period"].max())  # 3+ = extra time, 5 = shootout
    mt.to_pickle(OUT / "matches.pkl")
    return {"new_matches": len(todo), "matches": ev["match_id"].nunique(), "events": len(ev), "shots": len(sh)}


def load_events() -> pd.DataFrame:
    return pd.read_pickle(OUT / "events.pkl")


def load_shots() -> pd.DataFrame:
    return pd.read_pickle(OUT / "shots.pkl")


def load_matches() -> pd.DataFrame:
    return pd.read_pickle(OUT / "matches.pkl")


# --- serving store: small model outputs, shipped with the app --------------------------------

DERIVED_DB = ROOT / "data" / "derived.db"


def connect_derived() -> sqlite3.Connection:
    conn = sqlite3.connect(DERIVED_DB)
    conn.row_factory = sqlite3.Row
    return conn


def write_table(name: str, df: pd.DataFrame) -> None:
    conn = connect_derived()
    df.to_sql(name, conn, if_exists="replace", index=False)
    conn.commit()
    conn.close()

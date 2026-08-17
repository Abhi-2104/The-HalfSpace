"""
Pitch-visualization features: the data behind heatmaps, pass networks, and
360 freeze-frames. All read from the canonical event/freeze_frame tables -
the frontend renders SVG from these, no image generation server-side.

StatsBomb pitch is 120 x 80 (x: 0->120 attacking right, y: 0->80).
"""
import json
import sqlite3

PITCH_X = 120.0
PITCH_Y = 80.0


def player_heatmap(conn: sqlite3.Connection, match_id: int, player_id: int, bins_x: int = 24, bins_y: int = 16) -> dict:
    """Binned touch counts for one player in one match - the grid the frontend
    shades into a heatmap. Uses event locations (every touch), not 360 - a
    player's own touch map doesn't need freeze-frames."""
    rows = conn.execute(
        "SELECT x, y FROM event WHERE match_id = ? AND player_id = ? AND x IS NOT NULL AND period IN (1,2,3,4)",
        (match_id, player_id),
    ).fetchall()
    grid = [[0] * bins_x for _ in range(bins_y)]
    for r in rows:
        bx = min(bins_x - 1, int(r["x"] / PITCH_X * bins_x))
        by = min(bins_y - 1, int(r["y"] / PITCH_Y * bins_y))
        grid[by][bx] += 1
    peak = max((max(row) for row in grid), default=0)
    return {"match_id": match_id, "player_id": player_id, "bins_x": bins_x, "bins_y": bins_y,
            "grid": grid, "peak": peak, "touches": len(rows)}


def season_player_heatmap(conn: sqlite3.Connection, competition_id: int, season_id: int, player_id: int,
                           bins_x: int = 24, bins_y: int = 16) -> dict:
    """Where a player touches the ball across a whole competition/season - the
    heatmap that belongs on the season-level player page."""
    rows = conn.execute(
        """SELECT e.x, e.y FROM event e JOIN match m ON m.id = e.match_id
           WHERE m.competition_id = ? AND m.season_id = ? AND e.player_id = ?
             AND e.x IS NOT NULL AND e.period IN (1,2,3,4)""",
        (competition_id, season_id, player_id),
    ).fetchall()
    grid = [[0] * bins_x for _ in range(bins_y)]
    for r in rows:
        bx = min(bins_x - 1, int(r["x"] / PITCH_X * bins_x))
        by = min(bins_y - 1, int(r["y"] / PITCH_Y * bins_y))
        grid[by][bx] += 1
    peak = max((max(row) for row in grid), default=0)
    return {"player_id": player_id, "bins_x": bins_x, "bins_y": bins_y, "grid": grid, "peak": peak, "touches": len(rows)}


def team_heatmap(conn: sqlite3.Connection, match_id: int, team_id: int, bins_x: int = 24, bins_y: int = 16) -> dict:
    """Territory heatmap: where a team's actions happen. Same binning, all players."""
    rows = conn.execute(
        "SELECT x, y FROM event WHERE match_id = ? AND team_id = ? AND x IS NOT NULL AND period IN (1,2,3,4)",
        (match_id, team_id),
    ).fetchall()
    grid = [[0] * bins_x for _ in range(bins_y)]
    for r in rows:
        bx = min(bins_x - 1, int(r["x"] / PITCH_X * bins_x))
        by = min(bins_y - 1, int(r["y"] / PITCH_Y * bins_y))
        grid[by][bx] += 1
    peak = max((max(row) for row in grid), default=0)
    return {"match_id": match_id, "team_id": team_id, "bins_x": bins_x, "bins_y": bins_y,
            "grid": grid, "peak": peak, "actions": len(rows)}


def pass_network(conn: sqlite3.Connection, match_id: int, team_id: int, until_first_sub: bool = True) -> dict:
    """
    Pass network: nodes = players at their average pass location, edges = pass
    counts between pairs. Convention (matches published pass-network practice):
    only completed passes, and by default only up to the team's first
    substitution - after subs the "average position" of a shirt smears across
    two players and the network stops meaning one shape. That cutoff is
    reported so the frontend can label it honestly.
    """
    # first substitution minute for this team (period/minute of first Substitution event)
    cutoff = None
    if until_first_sub:
        sub = conn.execute(
            "SELECT MIN(minute) m FROM event WHERE match_id=? AND team_id=? AND type_name='Substitution'",
            (match_id, team_id),
        ).fetchone()
        cutoff = sub["m"] if sub and sub["m"] is not None else None

    q = """SELECT e.player_id, p.name AS player_name, e.x, e.y, e.end_x, e.end_y, e.minute
           FROM event e LEFT JOIN player p ON p.id = e.player_id
           WHERE e.match_id=? AND e.team_id=? AND e.type_name='Pass'
             AND e.outcome_name IS NULL AND e.x IS NOT NULL AND e.end_x IS NOT NULL
             AND e.period IN (1,2,3,4)"""
    params = [match_id, team_id]
    if cutoff is not None:
        q += " AND e.minute < ?"
        params.append(cutoff)
    passes = conn.execute(q, params).fetchall()

    # node = passer avg location + pass count; also need receiver, inferred as the
    # player whose next touch is nearest the pass end - StatsBomb doesn't label the
    # recipient on the pass event directly in our stored schema, so we approximate
    # edges by pass origin only when recipient is unknown. Keep it honest: we build
    # nodes (reliable) and edges from pass end-location proximity to teammate nodes.
    from collections import defaultdict
    loc_sum = defaultdict(lambda: [0.0, 0.0, 0])
    names = {}
    for r in passes:
        acc = loc_sum[r["player_id"]]
        acc[0] += r["x"]; acc[1] += r["y"]; acc[2] += 1
        names[r["player_id"]] = r["player_name"]
    nodes = {pid: {"player_id": pid, "name": names.get(pid),
                   "x": round(acc[0] / acc[2], 1), "y": round(acc[1] / acc[2], 1), "passes": acc[2]}
             for pid, acc in loc_sum.items() if acc[2] > 0}

    # edges: assign each pass to the nearest teammate node to its end location
    edges = defaultdict(int)
    node_list = list(nodes.values())
    for r in passes:
        if not node_list:
            break
        ex, ey = r["end_x"], r["end_y"]
        nearest = min(node_list, key=lambda n: (n["x"] - ex) ** 2 + (n["y"] - ey) ** 2)
        if nearest["player_id"] != r["player_id"]:
            key = tuple(sorted([r["player_id"], nearest["player_id"]]))
            edges[key] += 1

    return {
        "match_id": match_id, "team_id": team_id,
        "cutoff_minute": cutoff,
        "cutoff_note": (f"passes before the first substitution ({cutoff}') - after subs, average positions blur"
                        if cutoff is not None else "all completed passes (no substitution found)"),
        "nodes": sorted(nodes.values(), key=lambda n: -n["passes"]),
        "edges": [{"a": a, "b": b, "passes": c} for (a, b), c in sorted(edges.items(), key=lambda kv: -kv[1])],
        "recipient_note": "edges are approximated by nearest teammate to each pass's end location (recipient not stored on the event)",
    }


def shot_freeze_frame(conn: sqlite3.Connection, event_id: str) -> dict | None:
    """The 360 freeze-frame for one event (usually a shot): every visible
    player's location + who they are. This is the 'what made this chance' view."""
    row = conn.execute(
        "SELECT freeze_frame, visible_area FROM freeze_frame WHERE event_id = ?", (event_id,)
    ).fetchone()
    if not row:
        return None
    return {
        "event_id": event_id,
        "freeze_frame": json.loads(row["freeze_frame"]),
        "visible_area": json.loads(row["visible_area"]) if row["visible_area"] else [],
    }


def match_shots_with_xg(conn: sqlite3.Connection, match_id: int) -> list[dict]:
    """Shots with our xG-lite score + whether a 360 freeze-frame exists for each.
    Drives the upgraded shot map (dot size = xG, click -> freeze-frame)."""
    from halfspace.features import shot_quality
    rows = conn.execute(
        """SELECT e.id, e.team_id, t.name AS team_name, e.player_id, p.name AS player_name,
                  e.minute, e.second, e.x, e.y, e.outcome_name, e.body_part,
                  (ff.event_id IS NOT NULL) AS has_freeze_frame
           FROM event e
           JOIN team t ON t.id = e.team_id
           LEFT JOIN player p ON p.id = e.player_id
           LEFT JOIN freeze_frame ff ON ff.event_id = e.id
           WHERE e.match_id = ? AND e.type_name = 'Shot' AND e.period IN (1,2,3,4)
           ORDER BY e.minute, e.second""",
        (match_id,),
    ).fetchall()
    model_ready = shot_quality.MODEL_PATH.exists()
    out = []
    for r in rows:
        d = dict(r)
        d["has_freeze_frame"] = bool(r["has_freeze_frame"])
        if model_ready and r["x"] is not None:
            d["xg"] = round(shot_quality.score_shot(r["x"], r["y"], is_header=(r["body_part"] == "Head")), 3)
        else:
            d["xg"] = None
        out.append(d)
    return out

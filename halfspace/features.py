"""
Feature computation over canonical `event` rows.
Two bugs from the scratchpad pipeline test are fixed here, once, at the shared layer -
not patched per-caller:
  1. period scoping - period 5 is the penalty shootout, not "extra extra time".
     Anything that says "the match" must default to periods (1,2,3,4) unless it
     explicitly wants the shootout.
  2. progressive passes must exclude goalkeepers - a GK punting the ball 40m
     downfield satisfies the naive ">=25% closer" definition and pollutes any
     ranking that uses it. Real fix: exclude GK position, not just document the flaw.
"""
import sqlite3

REGULATION_PERIODS = (1, 2, 3, 4)  # excludes 5 = shootout
PRESS_ZONE_X = 40  # PPDA zone: opponent's build-up 60% of the pitch (x >= 40 on 0-120 scale)
DEF_ACTION_TYPES = {"Pressure", "Duel", "Interception", "Foul Committed"}


def match_events(conn: sqlite3.Connection, match_id: int, periods=REGULATION_PERIODS):
    q = """SELECT * FROM event WHERE match_id = ? AND period IN ({})""".format(
        ",".join("?" * len(periods))
    )
    return conn.execute(q, (match_id, *periods)).fetchall()


def shot_summary(conn: sqlite3.Connection, match_id: int) -> dict:
    rows = match_events(conn, match_id)
    by_team = {}
    for r in rows:
        if r["type_name"] != "Shot":
            continue
        t = by_team.setdefault(r["team_id"], {"shots": 0, "goals": 0})
        t["shots"] += 1
        if r["outcome_name"] == "Goal":
            t["goals"] += 1
    return by_team


def goals_timeline(conn: sqlite3.Connection, match_id: int) -> list:
    rows = match_events(conn, match_id)
    return [
        {"minute": r["minute"], "second": r["second"], "team_id": r["team_id"], "player_id": r["player_id"]}
        for r in rows if r["type_name"] == "Shot" and r["outcome_name"] == "Goal"
    ]


def ppda(conn: sqlite3.Connection, match_id: int) -> dict:
    """PPDA per team for this match. Lower = higher press. Standard proxy metric, not invented here."""
    rows = match_events(conn, match_id)
    teams = sorted({r["team_id"] for r in rows if r["team_id"] is not None})
    if len(teams) != 2:
        return {}
    passes = {t: 0 for t in teams}
    def_actions = {t: 0 for t in teams}
    for r in rows:
        if r["team_id"] is None or r["x"] is None or r["x"] < PRESS_ZONE_X:
            continue
        if r["type_name"] == "Pass":
            passes[r["team_id"]] += 1
        elif r["type_name"] in DEF_ACTION_TYPES:
            def_actions[r["team_id"]] += 1
    t1, t2 = teams
    result = {}
    for presser, opponent in [(t1, t2), (t2, t1)]:
        if def_actions[presser] > 0:
            result[presser] = round(passes[opponent] / def_actions[presser], 2)
    return result


def is_progressive_pass(x, end_x) -> bool:
    if x is None or end_x is None:
        return False
    start_dist = 120 - x
    if start_dist <= 0:
        return False
    return (start_dist - (120 - end_x)) / start_dist >= 0.25


def player_progressive_passes(conn: sqlite3.Connection, match_id: int, exclude_positions=("Goalkeeper",)) -> dict:
    """Progressive pass counts per player, GK excluded by default (see module docstring)."""
    rows = conn.execute(
        """
        SELECT e.player_id, e.x, e.end_x, pmm.position
        FROM event e
        LEFT JOIN player_match_minutes pmm
          ON pmm.match_id = e.match_id AND pmm.player_id = e.player_id
        WHERE e.match_id = ? AND e.type_name = 'Pass' AND e.period IN (1,2,3,4)
        """,
        (match_id,),
    ).fetchall()
    counts = {}
    for r in rows:
        if r["position"] in exclude_positions:
            continue
        if is_progressive_pass(r["x"], r["end_x"]):
            counts[r["player_id"]] = counts.get(r["player_id"], 0) + 1
    return counts

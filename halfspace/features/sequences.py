"""
Sequence search: counterattack detector, ported from the scratchpad heuristic
that found 2 real candidates in the WC2022 Final (incl. Mbappé's 2nd goal off
a quick transition). This is a rule-based heuristic, not a trained classifier -
confidence is always reported as "medium" in the output, never hidden as
ground truth (project spec: distinguish detection method, don't fake certainty).
"""
import sqlite3

TURNOVER_TYPES = {"Ball Recovery", "Interception", "Duel", "Block"}
WINDOW_SECONDS = 15
MIN_DISTANCE_M = 30


def find_counterattacks(conn: sqlite3.Connection, match_id: int) -> list[dict]:
    rows = conn.execute(
        """SELECT id, period, minute, second, team_id, player_id, type_name, x, outcome_name
           FROM event WHERE match_id = ? AND period IN (1,2) ORDER BY period, minute, second""",
        (match_id,),
    ).fetchall()

    events = [dict(r) for r in rows]
    for e in events:
        e["ts"] = e["minute"] * 60 + e["second"]

    candidates = []
    for i, ev in enumerate(events):
        if ev["type_name"] not in TURNOVER_TYPES or ev["x"] is None:
            continue
        team, t0, start_x = ev["team_id"], ev["ts"], ev["x"]

        shot = next(
            (e for e in events if e["ts"] > t0 and e["ts"] <= t0 + WINDOW_SECONDS
             and e["team_id"] == team and e["type_name"] == "Shot" and e["x"] is not None),
            None,
        )
        if shot is None:
            continue
        dist = abs(shot["x"] - start_x)
        if dist < MIN_DISTANCE_M:
            continue
        candidates.append({
            "team_id": team, "start_minute": ev["minute"], "start_second": ev["second"],
            "trigger_type": ev["type_name"], "distance_m": round(dist, 1),
            "time_to_shot_s": round(shot["ts"] - t0, 1),
            "shooter_player_id": shot["player_id"], "shot_outcome": shot["outcome_name"],
            "confidence": "medium",
            "method": "heuristic: turnover -> same-team shot within 15s covering >=30m",
        })

    # de-dupe on (team, start_minute, start_second)
    seen, out = set(), []
    for c in candidates:
        key = (c["team_id"], c["start_minute"], c["start_second"])
        if key not in seen:
            seen.add(key)
            out.append(c)
    return out

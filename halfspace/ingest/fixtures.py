"""
Fixtures, results and standings for the current season. Two sources, both free:
  - football-data.org (needs a free API key in FOOTBALL_DATA_KEY; 10 calls/minute; scores are delayed on the free tier)
  - openfootball (CC0 files on GitHub, no key; standings are computed from the results)
Stored in the serving DB (data/derived.db) so an ingest never fights the events DB for a write lock.
A source's rows for a competition are replaced as a whole on each refresh.
"""
import json
import os
import time
from datetime import date, datetime, timezone
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from halfspace import derive
from halfspace.agent.llm import load_dotenv

OPENFOOTBALL = {"en.1": ("PL", "Premier League"), "es.1": ("PD", "La Liga"), "de.1": ("BL1", "Bundesliga"),
                "it.1": ("SA", "Serie A"), "fr.1": ("FL1", "Ligue 1"), "pt.1": ("PPL", "Primeira Liga"), "nl.1": ("DED", "Eredivisie")}
FD_CODES = ["PL", "ELC", "BL1", "SA", "PD", "FL1", "CL", "EC", "WC", "DED", "PPL", "BSA"]  # the free-tier list at time of writing
FD_BASE = "https://api.football-data.org/v4"
OF_BASE = "https://raw.githubusercontent.com/openfootball/football.json/master"
FD_PAUSE = 6.5  # free tier: 10 requests/minute

SCHEMA = """
CREATE TABLE IF NOT EXISTS fixture (
    source TEXT NOT NULL, match_id TEXT NOT NULL, competition_code TEXT NOT NULL, competition TEXT, season TEXT,
    matchday TEXT, kickoff TEXT, status TEXT, home TEXT, away TEXT, home_score INTEGER, away_score INTEGER,
    updated_at TEXT NOT NULL, PRIMARY KEY (source, match_id));
CREATE INDEX IF NOT EXISTS idx_fixture_comp ON fixture(competition_code, kickoff);
CREATE TABLE IF NOT EXISTS standing (
    source TEXT NOT NULL, competition_code TEXT NOT NULL, season TEXT, position INTEGER NOT NULL, team TEXT NOT NULL,
    played INTEGER, won INTEGER, drawn INTEGER, lost INTEGER, goals_for INTEGER, goals_against INTEGER, goal_diff INTEGER,
    points INTEGER, updated_at TEXT NOT NULL, PRIMARY KEY (source, competition_code, position));
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _conn():
    c = derive.connect_derived()
    c.executescript(SCHEMA)
    return c


def _get(url: str, headers: dict | None = None):
    with urlopen(Request(url, headers=headers or {"User-Agent": "halfspace"}), timeout=60) as r:
        return json.loads(r.read())


def current_season(today: date | None = None) -> str:
    t = today or date.today()
    y = t.year if t.month >= 7 else t.year - 1
    return f"{y}-{(y + 1) % 100:02d}"


def standings_from_results(matches: list[dict]) -> list[dict]:
    """Points table from finished matches: 3/1/0 points, ordered by points, goal difference, goals scored."""
    t: dict[str, dict] = {}
    for m in matches:
        if m["home_score"] is None or m["away_score"] is None or m["status"] != "FINISHED":
            continue
        for team, gf, ga in ((m["home"], m["home_score"], m["away_score"]), (m["away"], m["away_score"], m["home_score"])):
            r = t.setdefault(team, {"team": team, "played": 0, "won": 0, "drawn": 0, "lost": 0, "goals_for": 0, "goals_against": 0})
            r["played"] += 1
            r["goals_for"] += gf
            r["goals_against"] += ga
            r["won" if gf > ga else "drawn" if gf == ga else "lost"] += 1
    rows = list(t.values())
    for r in rows:
        r["goal_diff"], r["points"] = r["goals_for"] - r["goals_against"], 3 * r["won"] + r["drawn"]
    rows.sort(key=lambda r: (-r["points"], -r["goal_diff"], -r["goals_for"], r["team"]))
    for i, r in enumerate(rows, 1):
        r["position"] = i
    return rows


def _store(conn, source, code, fixtures, standings):
    now = _now()
    conn.execute("DELETE FROM fixture WHERE source=? AND competition_code=?", (source, code))
    conn.execute("DELETE FROM standing WHERE source=? AND competition_code=?", (source, code))
    conn.executemany("INSERT OR REPLACE INTO fixture VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", [
        (source, f["match_id"], code, f["competition"], f["season"], f["matchday"], f["kickoff"], f["status"], f["home"], f["away"],
         f["home_score"], f["away_score"], now) for f in fixtures])
    conn.executemany("INSERT OR REPLACE INTO standing VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
        (source, code, s.get("season"), s["position"], s["team"], s["played"], s["won"], s["drawn"], s["lost"], s["goals_for"],
         s["goals_against"], s["goal_diff"], s["points"], now) for s in standings])
    conn.commit()


def refresh_openfootball(conn=None, fetch=_get) -> dict:
    conn = conn or _conn()
    out = {}
    for of_code, (code, name) in OPENFOOTBALL.items():
        season = current_season()
        try:
            data = fetch(f"{OF_BASE}/{season}/{of_code}.json")
        except HTTPError:
            season = f"{int(season[:4]) - 1}-{int(season[:4]) % 100:02d}"  # new season file not published yet
            data = fetch(f"{OF_BASE}/{season}/{of_code}.json")
        fx = []
        for i, m in enumerate(data["matches"]):
            sc = m.get("score")  # usually {"ft": [h, a], "ht": ...}; a few files write a bare [h, a]
            ft = sc.get("ft") if isinstance(sc, dict) else (sc if isinstance(sc, list) and len(sc) == 2 else None)
            fx.append({"match_id": f"{of_code}-{season}-{i}", "competition": name, "season": season, "matchday": m.get("round"),
                       "kickoff": f"{m['date']}T{m.get('time', '00:00')}", "status": "FINISHED" if ft else "SCHEDULED",
                       "home": m["team1"], "away": m["team2"], "home_score": ft[0] if ft else None, "away_score": ft[1] if ft else None})
        st = [{**s, "season": season} for s in standings_from_results(fx)]
        _store(conn, "openfootball", code, fx, st)
        out[code] = {"fixtures": len(fx), "season": season}
    return out


def refresh_football_data(conn=None, key: str | None = None, fetch=_get, pause: float = FD_PAUSE) -> dict:
    load_dotenv()
    key = key or os.environ.get("FOOTBALL_DATA_KEY", "")
    if not key:
        raise RuntimeError("FOOTBALL_DATA_KEY not set (free key: https://www.football-data.org/client/register)")
    conn = conn or _conn()
    head, out = {"X-Auth-Token": key}, {}
    for code in FD_CODES:
        try:
            time.sleep(pause)
            ms = fetch(f"{FD_BASE}/competitions/{code}/matches", head)
            time.sleep(pause)
            st = fetch(f"{FD_BASE}/competitions/{code}/standings", head)
        except HTTPError as e:
            out[code] = {"skipped": f"HTTP {e.code}"}  # 403 = not in the free plan, 429 = rate limit
            continue
        season = str(ms.get("filters", {}).get("season") or ms["matches"][0]["season"]["startDate"][:4]) if ms.get("matches") else None
        fx = [{"match_id": str(m["id"]), "competition": ms["competition"]["name"], "season": season, "matchday": str(m.get("matchday")),
               "kickoff": m["utcDate"], "status": m["status"], "home": m["homeTeam"]["name"], "away": m["awayTeam"]["name"],
               "home_score": m["score"]["fullTime"]["home"], "away_score": m["score"]["fullTime"]["away"]} for m in ms["matches"]]
        table = next((s["table"] for s in st.get("standings", []) if s.get("type") == "TOTAL"), [])
        rows = [{"position": r["position"], "team": r["team"]["name"], "played": r["playedGames"], "won": r["won"], "drawn": r["draw"],
                 "lost": r["lost"], "goals_for": r["goalsFor"], "goals_against": r["goalsAgainst"], "goal_diff": r["goalDifference"],
                 "points": r["points"], "season": season} for r in table]
        _store(conn, "football-data.org", code, fx, rows)
        out[code] = {"fixtures": len(fx), "table_rows": len(rows)}
    return out


# --- reads, shared by the API and the agent tools ---

def best_source(c, code: str):
    """football-data.org when we have it for this competition (richer, official), else openfootball."""
    row = c.execute("SELECT source FROM fixture WHERE competition_code=? GROUP BY source "
                    "ORDER BY (source = 'football-data.org') DESC, MAX(updated_at) DESC LIMIT 1", (code,)).fetchone()
    return row["source"] if row else None


def read_fixtures(code: str, status=None, team=None, date_from=None, date_to=None, limit=50) -> dict | None:
    c = _conn()
    code = code.upper()
    src = best_source(c, code)
    if src is None:
        return None
    q, args = "SELECT * FROM fixture WHERE competition_code=? AND source=?", [code, src]
    if status:
        q += " AND status=?"
        args.append(status.upper())
    if team:
        q += " AND (home LIKE ? OR away LIKE ?)"
        args += [f"%{team}%", f"%{team}%"]
    if date_from:
        q += " AND kickoff >= ?"
        args.append(date_from)
    if date_to:
        q += " AND kickoff <= ?"
        args.append(date_to + "T99")
    rows = c.execute(q + " ORDER BY kickoff LIMIT ?", (*args, min(limit, 500))).fetchall()
    return {"competition": code, "source": src, "fixtures": [dict(r) for r in rows],
            "note": "Scores are delayed on the free football-data.org tier. openfootball is community-maintained and may lag."}


def read_standings(code: str) -> dict | None:
    c = _conn()
    code = code.upper()
    src = best_source(c, code)
    rows = c.execute("SELECT * FROM standing WHERE competition_code=? AND source=? ORDER BY position", (code, src)).fetchall() if src else []
    if not rows:
        return None
    return {"competition": code, "source": src, "season": rows[0]["season"], "updated_at": rows[0]["updated_at"], "table": [dict(r) for r in rows],
            "note": "From openfootball results (computed) or football-data.org (official), whichever is available."}

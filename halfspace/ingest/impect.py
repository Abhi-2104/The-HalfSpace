"""
Impect Open Data (Bundesliga 2023/24): per-player KPI aggregates (packing, xG, ...), matches, squads, players.
Stored in data/restricted.db, NOT in the main DB and NOT served by any public endpoint.

Why restricted: the data's Terms of Use (LICENSE.pdf in the repo) allow research and analysis only: no commercial use,
no redistribution or reproduction of the data, credit to Impect when publishing insights, revocable at any time, and
the data must not be used in a way that interferes with Impect's business. A public website that shows Impect numbers
may not fit that, so this ingest is opt-in: set HALFSPACE_ACCEPT_IMPECT_TERMS=yes only after reading the terms yourself.
"""
import json
import os
import sqlite3
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent.parent
RAW = ROOT / "data" / "raw" / "impect"
DB_PATH = ROOT / "data" / "restricted.db"
API = "https://api.github.com/repos/ImpectAPI/open-data/contents/data"
RAW_BASE = "https://raw.githubusercontent.com/ImpectAPI/open-data/main/data"

SCHEMA = """
CREATE TABLE IF NOT EXISTS impect_kpi_def (id INTEGER PRIMARY KEY, name TEXT, json TEXT);
CREATE TABLE IF NOT EXISTS impect_entity (kind TEXT, id INTEGER, name TEXT, json TEXT, PRIMARY KEY (kind, id));
CREATE TABLE IF NOT EXISTS impect_player_kpi (match_id INTEGER, squad_id INTEGER, player_id INTEGER, position TEXT,
    play_duration REAL, kpi_id INTEGER, value REAL);
CREATE INDEX IF NOT EXISTS idx_impect_pk ON impect_player_kpi(match_id, player_id);
CREATE INDEX IF NOT EXISTS idx_impect_kpi ON impect_player_kpi(kpi_id);
"""


def require_terms() -> None:
    if os.environ.get("HALFSPACE_ACCEPT_IMPECT_TERMS", "").lower() != "yes":
        raise SystemExit("Impect data is under restricted Terms of Use (no commercial use, no redistribution, revocable). Read "
                         "https://github.com/ImpectAPI/open-data (LICENSE.pdf), then set HALFSPACE_ACCEPT_IMPECT_TERMS=yes to ingest.")


def _get(url: str) -> bytes:
    with urlopen(Request(url, headers={"User-Agent": "halfspace"}), timeout=120) as r:
        return r.read()


def _cached(rel: str) -> bytes:
    p = RAW / rel
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(_get(f"{RAW_BASE}/{rel}"))
    return p.read_bytes()


def _listing(folder: str) -> list[str]:
    return [x["name"] for x in json.loads(_get(f"{API}/{folder}")) if x["name"].endswith(".json")]


def store_player_kpis(conn: sqlite3.Connection, doc: dict) -> int:
    rows = []
    for side in ("squadHome", "squadAway"):
        sq = doc.get(side) or {}
        for p in sq.get("players", []):
            for k in p.get("kpis", []):
                if k.get("value") is not None:
                    rows.append((doc["matchId"], sq.get("id"), p["id"], p.get("position"), p.get("playDuration"), k["kpiId"], k["value"]))
    conn.execute("DELETE FROM impect_player_kpi WHERE match_id = ?", (doc["matchId"],))
    conn.executemany("INSERT INTO impect_player_kpi VALUES (?,?,?,?,?,?,?)", rows)
    return len(rows)


def _entities(conn, kind: str, doc) -> int:
    items = doc if isinstance(doc, list) else doc.get("data", [])
    n = 0
    for it in items:
        if isinstance(it, dict) and "id" in it:
            name = next((str(it[k]) for k in ("commonname", "name", "fullName", "shortName") if it.get(k)), None)
            conn.execute("INSERT OR REPLACE INTO impect_entity VALUES (?,?,?,?)", (kind, it["id"], name, json.dumps(it)))
            n += 1
    return n


def ingest(limit: int | None = None, log=print) -> dict:
    require_terms()
    conn = sqlite3.connect(DB_PATH, timeout=60)
    conn.executescript(SCHEMA)
    defs = json.loads(_cached("kpi_definitions.json"))
    for d in defs if isinstance(defs, list) else defs.get("data", []):
        conn.execute("INSERT OR REPLACE INTO impect_kpi_def VALUES (?,?,?)", (d.get("id"), d.get("name"), json.dumps(d)))
    for kind in ("matches", "squads", "players"):
        for name in _listing(kind):
            _entities(conn, kind, json.loads(_cached(f"{kind}/{name}")))
    files = _listing("player_kpis")[:limit]
    done = {r[0] for r in conn.execute("SELECT DISTINCT match_id FROM impect_player_kpi")}
    rows = 0
    for i, name in enumerate(files, 1):
        if int(name.rsplit("_", 1)[-1].split(".")[0]) in done:
            continue
        rows += store_player_kpis(conn, json.loads(_cached(f"player_kpis/{name}")))
        conn.commit()
        if i % 25 == 0:
            log(f"  {i}/{len(files)} matches")
    conn.commit()
    return {"matches": conn.execute("SELECT COUNT(DISTINCT match_id) FROM impect_player_kpi").fetchone()[0], "kpi_rows_added": rows}

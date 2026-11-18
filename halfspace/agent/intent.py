"""
Understand the question before the model sees it: what the user wants (intent), which competition, season, players
and teams they mean (resolved against the data, so the ids are real), and which tool should answer. The result goes to
the model as a short hint, so it does not have to guess ids or pick tools blindly, and it is told the scope the user
named so it does not widen it. Deterministic and free: no extra LLM call.
"""
import re
import sqlite3
import unicodedata
from dataclasses import dataclass, field

from halfspace import db, derive

# alias -> competition id. Ambiguous words ("euro", "world cup") default to the men's tournament unless "women" appears.
COMP_ALIASES = {"world cup": 43, "euro": 55, "euros": 55, "copa america": 223, "afcon": 1267, "african cup of nations": 1267,
                "africa cup of nations": 1267, "la liga": 11, "laliga": 11, "ligue 1": 7, "ligue1": 7, "bundesliga": 9,
                "mls": 44, "major league soccer": 44, "nwsl": 49, "wsl": 37, "women's super league": 37, "womens super league": 37,
                "super league": 37, "liga f": 182, "frauen bundesliga": 135, "serie a women": 131}
WOMEN = {43: 72, 55: 53, 9: 135}  # men's tournament id -> women's counterpart when the question says women
LIVE_LEAGUES = {"premier league": "PL", "epl": "PL", "la liga": "PD", "bundesliga": "BL1", "serie a": "SA", "ligue 1": "FL1",
                "primeira liga": "PPL", "eredivisie": "DED"}
NAME_STOP = {"messi_"}  # placeholder for names that clash with ordinary words, extended below
COMMON_WORDS = set("""long ward young king good best last first lewis white green brown hall hill short strong bell cook cross ford
 free wall wood west north south east park page price rice sharp small stone wise wright young true perfect bright park pass shot
 real goal press save corner front back wing mid line team game play ball kick head foot touch cut run set rise""".split())


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]+", " ", s).replace("  ", " ").strip()


@dataclass
class Analysis:
    intents: list[str] = field(default_factory=list)
    competition: dict | None = None        # {id, season_id, name}
    competition_ambiguous: list[str] = field(default_factory=list)
    players: list[dict] = field(default_factory=list)
    teams: list[dict] = field(default_factory=list)
    league_code: str | None = None
    tools: list[str] = field(default_factory=list)
    scope_named: bool = False

    def hint(self) -> str:
        L = ["Question analysis from the data (use these ids exactly; they are verified):"]
        L.append("- The user wants: " + ("; ".join(self.intents) if self.intents else "unclear: ask one short clarifying question if you cannot tell") + ".")
        if self.competition:
            c = self.competition
            L.append(f"- Competition named: {c['name']} (competition_id={c['id']}, season_id={c['season_id']}). The user named it, so stay inside it.")
        elif self.competition_ambiguous:
            L.append("- A competition was named but not which season; the data has: " + ", ".join(self.competition_ambiguous) + ". Ask which one, or cover each.")
        for p in self.players:
            L.append(f"- Player: {p['name']} (player_id={p['id']})" + (f", also possible: {', '.join(p['alt'])}" if p.get("alt") else "") + ".")
        for t in self.teams:
            L.append(f"- Team: {t['name']} (team_id={t['id']}).")
        if self.league_code:
            L.append(f"- Current-season league code for tables and fixtures: {self.league_code}.")
        if self.tools:
            L.append("- Best tools to start with: " + ", ".join(self.tools) + ".")
        if not self.scope_named and "similar players" in " ".join(self.intents):
            L.append("- No competition was named, so comparing across all competitions is fine.")
        L.append("If something above is missing or looks wrong, resolve it with find_matches or search_football before answering. "
                 "If the request is genuinely ambiguous, ask one short clarifying question.")
        return "\n".join(L)


_index = {"built_for": None}


def _build(conn: sqlite3.Connection) -> None:
    comps = {}
    for r in conn.execute("SELECT c.id cid, c.name cname, s.id sid, s.name sname FROM competition c JOIN season s ON s.competition_id=c.id"):
        comps.setdefault(r["cid"], {"name": r["cname"], "seasons": {}})["seasons"][r["sid"]] = r["sname"]
    d = derive.connect_derived()
    prof = d.execute("SELECT player_id, SUM(minutes) m FROM player_profile GROUP BY player_id").fetchall()
    minutes = {r["player_id"]: r["m"] for r in prof}
    ids = list(minutes)
    players = {}
    if ids:
        for r in conn.execute(f"SELECT id, name, display_name FROM player WHERE id IN ({','.join(map(str, ids))})"):
            players[r["id"]] = r["display_name"] or r["name"]
    full, last = {}, {}
    for pid, nm in players.items():
        full.setdefault(norm(nm), set()).add(pid)
        toks = norm(nm).split()
        if toks and len(toks[-1]) >= 4 and toks[-1] not in COMMON_WORDS:
            last.setdefault(toks[-1], set()).add(pid)
    teams = {}
    for r in conn.execute("SELECT id, name FROM team"):
        n = re.sub(r"\b(fc|cf|afc|sc|ac|club|women s|women|w)\b", "", norm(r["name"])).strip()
        if len(n) >= 4:
            teams.setdefault(n, set()).add(r["id"])
    _index.update(built_for=id(conn), comps=comps, players=players, minutes=minutes, full=full, last=last, teams=teams,
                  team_names={r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM team")})


def _word_in(q: str, key: str) -> bool:
    return re.search(rf"(?<![a-z0-9]){re.escape(key)}(?![a-z0-9])", q) is not None


def _competition(q: str, qn_women: bool):
    best = None
    for alias in sorted(COMP_ALIASES, key=len, reverse=True):
        if _word_in(q, alias):
            best = COMP_ALIASES[alias]
            break
    if best is None:
        return None, []
    if qn_women and best in WOMEN:
        best = WOMEN[best]
    seasons = _index["comps"].get(best, {}).get("seasons", {})
    if not seasons:
        return None, []
    year = re.search(r"\b(20\d\d)(?:\s*[/-]\s*(\d\d))?\b", q)
    short = re.search(r"\b(\d\d)\s*[/-]\s*(\d\d)\b", q)
    pick = None
    if year:
        pick = next((sid for sid, sn in seasons.items() if sn.startswith(year.group(1))), None)
        if pick is None and len(seasons) == 1:
            pick = next(iter(seasons))
    elif short:
        pick = next((sid for sid, sn in seasons.items() if sn.startswith("20" + short.group(1))), None)
    elif len(seasons) == 1:
        pick = next(iter(seasons))
    name = _index["comps"][best]["name"]
    if pick is None:
        return None, [f"{name} {sn}" for sn in seasons.values()]
    return {"id": best, "season_id": pick, "name": f"{name} {seasons[pick]}"}, []


def _players(q: str, comp) -> list[dict]:
    hits: dict[int, int] = {}
    for key, ids in _index["full"].items():
        if len(key) >= 5 and _word_in(q, key):
            for i in ids:
                hits[i] = max(hits.get(i, 0), len(key) + 100)
    for key, ids in _index["last"].items():
        if _word_in(q, key):
            for i in ids:
                hits[i] = max(hits.get(i, 0), len(key))
    if not hits:
        return []
    groups: dict[str, list[int]] = {}
    for pid, score in hits.items():
        groups.setdefault(norm(_index["players"][pid]).split()[-1], []).append(pid)
    out = []
    for last, pids in groups.items():
        # most minutes first (the famous player is the one with the data); keep others as alternatives
        pids.sort(key=lambda p: -_index["minutes"].get(p, 0))
        top = pids[0]
        alt = [f"{_index['players'][p]} (player_id={p})" for p in pids[1:3] if _index["minutes"].get(p, 0) > 0.5 * _index["minutes"][top]]
        out.append({"id": top, "name": _index["players"][top], "alt": alt})
    # drop surname-only hits that are inside a full-name hit already
    names = [p["name"] for p in out]
    return [p for p in out if not any(p["name"] != n and norm(p["name"]).split()[-1] == norm(n).split()[-1] and len(n) > len(p["name"]) for n in names)][:3]


def _teams(q: str) -> list[dict]:
    found = []
    for key, ids in sorted(_index["teams"].items(), key=lambda kv: -len(kv[0])):
        if _word_in(q, key) and not any(key in f["key"] for f in found):
            tid = sorted(ids)[0]
            found.append({"id": tid, "name": _index["team_names"][tid], "key": key})
    return [{"id": f["id"], "name": f["name"]} for f in found][:3]


RANK_WORDS = ("best", "top", "most", "leading", "highest", "who has", "who is the", "leader", "rank")
SIMILAR_WORDS = ("similar", "like", "resembl", "closest", "alternative to", "replace")


def analyze(question: str, conn: sqlite3.Connection | None = None, context: str = "") -> Analysis:
    conn = conn or db.connect()
    if _index.get("built_for") != id(conn):
        _build(conn)
    q = norm(question)
    a = Analysis()
    a.competition, a.competition_ambiguous = _competition(q, "women" in q or "womens" in q)
    a.scope_named = bool(a.competition or a.competition_ambiguous)
    a.teams = _teams(q)
    team_words = {w_ for t in a.teams for w_ in norm(t["name"]).split()}
    a.players = [p for p in _players(q, a.competition) if norm(p["name"]).split()[-1] not in team_words]   # "Real" in Real Madrid is not a player
    if not a.players and re.search(r"\b(he|his|him|she|her|they|their)\b", q) and context:
        a.players = _players(norm(context), a.competition)[:1]
    for name, code in LIVE_LEAGUES.items():
        if _word_in(q, name):
            a.league_code = code
            break
    w = lambda *ws: any(x in q for x in ws)
    comp_args = f"competition_id={a.competition['id']}, season_id={a.competition['season_id']}" if a.competition else None
    if a.players and w(*SIMILAR_WORDS):
        a.intents.append("similar players" + (" within the named competition" if a.competition else " across all competitions"))
        a.tools += ["get_similar_players" if a.competition else "get_plays_like"]
    if (len(a.players) >= 2 or len(a.teams) >= 2) and w("compare", "better than", "difference between", "who is better", "stronger"):
        a.intents.append("a head-to-head comparison")
        a.tools += ["compare_players" if len(a.players) >= 2 else "compare_teams"]
    elif len(a.teams) >= 2 and w("match", "game", "clasico", "derby", "final", "how did", "what happened", "result", "score", " vs ", "versus"):
        a.intents.append("an account of a specific match between two teams")
        a.tools += ["find_matches", "get_match_report"]
    elif len(a.teams) == 1 and w("match", "game", "result", "how did"):
        a.intents.append("matches of one team")
        a.tools += ["find_matches"]
    if w("goalkeeper", "keeper", "goalie", "saves", "goals prevented"):
        a.intents.append("goalkeeper ratings")
        a.tools += ["get_goalkeepers"]
    elif (w(*RANK_WORDS) and not a.players and not (w("team", "teams", "club") and not w("player"))
          and not w("corner", "free kick", "set piece", "counter", "sprint", "physical", "running", "distance")):
        a.intents.append("a ranking of players" + (" in the named competition" if a.competition else ""))
        a.tools += ["get_leaders" if w("xg", "xa", "xt", "assist", "creat", "tackle", "intercept", "recover", "press", "dribbl", "passes", "carries", "shots") else "get_season_players"]
    if a.players and not a.intents and w("how good", "profile", "strength", "weakness", "scout", "stats", "style", "role", "best at", "worst"):
        a.intents.append("a scouting profile of one player")
        a.tools += ["get_player_profile"]
    if w("corner", "free kick", "set piece", "counterattack", "counter attack", "counter-attack", "on the counter"):
        a.intents.append("set pieces or counterattacks")
        a.tools += ["get_team_patterns"]
    if a.teams and w("play style", "playing style", "style of", "how do they play", "tactics of", "similar team", "plays like"):
        a.intents.append("a team's playing style")
        a.tools += ["get_similar_team_styles"]
    if w("standings", "league table", "table", "fixtures", "schedule", "next match", "upcoming", "results this season", "points"):
        a.intents.append("current-season fixtures or standings")
        a.tools += ["get_standings" if w("standings", "table", "points", "position") else "get_fixtures"]
    if w("sprint", "distance covered", "high speed", "running", "pitch control", "physical"):
        a.intents.append("tracking: running load or pitch control")
        a.tools += ["get_tracking_physical"]
    if a.competition and not a.players and w("final", "who won", "champion", "winner", "winners") and not w("goalkeeper", "keeper"):
        a.intents.append("the result of the tournament's decisive match: the final is the latest match in the competition")
        a.tools += ["list_matches (with latest=true)", "get_match_report"]
    if w("what is", "explain", "define", "meaning of", "what does") and not a.players:
        a.intents.append("an explanation of a tactical idea")
        a.tools += ["get_tactical_concept"]
    if not a.tools and (a.players or a.teams or w("find", "show me", "which players", "which teams", "teams that", "players who")):
        a.intents.append("finding players, teams or matches that fit a description")
        a.tools += ["search_football"]
    seen = set()
    a.tools = [t for t in a.tools if not (t in seen or seen.add(t))]
    return a

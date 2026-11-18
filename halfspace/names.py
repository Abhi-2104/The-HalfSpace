"""Names players are known by. StatsBomb lineups carry `player_nickname` for about a third of entries
("Lionel Messi" for "Lionel Andrés Messi Cuccittini"); for the rest we guess a "known as" from the full
name. The `player.display_name` column holds the result; `name` (the full name) is never changed."""
from collections import Counter

PARTICLES = {"de", "da", "do", "dos", "das", "del", "della", "di", "van", "von", "der", "den", "le", "la", "el", "al", "bin", "ben", "ter", "ten"}


def known_as(full: str) -> str:
    """Best-effort 'first name + surname' from a legal name. Up to 2 words: unchanged. 3 words: first + last.
    4+ words: first + the second-to-last word (Hispanic names end with two surnames), keeping a leading
    particle ('Di María', 'van Dijk'). Wrong for some names (e.g. 'Cristiano Ronaldo dos Santos Aveiro');
    those are fixed by the nickname whenever the lineups have one."""
    t = full.split()
    if len(t) <= 2:
        return full
    if len(t) == 3:
        return f"{t[0]} {t[2]}"
    i = len(t) - 2
    while i > 1 and t[i - 1].lower() in PARTICLES:
        i -= 1
    return f"{t[0]} {' '.join(t[i:len(t) - 1])}"


def apply_lineups(conn, lineups: list[dict]) -> None:
    """Set display_name from one match's lineups: the nickname when present, else a guess if none is set yet."""
    for team in lineups:
        for p in team["lineup"]:
            nick = (p.get("player_nickname") or "").strip()
            if nick:
                conn.execute("UPDATE player SET display_name = ? WHERE id = ?", (nick, p["player_id"]))
            else:
                conn.execute("UPDATE player SET display_name = ? WHERE id = ? AND display_name IS NULL",
                             (known_as(p["player_name"]), p["player_id"]))


def display_names(conn, ids) -> dict[int, str]:
    ids = sorted({int(i) for i in ids if i == i and i is not None})
    if not ids:
        return {}
    return {r["id"]: r["display_name"] or r["name"] for r in conn.execute(
        f"SELECT id, name, display_name FROM player WHERE id IN ({','.join(map(str, ids))})")}


def best_nicknames(lineup_files) -> tuple[dict[int, str], dict[int, str]]:
    """From many lineup files: (most common nickname per player, full name per player)."""
    import json
    nicks: dict[int, Counter] = {}
    full: dict[int, str] = {}
    for f in lineup_files:
        for team in json.loads(open(f).read()):
            for p in team["lineup"]:
                full[p["player_id"]] = p["player_name"]
                if (p.get("player_nickname") or "").strip():
                    nicks.setdefault(p["player_id"], Counter())[p["player_nickname"].strip()] += 1
    return {pid: c.most_common(1)[0][0] for pid, c in nicks.items()}, full

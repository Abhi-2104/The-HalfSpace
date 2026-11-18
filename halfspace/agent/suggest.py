"""Follow-up question suggestions, built from which tools answered the question (no LLM, so free and
instant). Plain football wording only: no tool names or ids in what the user sees."""

GENERIC = ["Who are the best players in La Liga 2015/16?", "What does a high press look like?", "Show me an upset from the World Cup 2022."]


def _first(prov, tool):
    return next((p for p in prov if p.tool == tool and isinstance(p.result, dict) and "error" not in p.result), None)


def _name(d: dict | None) -> str | None:
    return (d or {}).get("display_name") or (d or {}).get("name")


def suggest_followups(provenance: list) -> list[str]:
    out: list[str] = []
    if (p := _first(provenance, "get_leaders")):
        pl = p.result.get("players", [])
        if len(pl) >= 2 and _name(pl[0]) and _name(pl[1]):
            out.append(f"How does {_name(pl[0])} compare with {_name(pl[1])}?")
        if _name(pl[0] if pl else None):
            out.append(f"Who plays most like {_name(pl[0])}?")
        out.append("Show the same ranking for a different position.")
    if (p := _first(provenance, "get_player_profile")):
        n = _name(p.result)
        if n:
            out += [f"Who plays most like {n}?", f"Where is {n} weakest compared with other {p.result.get('position_group', 'players')}?"]
    if (p := _first(provenance, "get_plays_like")):
        out.append("Which of these players is best at passing?")
    if (p := _first(provenance, "find_matches")):
        ms = p.result.get("matches", [])
        if ms:
            out.append(f"Give me a report on {ms[0]['home_team']} against {ms[0]['away_team']}.")
    if _first(provenance, "get_match_momentum") or _first(provenance, "get_match_report"):
        out += ["Who created the most danger in that match?", "What were the biggest chances and who took them?"]
    if _first(provenance, "get_goalkeepers"):
        out.append("Which team conceded the fewest big chances?")
    if (p := _first(provenance, "get_team_patterns")):
        other = {"corner": "free kick", "counter": "corner", "free_kick": "counterattack"}.get(p.arguments.get("kind"), "corner")
        out.append(f"Which team is best at the {other} in the same season?")
    if _first(provenance, "get_similar_team_styles"):
        out.append("What kind of players does that style rely on?")
    if _first(provenance, "get_tactical_concept") or _first(provenance, "get_tactical_concepts"):
        out.append("Show me a real match where that happened.")
    if _first(provenance, "get_season_teams") or _first(provenance, "compare_teams"):
        out.append("Which of these teams presses the most?")
    seen, final = set(), []
    for s in out:
        if s not in seen:
            seen.add(s)
            final.append(s)
    return (final or GENERIC)[:3]

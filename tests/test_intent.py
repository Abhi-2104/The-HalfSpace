"""Question understanding: intent, scope, entities and tool choice, checked on the real data (skips without it)."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from halfspace import db
from halfspace.agent import intent


@pytest.fixture(scope="module")
def conn():
    if not db.DEFAULT_DB_PATH.exists() or db.connect().execute("SELECT COUNT(*) FROM event").fetchone()[0] == 0:
        pytest.skip("no data")
    if not (Path(__file__).resolve().parent.parent / "data" / "derived.db").exists():
        pytest.skip("models not built")
    return db.connect()


def A(conn, q, ctx=""):
    return intent.analyze(q, conn, ctx)


def test_named_competition_scopes_similar_players_and_picks_the_scoped_tool(conn):
    a = A(conn, "who played the most like messi in the 2022 world cup?")
    assert a.competition["id"] == 43 and a.competition["season_id"] == 106 and a.scope_named
    assert a.players[0]["id"] == 5503 and a.tools == ["get_similar_players"]
    assert "stay inside it" in a.hint() and "player_id=5503" in a.hint()


def test_no_competition_named_means_the_wider_comparison_is_allowed(conn):
    a = A(conn, "who plays like Messi")
    assert not a.scope_named and a.tools == ["get_plays_like"] and "across all competitions is fine" in a.hint()


def test_season_ambiguity_is_surfaced_not_guessed(conn):
    a = A(conn, "top scorers in la liga")
    assert a.competition is None and a.competition_ambiguous and "Ask which one" in a.hint()
    assert A(conn, "top scorers in La Liga 2015/16").competition["season_id"] == 27
    assert A(conn, "best goalkeeper in euro 2024").competition["id"] == 55
    assert A(conn, "women's euro 2025 top scorer").competition["id"] == 53


def test_two_teams_means_a_match_account_but_compare_means_a_comparison(conn):
    m = A(conn, "Take any el clasico: Barcelona vs Real Madrid 2015/16")
    assert {t["name"] for t in m.teams} == {"Barcelona", "Real Madrid"} and m.tools[:2] == ["find_matches", "get_match_report"]
    assert not m.players                                         # 'Real' in Real Madrid is not a player
    assert A(conn, "compare barcelona and real madrid in la liga 2015/16").tools == ["compare_teams"]
    assert A(conn, "compare messi and neymar in la liga 2015/16").tools == ["compare_players"]


@pytest.mark.parametrize("q,tool", [
    ("which goalkeeper prevented the most goals in la liga 2015/16", "get_goalkeepers"),
    ("which teams are best at corners in la liga 2015/16", "get_team_patterns"),
    ("premier league table", "get_standings"),
    ("premier league fixtures this week", "get_fixtures"),
    ("who has the most sprints", "get_tracking_physical"),
    ("what is a high press?", "get_tactical_concept"),
    ("how good is mbappe at the world cup", "get_player_profile"),
    ("who has the best xg in la liga 2015/16", "get_leaders"),
])
def test_intent_picks_the_right_first_tool(conn, q, tool):
    assert A(conn, q).tools[0] == tool


def test_a_tournament_final_points_at_the_latest_match(conn):
    a = A(conn, "who won the women's world cup 2019 final")
    assert a.competition["id"] == 72 and a.competition["season_id"] == 30 and a.tools[0].startswith("list_matches (with latest=true)")


def test_pronoun_follow_up_uses_the_previous_question(conn):
    a = A(conn, "and his passing?", ctx="tell me about Messi in la liga 2015/16")
    assert a.players and a.players[0]["id"] == 5503


def test_unclear_questions_ask_for_clarification_instead_of_guessing(conn):
    h = A(conn, "tell me something").hint()
    assert "unclear" in h and "clarifying question" in h


def test_hint_failure_never_blocks_an_answer(monkeypatch):
    from halfspace.agent.orchestrator import Agent
    monkeypatch.setattr(intent, "analyze", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    assert Agent._intent_hint("who is best?", []) == []

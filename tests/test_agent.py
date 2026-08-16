"""
Agent orchestration tests. Only the LLM is stubbed (StubLLMClient) - the tool
registry executes for real against the live dataset, same as test_api.py.
This tests the orchestrator's OWN guarantees (provenance recorded, caveats
never silently dropped, loop budget enforced) - not an LLM's judgment, which
isn't wired in yet (see README for why that's deferred).
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from halfspace import db
from halfspace.agent.llm import LLMResponse, StubLLMClient, ToolCall
from halfspace.agent.orchestrator import Agent

LALIGA_1516 = {"competition_id": 11, "season_id": 27}
MESSI_ID = 5503


@pytest.fixture
def ready_db():
    if not db.DEFAULT_DB_PATH.exists():
        pytest.skip("no data/halfspace.db")
    if db.connect().execute("SELECT COUNT(*) n FROM event").fetchone()["n"] == 0:
        pytest.skip("data/halfspace.db has no ingested events")


def test_single_tool_call_records_provenance(ready_db):
    script = [
        LLMResponse(tool_calls=[ToolCall("get_season_players", LALIGA_1516)]),
        LLMResponse(content="Luis Suárez led goals/90 in La Liga 2015/16."),
    ]
    agent = Agent(StubLLMClient(script))
    answer = agent.run("Who topped goals per 90 in La Liga 2015/16?")

    assert "Suárez" in answer.text
    assert len(answer.provenance) == 1
    assert answer.provenance[0].tool == "get_season_players"
    assert answer.provenance[0].result["players"], "tool must have executed against the real DB, not a mock"
    assert not answer.unresolved_caveats


def test_role_mismatch_caveat_flagged_if_llm_ignores_it(ready_db):
    """Real integration: pull a real goalkeeper id from the live DB, compare
    against Messi (a winger) - the tool WILL return role_mismatch+caveat.
    Script the stub to give a final answer that ignores the caveat, and
    assert the orchestrator catches that itself rather than trusting the LLM."""
    conn = db.connect()
    gk = conn.execute(
        """SELECT pmm.player_id, SUM(pmm.minutes) AS total
           FROM player_match_minutes pmm
           JOIN match m ON m.id = pmm.match_id
           WHERE pmm.position = 'Goalkeeper' AND m.competition_id = ? AND m.season_id = ?
           GROUP BY pmm.player_id HAVING total >= 900 LIMIT 1""",
        (LALIGA_1516["competition_id"], LALIGA_1516["season_id"]),
    ).fetchone()
    if not gk:
        pytest.skip("no goalkeeper meets the minutes floor in La Liga 2015/16 specifically")

    script = [
        LLMResponse(tool_calls=[ToolCall("compare_players", {
            "player_a": MESSI_ID, "player_b": gk["player_id"], **LALIGA_1516,
        })]),
        LLMResponse(content="Messi had more goals and progressive passes."),  # deliberately ignores the caveat
    ]
    agent = Agent(StubLLMClient(script))
    answer = agent.run(f"Compare player {MESSI_ID} and player {gk['player_id']}")

    result = answer.provenance[0].result
    if "error" in result:
        pytest.skip("comparison target doesn't meet the minutes floor - not the case under test")
    assert result["role_mismatch"] is True
    assert result["caveat"] is not None
    assert answer.unresolved_caveats, "orchestrator must catch a caveat the LLM's final answer ignored"
    assert result["caveat"] in answer.unresolved_caveats


def test_error_from_bad_player_id_is_not_hidden(ready_db):
    """The tool call fails (no such player). Script a final answer that doesn't
    restate the error verbatim - the orchestrator must flag it as unresolved
    rather than let a vague "I couldn't find that player" paper over exactly
    what went wrong."""
    script = [
        LLMResponse(tool_calls=[ToolCall("get_similar_players", {**LALIGA_1516, "player_id": 999999999})]),
        LLMResponse(content="I couldn't find that player."),
    ]
    agent = Agent(StubLLMClient(script))
    answer = agent.run("Find players similar to player 999999999")

    assert "error" in answer.provenance[0].result
    assert answer.unresolved_caveats, "the specific error text wasn't restated in the final answer - orchestrator must catch that, not let it vanish"
    assert answer.provenance[0].result["error"] in answer.unresolved_caveats


def test_multi_tool_chain_preserves_order(ready_db):
    script = [
        LLMResponse(tool_calls=[ToolCall("list_competitions", {})]),
        LLMResponse(tool_calls=[ToolCall("get_season_teams", LALIGA_1516)]),
        LLMResponse(content="La Liga 2015/16 has real team data."),
    ]
    agent = Agent(StubLLMClient(script))
    answer = agent.run("What competitions exist and what are La Liga 2015/16's team stats?")

    assert [p.tool for p in answer.provenance] == ["list_competitions", "get_season_teams"]
    assert answer.provenance[1].result["teams"]


def test_loop_budget_stops_instead_of_hanging(ready_db):
    """A script that never returns final content - the orchestrator must give
    up after MAX_TOOL_ROUNDS, not loop forever waiting for an LLM that never answers."""
    script = [LLMResponse(tool_calls=[ToolCall("list_competitions", {})])] * 10
    agent = Agent(StubLLMClient(script))
    answer = agent.run("infinite loop test")

    assert "couldn't reach a final answer" in answer.text
    assert len(answer.provenance) == 6  # MAX_TOOL_ROUNDS


if __name__ == "__main__":
    import subprocess
    subprocess.run([sys.executable, "-m", "pytest", __file__, "-v"])

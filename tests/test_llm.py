"""OpenAICompatClient wire-format tests - HTTP is faked, so no API quota is used."""
import json
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from halfspace.agent import llm
from halfspace.agent.llm import OpenAICompatClient, ToolCall
from halfspace.agent.orchestrator import Agent


def _fake_post(replies, sent):
    def post(url, json=None, **kw):
        sent.append(json)
        return httpx.Response(200, json={"choices": [{"message": replies.pop(0)}]},
                              request=httpx.Request("POST", url))
    return post


def test_agent_round_trip_over_wire_format(monkeypatch):
    sent = []
    replies = [
        {"content": None, "tool_calls": [{"id": "x", "type": "function", "function": {
            "name": "list_competitions", "arguments": "{}"}}]},
        {"content": "Three competitions.", "tool_calls": None},
    ]
    monkeypatch.setattr(llm.httpx, "post", _fake_post(replies, sent))
    answer = Agent(OpenAICompatClient("http://x/v1", "k", "m")).run("what's available?")

    assert answer.text == "Three competitions." and answer.provenance[0].tool == "list_competitions"
    # 2nd request must carry the assistant tool_call and a tool reply linked by the same id
    asst = next(m for m in sent[1]["messages"] if m["role"] == "assistant")
    tool = next(m for m in sent[1]["messages"] if m["role"] == "tool")
    assert tool["tool_call_id"] == asst["tool_calls"][0]["id"]
    assert isinstance(tool["content"], str) and json.loads(tool["content"])
    assert sent[0]["tools"][0]["type"] == "function"


def test_parallel_tool_calls_get_distinct_ids():
    msgs = [{"role": "assistant", "tool_calls": [ToolCall("a", {}).__dict__, ToolCall("b", {"n": 1}).__dict__]},
            {"role": "tool", "name": "a", "content": {}}, {"role": "tool", "name": "b", "content": {}}]
    wire = OpenAICompatClient._to_wire(msgs)
    ids = [c["id"] for c in wire[0]["tool_calls"]]
    assert len(set(ids)) == 2 and [m["tool_call_id"] for m in wire[1:]] == ids


def test_tool_lists_are_capped_with_truncation_note():
    from halfspace.agent.tools import LIST_CAP, _wrap
    out = _wrap(lambda: {"rows": list(range(LIST_CAP + 5)), "n": 1})()
    assert len(out["rows"]) == LIST_CAP and "of 30" in out["truncated"]["rows"]
    assert "truncated" not in _wrap(lambda: {"rows": [1, 2]})()

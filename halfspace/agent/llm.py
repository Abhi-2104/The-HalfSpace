"""
LLM-agnostic interface. The orchestrator only depends on this Protocol, not
on Anthropic/Ollama/anything specific - which model powers the agent is a
cost/quality decision deferred until the tool layer (this module's actual
job) is proven correct on its own. See README for the tradeoff.
"""
import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

import httpx

from halfspace.agent.tools import ToolSpec


@dataclass
class ToolCall:
    name: str
    arguments: dict


@dataclass
class LLMResponse:
    """Either tool_calls is non-empty (the loop must execute them and continue)
    or content is set (this is the final answer) - never meaningfully both."""
    tool_calls: list[ToolCall] = field(default_factory=list)
    content: str | None = None


class LLMClient(Protocol):
    def chat(self, messages: list[dict], tools: list[ToolSpec]) -> LLMResponse: ...


class OpenAICompatClient:
    """Chat-completions client for any OpenAI-format endpoint (Groq now, Gemini's
    compat endpoint later - only base_url/key/model differ). Translates the
    orchestrator's internal message shape to the wire format and back.
    ponytail: no retry/backoff - 429s raise, a fallback wrapper can catch them later."""

    def __init__(self, base_url: str, api_key: str, model: str, timeout: float = 60.0):
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.api_key, self.model, self.timeout = api_key, model, timeout

    @staticmethod
    def _to_wire(messages: list[dict]) -> list[dict]:
        out, pending = [], []  # pending: ids of the last assistant turn's calls, in order
        for m in messages:
            if m["role"] == "assistant" and m.get("tool_calls"):
                pending = [f"call_{len(out)}_{i}" for i in range(len(m["tool_calls"]))]
                out.append({"role": "assistant", "content": None, "tool_calls": [
                    {"id": cid, "type": "function",
                     "function": {"name": tc["name"], "arguments": json.dumps(tc["arguments"])}}
                    for cid, tc in zip(pending, m["tool_calls"])]})
            elif m["role"] == "tool":
                out.append({"role": "tool", "tool_call_id": pending.pop(0),
                            "content": json.dumps(m["content"], default=str)})
            else:
                out.append(m)
        return out

    def chat(self, messages: list[dict], tools: list[ToolSpec]) -> LLMResponse:
        body = {"model": self.model, "messages": self._to_wire(messages), "tools": [
            {"type": "function", "function": {"name": t.name, "description": t.description,
                                              "parameters": t.parameters}} for t in tools]}
        r = httpx.post(self.url, json=body, timeout=self.timeout,
                       headers={"Authorization": f"Bearer {self.api_key}"})
        r.raise_for_status()
        msg = r.json()["choices"][0]["message"]
        calls = [ToolCall(tc["function"]["name"], json.loads(tc["function"]["arguments"] or "{}"))
                 for tc in msg.get("tool_calls") or []]
        return LLMResponse(tool_calls=calls, content=msg.get("content"))


def load_dotenv(path: Path = Path(__file__).resolve().parents[2] / ".env") -> None:
    """Tiny KEY=VALUE loader; real env vars win. ponytail: no quotes/export handling."""
    if path.exists():
        for line in path.read_text().splitlines():
            k, sep, v = line.partition("=")
            if sep and not line.lstrip().startswith("#"):
                os.environ.setdefault(k.strip(), v.strip())


def groq_client() -> OpenAICompatClient:
    load_dotenv()
    return OpenAICompatClient("https://api.groq.com/openai/v1", os.environ["GROQ_API_KEY"],
                              os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b"))


class StubLLMClient:
    """Deterministic, scripted client - no real model. Lets the orchestration
    loop (tool execution, provenance tracking, caveat propagation) be tested
    without committing to Ollama vs Claude API first. Give it a script: a list
    of LLMResponse to return in order, one per .chat() call."""

    def __init__(self, script: list[LLMResponse]):
        self._script = list(script)
        self.calls = 0

    def chat(self, messages: list[dict], tools: list[ToolSpec]) -> LLMResponse:
        if self.calls >= len(self._script):
            raise RuntimeError("StubLLMClient script exhausted - agent looped more than expected")
        response = self._script[self.calls]
        self.calls += 1
        return response

"""
LLM-agnostic interface. The orchestrator only depends on this Protocol, not
on Anthropic/Ollama/anything specific - which model powers the agent is a
cost/quality decision deferred until the tool layer (this module's actual
job) is proven correct on its own. See README for the tradeoff.
"""
import json
import os
import re
import time
from contextvars import ContextVar
from dataclasses import dataclass, field
from functools import lru_cache
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
    Rate limits raise httpx.HTTPStatusError; FallbackClient handles them."""

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


_waits_left: ContextVar[int] = ContextVar("waits_left", default=1)
WAIT_CAP = 20.0  # never sleep longer than this for a rate limit; beyond it the caller gets the 429


def reset_waits(n: int = 1) -> None:
    """Called at the start of each agent request: it may wait out at most n rate limits in total."""
    _waits_left.set(n)


def retry_after(resp: httpx.Response, default: float = 10.0) -> float:
    """Seconds until the limit clears: retry-after header, else Groq's 'Please try again in 7.2s / 850ms / 1m3s'."""
    try:
        return float(resp.headers["retry-after"])
    except (KeyError, ValueError):
        pass
    m = re.search(r"try again in ((?:\d+(?:\.\d+)?(?:ms|m|s))+)", resp.text or "")
    if m:
        unit = {"ms": 0.001, "s": 1, "m": 60}
        return sum(float(n) * unit[u] for n, u in re.findall(r"(\d+(?:\.\d+)?)(ms|m|s)", m.group(1)))
    return default


class FallbackClient:
    """Tries clients in order. On 429/5xx it parks that client for the REAL wait (retry-after or Groq's
    'try again in Xs', default 10s) and moves on. Groq limits are per model, so a chain multiplies quota.
    When every model is parked and the soonest is <= WAIT_CAP seconds away, it sleeps once per agent
    request (see reset_waits) and retries; otherwise it re-raises the last 429 and the API returns 429."""

    def __init__(self, clients: list, default_cooldown: float = 10.0):
        self.clients, self.default_cooldown = clients, default_cooldown
        self._until: dict[int, float] = {}
        self._last: httpx.HTTPStatusError | None = None

    def _try_all(self, messages, tools):
        for i, c in enumerate(self.clients):
            if self._until.get(i, 0) > time.monotonic():
                continue
            try:
                return c.chat(messages, tools)
            except httpx.HTTPStatusError as e:
                if e.response.status_code != 429 and e.response.status_code < 500:
                    raise
                self._until[i] = time.monotonic() + retry_after(e.response, self.default_cooldown)
                self._last = e
        return None

    def chat(self, messages: list[dict], tools: list[ToolSpec]) -> LLMResponse:
        out = self._try_all(messages, tools)
        if out is not None:
            return out
        soonest = min(self._until.values(), default=0) - time.monotonic()
        if _waits_left.get() > 0 and 0 < soonest <= WAIT_CAP:
            _waits_left.set(_waits_left.get() - 1)
            time.sleep(soonest + 0.5)
            out = self._try_all(messages, tools)
            if out is not None:
                return out
        raise self._last


DEFAULT_GROQ_MODELS = "openai/gpt-oss-120b,qwen/qwen3.8-27b,openai/gpt-oss-20b"


@lru_cache(maxsize=1)  # one shared instance so cooldowns persist across requests
def groq_client() -> FallbackClient:
    load_dotenv()
    key = os.environ["GROQ_API_KEY"]
    models = os.environ.get("GROQ_MODELS", DEFAULT_GROQ_MODELS).split(",")
    return FallbackClient([OpenAICompatClient("https://api.groq.com/openai/v1", key, m.strip())
                           for m in models])


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

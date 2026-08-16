"""
LLM-agnostic interface. The orchestrator only depends on this Protocol, not
on Anthropic/Ollama/anything specific - which model powers the agent is a
cost/quality decision deferred until the tool layer (this module's actual
job) is proven correct on its own. See README for the tradeoff.
"""
from dataclasses import dataclass, field
from typing import Protocol

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

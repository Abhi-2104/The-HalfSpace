"""
The agent loop: question -> tool calls -> evidence -> answer. Enforces two
invariants mechanically, not just via prompt wording (a prompt is a request,
not a guarantee):
  1. Every tool call is recorded in provenance - the caller can always see
     exactly which endpoint backed which claim (project spec: explainability).
  2. If a tool result carries an "error" or "caveat", that field is always
     surfaced back to the LLM verbatim and flagged in the final AgentAnswer -
     the orchestrator cannot silently drop a caveat even if the LLM's own
     final text forgets to mention it.
"""
from dataclasses import dataclass, field

import json

from halfspace.agent.llm import LLMClient, reset_waits
from halfspace.agent.suggest import suggest_followups
from halfspace.agent.tools import TOOLS, TOOLS_BY_NAME

MAX_TOOL_ROUNDS = 8  # a stuck loop must fail loudly, not spin forever; the last round asks for an answer, no tools

SYSTEM_PROMPT = """You are the Halfspace analyst. Answer only from tool results - \
never state a stat, comparison, or tactical claim you haven't retrieved through a tool call. \
If a tool result includes a "caveat" or "error", you must mention it in your answer, not silently drop it. \
If the available tools/data cannot answer the question reliably, say so explicitly rather than guessing. \
If a comparison is flagged role_mismatch or low_sample, say why that weakens the comparison instead of \
just reporting the numbers. \
Earlier conversation turns are context for resolving references like "him" or "that season"; \
call tools again for any new figure instead of reusing numbers from earlier answers. \
When something cannot be found, say why in plain terms (for example, too few minutes in the data) and still give the closest or most likely alternatives you do have; if a lookup fails, try a different approach before giving up, and never conclude that a player did not play, or that a fact is false, just because a lookup had no data. Refer to players by their display_name (the name they are known by), not the full legal name. Never mention code, function names, module paths, tool names, endpoint paths, field names or metric codes such as goals_p90; say "goals per 90 minutes" instead. Never quote error messages. Answer in plain football language. \
Use plain markdown: tables only for numbers, never <br> or HTML inside tables; use bullet lists for text."""


HISTORY_TURNS, HISTORY_CHARS = 6, 900  # earlier conversation sent to the model: last 6 messages, each cut to 900 chars (about 1.5K tokens)
LATEST_BUDGET, OLDER_BUDGET = 3000, 600  # chars of tool result the LLM sees; ~1K and ~200 tokens
KEEP_FULL = ("caveat", "error")  # never truncated: the answer must be able to restate them exactly


def shrink(obj, budget: int):
    """Compact a tool result for the LLM: round floats, drop empty fields, cut long strings, and halve
    list lengths until it fits `budget` chars. The full result stays in provenance."""
    def walk(o, cap, key=None):
        if isinstance(o, float):
            return round(o, 3)
        if isinstance(o, dict):
            return {k: walk(v, cap, k) for k, v in o.items() if v not in (None, "", [], {})}
        if isinstance(o, list):
            return [walk(v, cap) for v in o[:cap]]
        if isinstance(o, str) and key not in KEEP_FULL:
            return o[:160]
        return o
    full = walk(obj, 10**9)
    out = full
    for cap in (10**9, 12, 8, 5, 3, 2):
        out = walk(obj, cap)
        if len(json.dumps(out, default=str)) <= budget:
            return {**out, "trimmed": "lists shortened to fit"} if out != full and isinstance(out, dict) else out
    return {"summary": json.dumps(out, default=str)[:budget], "trimmed": "cut to fit"}


def compact_for_llm(messages: list[dict]) -> list[dict]:
    """Copy of the history for the LLM: tool results from earlier rounds shrink hard, the latest round less."""
    last_call = max((i for i, m in enumerate(messages) if m["role"] == "assistant" and m.get("tool_calls")), default=-1)
    out = []
    for i, m in enumerate(messages):
        if m["role"] == "tool" and isinstance(m["content"], dict):
            m = {**m, "content": shrink(m["content"], LATEST_BUDGET if i > last_call else OLDER_BUDGET)}
        out.append(m)
    return out


def trim_history(history: list[dict] | None) -> list[dict]:
    """Keep the conversation light for the free-tier token limits: only the last few messages, each shortened
    (answers lead with the key facts, so the start is what matters for resolving 'him' or 'that season')."""
    out = []
    for m in (history or [])[-HISTORY_TURNS:]:
        text = m["content"]
        out.append({"role": m["role"], "content": text if len(text) <= HISTORY_CHARS else text[:HISTORY_CHARS].rstrip() + " ..."})
    return out


@dataclass
class ToolExecution:
    tool: str
    arguments: dict
    result: dict


@dataclass
class AgentAnswer:
    text: str
    provenance: list[ToolExecution] = field(default_factory=list)
    unresolved_caveats: list[str] = field(default_factory=list)
    suggestions: list[str] = field(default_factory=list)  # follow-up questions, built from the tools used


class Agent:
    def __init__(self, llm: LLMClient, tools: list = None):
        self.llm = llm
        self.tools = tools if tools is not None else TOOLS

    def run(self, question: str, history: list[dict] | None = None) -> AgentAnswer:
        """history: prior {role: user|assistant, content} text turns only (no tool
        traffic). Caveat tracking is per-run: it covers tool results from THIS question."""
        messages = [{"role": "system", "content": SYSTEM_PROMPT}, *trim_history(history),
                    {"role": "user", "content": question}]
        provenance: list[ToolExecution] = []
        caveats: list[str] = []
        reset_waits(1)  # at most one rate-limit wait for this whole question

        for round_no in range(MAX_TOOL_ROUNDS):
            last = round_no == MAX_TOOL_ROUNDS - 1
            view = compact_for_llm(messages)
            if last:  # budget spent: ask for the best answer from what was retrieved, say what is missing
                view.append({"role": "user", "content": "Tool budget used up. Answer now from the tool results above only, "
                                                        "and state clearly what you could not check."})
            response = self.llm.chat(view, [] if last else self.tools)

            if not response.tool_calls:
                text = response.content or ""
                missing = [c for c in caveats if c not in text]
                return AgentAnswer(text=text, provenance=provenance, unresolved_caveats=missing,
                                   suggestions=suggest_followups(provenance))

            if last:
                break  # still asking for tools with none allowed: fail loudly below
            messages.append({"role": "assistant", "tool_calls": [tc.__dict__ for tc in response.tool_calls]})
            for call in response.tool_calls:
                spec = TOOLS_BY_NAME.get(call.name)
                if spec is None:
                    result = {"error": f"no such tool '{call.name}'"}
                else:
                    # models sometimes send stray keys (even an empty-name one) to tools that take none: drop what the
                    # tool doesn't declare, rather than failing the call with a TypeError the user would see
                    declared = spec.parameters.get("properties", {})
                    call.arguments = {k: v for k, v in call.arguments.items() if k in declared}
                    result = spec.handler(**call.arguments)

                for field_name in ("caveat", "error"):
                    val = result.get(field_name) if isinstance(result, dict) else None
                    if val:
                        caveats.append(str(val))

                provenance.append(ToolExecution(tool=call.name, arguments=call.arguments, result=result))
                messages.append({"role": "tool", "name": call.name, "content": result})

        return AgentAnswer(
            text="I couldn't reach a final answer within the tool-call budget - stopping rather than guessing.",
            provenance=provenance, unresolved_caveats=caveats,
        )

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

from halfspace.agent.llm import LLMClient
from halfspace.agent.tools import TOOLS, TOOLS_BY_NAME

MAX_TOOL_ROUNDS = 6  # a stuck loop must fail loudly, not spin forever

SYSTEM_PROMPT = """You are the HalfSpace analyst. Answer only from tool results - \
never state a stat, comparison, or tactical claim you haven't retrieved through a tool call. \
If a tool result includes a "caveat" or "error", you must mention it in your answer, not silently drop it. \
If the available tools/data cannot answer the question reliably, say so explicitly rather than guessing. \
If a comparison is flagged role_mismatch or low_sample, say why that weakens the comparison instead of \
just reporting the numbers."""


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


class Agent:
    def __init__(self, llm: LLMClient, tools: list = None):
        self.llm = llm
        self.tools = tools if tools is not None else TOOLS

    def run(self, question: str) -> AgentAnswer:
        messages = [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": question}]
        provenance: list[ToolExecution] = []
        caveats: list[str] = []

        for _ in range(MAX_TOOL_ROUNDS):
            response = self.llm.chat(messages, self.tools)

            if not response.tool_calls:
                text = response.content or ""
                missing = [c for c in caveats if c not in text]
                return AgentAnswer(text=text, provenance=provenance, unresolved_caveats=missing)

            messages.append({"role": "assistant", "tool_calls": [tc.__dict__ for tc in response.tool_calls]})
            for call in response.tool_calls:
                spec = TOOLS_BY_NAME.get(call.name)
                if spec is None:
                    result = {"error": f"no such tool '{call.name}'"}
                else:
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

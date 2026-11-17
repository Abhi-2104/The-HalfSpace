"""CLI: ask the agent a question via Groq. Usage: ask_agent.py "who topped goals/90 in La Liga 2015/16?" """
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from halfspace.agent.llm import groq_client
from halfspace.agent.orchestrator import Agent

a = Agent(groq_client()).run(" ".join(sys.argv[1:]))
print(a.text)
print("\ntools:", [(p.tool, p.arguments) for p in a.provenance])
print("unresolved caveats:", a.unresolved_caveats)

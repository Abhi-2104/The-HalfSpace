#!/usr/bin/env python3
"""Run the agent on tests/agent_eval.json against the REAL model (uses free-tier quota; ~10 questions).
Checks: it called an expected tool, the answer contains an expected fact, and no tool caveat was dropped.
Usage: python3 scripts/eval_agent.py [question_id ...]   -> prints a table, writes data/eval/last_run.json"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from halfspace.agent.llm import groq_client
from halfspace.agent.orchestrator import Agent

ROOT = Path(__file__).resolve().parent.parent
cases = json.loads((ROOT / "tests" / "agent_eval.json").read_text())
wanted = set(sys.argv[1:])
agent, results = Agent(groq_client()), []
for c in cases:
    if wanted and c["id"] not in wanted:
        continue
    t = time.time()
    try:
        a = agent.run(c["q"])
        used = [p.tool for p in a.provenance]
        tool_ok = not c["tools_any"] or any(t_ in used for t_ in c["tools_any"])
        fact_ok = any(s.lower() in a.text.lower() for s in c["answer_has_any"])
        r = {"id": c["id"], "tool_ok": tool_ok, "fact_ok": fact_ok, "caveats_dropped": a.unresolved_caveats, "tools": used,
             "seconds": round(time.time() - t, 1), "answer": a.text[:600]}
    except Exception as e:
        if "429" in str(e):  # every model in the chain is rate-limited: stop, rerun the rest later by id
            print(f"RATE LIMITED at '{c['id']}': stopping. Rerun later with: eval_agent.py " +
                  " ".join(x["id"] for x in cases[cases.index(c):]))
            break
        r = {"id": c["id"], "error": f"{type(e).__name__}: {e}", "tool_ok": False, "fact_ok": False, "tools": [], "caveats_dropped": []}
    results.append(r)
    print(f"{'PASS' if r['tool_ok'] and r['fact_ok'] and not r['caveats_dropped'] else 'FAIL'}  {r['id']:<18} tools={r['tools']} {r.get('error', '')}")
    time.sleep(3)  # stay under the free-tier per-minute limit
passed = sum(r["tool_ok"] and r["fact_ok"] and not r["caveats_dropped"] for r in results)
print(f"\n{passed}/{len(results)} passed ({len(cases) - len(results)} not run)")
(ROOT / "data" / "eval").mkdir(parents=True, exist_ok=True)
(ROOT / "data" / "eval" / "last_run.json").write_text(json.dumps(results, indent=2, ensure_ascii=False))

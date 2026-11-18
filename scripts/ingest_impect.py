#!/usr/bin/env python3
"""Ingest Impect Open Data (Bundesliga 2023/24) into data/restricted.db. Needs HALFSPACE_ACCEPT_IMPECT_TERMS=yes
(see halfspace/ingest/impect.py for why). Usage: HALFSPACE_ACCEPT_IMPECT_TERMS=yes python3 scripts/ingest_impect.py [limit]"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from halfspace.agent.llm import load_dotenv
from halfspace.ingest import impect

load_dotenv()
print(impect.ingest(int(sys.argv[1]) if len(sys.argv) > 1 else None))

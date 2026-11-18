#!/usr/bin/env python3
"""Refresh fixtures, results and standings. Uses football-data.org when FOOTBALL_DATA_KEY is set (free key),
and always refreshes openfootball (no key) too. Usage: python3 scripts/refresh_fixtures.py"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from halfspace.agent.llm import load_dotenv
from halfspace.ingest import fixtures

load_dotenv()
print("openfootball:", fixtures.refresh_openfootball())
if os.environ.get("FOOTBALL_DATA_KEY"):
    print("football-data.org:", fixtures.refresh_football_data())
else:
    print("football-data.org: skipped (no FOOTBALL_DATA_KEY)")

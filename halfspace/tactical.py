"""
Tactical ontology loader. Concepts live in tactical_concepts.json as data,
not a DB table - ~16 concepts is small enough that a table would be
premature complexity (see project data-model decisions in the plan).
"""
import json
from pathlib import Path

CONCEPTS_PATH = Path(__file__).resolve().parent / "tactical_concepts.json"


def load_concepts() -> list[dict]:
    data = json.loads(CONCEPTS_PATH.read_text())
    return data["concepts"]


def get_concept(slug: str) -> dict | None:
    return next((c for c in load_concepts() if c["slug"] == slug), None)

# The HalfSpace

Football intelligence explorer — a research/portfolio project over real open football
data (StatsBomb event data, SkillCorner/IDSSE tracking), built as a layered
raw → canonical → derived → API pipeline, not a demo dashboard over fake numbers.

## Status

Vertical slice proven: one real match (WC2022 Final), fetched from StatsBomb Open
Data, ingested into a canonical SQLite schema, served through a FastAPI endpoint,
verified against the real known result (3-3 after extra time, shootout excluded).

Data domains validated so far (see project notes for full detail):
- **Match intelligence** — shot map, goal timeline, passing.
- **Tactical intelligence** — PPDA press-intensity, sane on real WC2022 data
  (Spain/Germany rank as top pressers, Morocco/Qatar/Costa Rica as deep blocks).
- **Player intelligence** — full-season (380-match) per-90 profiling + role-aware
  similarity, validated against real 2015/16 La Liga facts (Suárez's Pichichi,
  Messi↔Neymar as the top similarity match).
- **Sequence search** — heuristic counterattack detector, correctly labeled
  medium-confidence, not a trained classifier.
- **Spatial/tracking** — team compactness from real SkillCorner broadcast tracking.

## Why SQLite, not Postgres, right now

# ponytail: local Postgres exists but needs interactive sudo auth this environment
# can't provide non-interactively. SQLite (stdlib, zero setup) unblocks the vertical
# slice today. Schema is plain SQL, not ORM-coupled - porting to Postgres+pgvector
# later (for real similarity search at scale, concurrent access) is a schema port,
# not a rewrite. Upgrade when: similarity search needs pgvector, or multi-writer
# access matters.

## Layout

```
halfspace/
  db.py            canonical schema (SQLite)
  features.py      shared feature logic (period-scoping, PPDA, progressive passes)
  ingest/
    statsbomb.py   fetch + load StatsBomb open-data matches
  api.py           FastAPI surface (same tools the agent layer will call later)
scripts/
  ingest_match.py  CLI: ingest one match by id
tests/
  test_pipeline.py  smoke test against a real fixture match (WC2022 Final)
  fixtures/         small, real, committed StatsBomb JSON for one match (no network needed for tests)
```

Raw data itself is **not** committed (reproducible from source per-match/competition,
see `data/.gitignore`) — the fixture files are the one deliberate exception, kept
small so tests run offline.

## Run it

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python3 -m pytest tests/ -v
.venv/bin/python3 scripts/ingest_match.py 3869685 43 106   # WC2022 Final
.venv/bin/uvicorn halfspace.api:app --reload
# then: curl localhost:8000/matches/3869685/profile
```

## Known gotchas already found and handled

- StatsBomb events include the penalty shootout as `Shot` events at `period=5` —
  anything reporting "the match" must scope to periods 1-4 or shootout goals get
  double-counted as regulation goals. Handled once in `features.match_events`.
- Naive "progressive pass" (>=25% closer to goal) trivially rewards goalkeeper
  long punts. `features.player_progressive_passes` excludes GKs by default.
- SkillCorner tracking files are Git-LFS — `raw.githubusercontent.com` silently
  returns a pointer file, not data. Needs `media.githubusercontent.com/media/...`.
  (Not yet wired into an ingestion module — noted here so it isn't rediscovered.)

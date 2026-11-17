# The Halfspace

*by **Abhijith Varma***

**Football analysis you can trace back to the source.** The Halfspace turns real open football data into match stories, player and team profiles, tactical explainers and an AI analyst, and every number links back to the data that produced it.

<p align="center">
  <img src="docs/screenshots/home-light.png" width="49%" alt="The Halfspace home page in the light theme: an isometric pitch where every shot of the 2022 World Cup final stands up as a column">
  <img src="docs/screenshots/home-dark.png" width="49%" alt="The same home page in the dark theme">
</p>

![Python 3.10+](https://img.shields.io/badge/python-3.10%2B-3776ab?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/API-FastAPI-009688?logo=fastapi&logoColor=white)
![React + Vite](https://img.shields.io/badge/UI-React%20%2B%20Vite-61dafb?logo=react&logoColor=black)
![Tests](https://img.shields.io/badge/tests-43%20passing-2ea44f)

## What you can do with it

- **See what made a chance.** Click any shot in a match and see where every visible player was standing the instant it was taken, from real StatsBomb 360 freeze-frames. No paid tracking feed needed. A 3D view stands every shot up as a column, taller for a better chance.
- **Get walked through a match.** The home page is a scroll story: the pitch tilts from a flat map to an isometric view, the columns rise, and the camera zooms in on a real shot. Match pages have a plain-language walkthrough of every goal and big chance.
- **Explore players and teams.** Per-90 profiles, role-aware "players like this one", head-to-head comparisons, and pressing intensity (PPDA). The comparison flags itself when it isn't apples to apples, for example a striker against a goalkeeper.
- **Learn the tactics.** 19 tactical concepts, each tagged with how much the data can actually support it, from "educational" to "unsupported".
- **Ask the analyst.** An AI agent answers questions by calling the same query layer the API uses, and shows exactly which calls backed its answer.
- **Switch depth.** A Beginner/Analyst toggle changes every metric explainer from plain English to method notes. Jargon is always one tap from a real explanation.

<p align="center">
  <img src="docs/screenshots/story-columns.png" width="49%" alt="Scroll story, step two: the shots of the 2022 final stand up as columns, blue for Argentina and orange for France">
  <img src="docs/screenshots/story-zoom.png" width="49%" alt="Scroll story, final step: zoomed in on a goal, with every visible player from the 360 freeze-frame standing on the pitch, and the shot's distance and angle">
</p>

![Match page in the dark theme: the 3D shot map on the left and, on the right, the freeze-frame for the clicked shot](docs/screenshots/match-3d.png)

<p align="center">
  <img src="docs/screenshots/mobile-home.png" width="30%" alt="The home page on a phone">
  <img src="docs/screenshots/mobile-story.png" width="30%" alt="The scroll story on a phone">
</p>

## The interface

- **One pitch, one number.** The isometric pitch is hand-written SVG, not WebGL. A single `progress` value (0 to 1) drives a camera (top-down, isometric, zoomed on the penalty area), and each frame is written straight to the DOM, so scrolling never re-renders React.
- **Smooth scroll.** [Lenis](https://github.com/darkroomengineering/lenis) runs from Motion's own frame loop, so scroll-linked animation stays in step with it. With a reduced-motion setting you get native scrolling and the intro animation is skipped.
- **Light and dark.** One set of design tokens with two sets of values, a toggle in the nav, and no flash on load. Blue and orange mark the two teams in every chart, which stays readable for colour-blind users.
- **Phones.** Every page fits a 390px screen, and the Beginner/Analyst switch moves into the mobile menu.

## The data

Everything is real, open and reproducible. Nothing is mocked or generated.

| Source | Coverage | Kind |
|---|---|---|
| StatsBomb Open Data | World Cup 2022 (64), La Liga 2015/16 (380), Euro 2024 (51), Copa América 2024 (32), Women's Euro 2025 (31) | Event data, **558 matches / about 1.9M events** |
| StatsBomb 360 | World Cup 2022, Euro 2024, Women's Euro 2025 (146 matches) | About 459k freeze-frames of player positions |
| SkillCorner Open Data | A-League 2024/25 (10 matches) | Broadcast tracking, modeled and extrapolated |
| IDSSE | Bundesliga 2022/23, 1. and 2. division (7 matches) | Optical tracking at 25 fps |

Each match carries a coverage record (events, 360, tracking), and the UI shows it as a three-tick strip on every card. The app never implies richer data than a match actually has.

## How it works

![The Halfspace architecture: open data is fetched once into a raw cache, ingested into a canonical SQLite schema, turned into features, and served by FastAPI to the React UI and by a shared query layer to the agent](docs/architecture.svg)

Every layer is disk-backed and can be inspected on its own. Nothing calls a data provider while a request is being served.

![Canonical schema: competitions, seasons and data sources feed matches; matches contain events and have a coverage record; players and teams link to them](docs/schema.svg)

### The agent

`halfspace/agent/` is a small, auditable tool-calling loop:

- **Tools** (`tools.py`): 13 tools, each a thin wrapper over the same `lookups` and `features` functions the API calls. There is no SQL in the agent, so it can't see anything the UI can't.
- **Orchestrator** (`orchestrator.py`): runs the loop and enforces two rules in code, not in the prompt. Every tool call is recorded as provenance, and if a tool returns a `caveat` or `error`, it is tracked until the answer restates it. A 6-round budget makes a stuck agent fail loudly.
- **LLM client** (`llm.py`): an OpenAI-compatible client, currently pointed at [Groq](https://console.groq.com) (free tier, `openai/gpt-oss-120b`). The orchestrator only depends on a small `LLMClient` protocol, so the model is swappable.

Example, run against the real dataset (output abridged):

```text
$ python scripts/ask_agent.py "Compare Messi and Neymar in La Liga 2015/16. Who creates more chances and who presses more?"

Neymar: 2.36 key passes/90, 11.28 pressures/90
Messi:  1.90 key passes/90,  6.14 pressures/90
Both are well over the 900-minute floor, so the sample is reliable.

tools: list_competitions, get_season_players(sort_by="key_passes_p90")
unresolved caveats: []
```

## Quick start

```bash
git clone <this repo> && cd Halfspace
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

# load World Cup 2022 with 360 freeze-frames (a few minutes), then train the xG model
.venv/bin/python3 scripts/ingest_competition.py 43 106 --360
.venv/bin/python3 scripts/train_shot_model.py

.venv/bin/uvicorn halfspace.api:app --reload      # API on :8000, docs at /docs
cd frontend && cp .env.example .env && npm install && npm run dev   # UI on :5173
```

Open <http://localhost:5173> and try **Matches → World Cup 2022 → the final**, click a ringed shot, then **Walk me through this match**.

The full setup guide (all competitions, tracking data, the agent, the test suite) is in **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**.

## Tech stack

Python, FastAPI, SQLite, scikit-learn (xG-lite), React, Vite, TypeScript, Tailwind, Framer Motion and Lenis. Agent over an OpenAI-compatible API (Groq). Type: Sora and DM Sans.

## Validation

The test suite (43 tests) runs against the real dataset and has caught real bugs. Examples: the 2022 final comes out 3-3 with the shootout excluded, Suárez tops La Liga 2015/16 goals per 90, Messi's closest player match is Neymar, and xG-lite scores AUC 0.79 on 11,937 shots. Details in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#what-the-tests-check).

## Status and limitations

- The agent has an API (`POST /agent/ask`, with conversation history) but no chat panel in the UI yet.
- Free-tier LLM limits, no retry or fallback model yet.
- Only 17 matches have tracking data. 360 freeze-frames cover three tournaments.
- Local only: SQLite, no auth, no deployment, no CI.
- The interface has been checked in Chromium at desktop and 390px widths. Safari, Firefox and tablet widths haven't been tested.
- The 3D pitch is drawn per frame in SVG, which is smooth for one match's shots (about 30 to 40 columns). A match with far more shots, or a season-wide view, would need a canvas or WebGL renderer.

Full list in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#limitations).

## Credits

Event data and 360 freeze-frames: [StatsBomb Open Data](https://github.com/statsbomb/open-data), used under StatsBomb's public data licence, which requires attribution. Tracking data: [SkillCorner Open Data](https://github.com/SkillCorner/opendata) and the IDSSE/DFL dataset. Check each provider's licence before reusing their data.

Designed and built by Abhijith Varma. Fonts: [Sora](https://fonts.google.com/specimen/Sora) and [DM Sans](https://fonts.google.com/specimen/DM+Sans), both under the SIL Open Font Licence.

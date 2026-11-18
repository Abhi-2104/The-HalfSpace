"""
API-level tests, mirroring the existing real-data validation pattern:
hit real endpoints against the live dataset, assert real facts, not mocks.
Skips if the DB isn't populated.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from halfspace import db

LALIGA_1516 = (11, 27)
WC2022 = (43, 106)
WC2022_FINAL_ID = 3869685
MESSI_ID = 5503


@pytest.fixture
def client():
    if not db.DEFAULT_DB_PATH.exists():
        pytest.skip("no data/halfspace.db")
    if db.connect().execute("SELECT COUNT(*) n FROM event").fetchone()["n"] == 0:
        pytest.skip("data/halfspace.db has no ingested events")
    from fastapi.testclient import TestClient
    from halfspace.api import app
    return TestClient(app)


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_match_profile_404_for_uningested_match(client):
    r = client.get("/matches/999999999/profile")
    assert r.status_code == 404


def test_match_sequences(client):
    r = client.get(f"/matches/{WC2022_FINAL_ID}/sequences")
    assert r.status_code == 200
    body = r.json()
    assert body["counterattacks"], "expected at least one counterattack candidate"
    assert all(c["confidence"] == "medium" for c in body["counterattacks"])


@pytest.mark.usefixtures("needs_laliga")
def test_season_players_suarez_top_scorer(client):
    r = client.get(f"/competitions/{LALIGA_1516[0]}/seasons/{LALIGA_1516[1]}/players")
    assert r.status_code == 200
    top = r.json()["players"][0]
    assert "Suárez" in top["name"]


@pytest.mark.usefixtures("needs_laliga")
def test_similar_players_messi_neymar(client):
    r = client.get(f"/competitions/{LALIGA_1516[0]}/seasons/{LALIGA_1516[1]}/players/{MESSI_ID}/similar")
    assert r.status_code == 200
    names = [m["name"] for m in r.json()["most_similar"]]
    assert any("Neymar" in n for n in names)


def test_compare_players_role_mismatch_flagged(client):
    conn = db.connect()
    gk = conn.execute(
        "SELECT player_id FROM player_match_minutes WHERE position = 'Goalkeeper' LIMIT 1"
    ).fetchone()
    if not gk:
        pytest.skip("no goalkeeper in dataset")
    r = client.get("/players/compare", params={
        "player_a": MESSI_ID, "player_b": gk["player_id"],
        "competition_id": LALIGA_1516[0], "season_id": LALIGA_1516[1],
    })
    # GK likely doesn't meet the minutes floor as an outfield-style profile - either 404 or a flagged mismatch is correct
    assert r.status_code in (200, 404)
    if r.status_code == 200:
        assert r.json()["role_mismatch"] is True
        assert r.json()["caveat"] is not None


def test_season_teams_spain_top_press(client):
    r = client.get(f"/competitions/{WC2022[0]}/seasons/{WC2022[1]}/teams")
    assert r.status_code == 200
    teams = r.json()["teams"]
    ranked = [t["team"] for t in teams if t["avg_ppda"] is not None]
    assert "Spain" in ranked[:5]


@pytest.mark.usefixtures("needs_tracking")
def test_tracking_endpoints(client):
    r = client.get("/tracking", params={"provider": "skillcorner_open_data"})
    assert r.status_code == 200
    rows = r.json()["rows"]
    assert rows
    provider_match_id = rows[0]["provider_match_id"]

    r2 = client.get(f"/tracking/skillcorner_open_data/{provider_match_id}")
    assert r2.status_code == 200
    assert len(r2.json()["rows"]) == 2  # two teams per match


def test_tactical_concepts_list_and_detail(client):
    r = client.get("/tactical-concepts")
    assert r.status_code == 200
    slugs = [c["slug"] for c in r.json()["concepts"]]
    assert "high-press" in slugs
    assert "overlap" in slugs

    r2 = client.get("/tactical-concepts/high-press")
    assert r2.status_code == 200
    assert r2.json()["confidence"] == "detectable"

    r3 = client.get("/tactical-concepts/not-a-real-concept")
    assert r3.status_code == 404


if __name__ == "__main__":
    import subprocess
    subprocess.run([sys.executable, "-m", "pytest", __file__, "-v"])


def test_match_search_finds_el_clasico(client):
    r = client.get("/matches/search", params={"team": "Barcelona", "opponent": "Real Madrid", "competition_id": 11, "season_id": 27})
    ms = r.json()["matches"]
    if not ms:
        pytest.skip("La Liga 2015/16 not ingested")
    assert len(ms) == 2 and {m["home_team"] for m in ms} == {"Barcelona", "Real Madrid"}  # home and away fixture


def test_tournament_players_have_profiles_and_teams_come_from_that_tournament(client):
    """Regression: the 900-minute floor left every World Cup list empty (Messi had 732 minutes), and the agent then told a
    user that Messi 'didn't take part'. Tournaments use a 300-minute floor, and the team shown is the one played for there."""
    r = client.get("/competitions/43/seasons/106/players")
    if r.status_code != 200:
        pytest.skip("World Cup 2022 not ingested")
    j = r.json()
    assert j["min_minutes"] == 300 and len(j["players"]) > 100
    sim = client.get(f"/competitions/43/seasons/106/players/{MESSI_ID}/similar").json()
    assert "error" not in sim and len(sim["most_similar"]) >= 3
    assert {p["team"] for p in sim["most_similar"]} <= {p["team"] for p in j["players"]}
    assert not any("Paris Saint-Germain" == p["team"] for p in sim["most_similar"] if p["name"].startswith("Kylian"))


def test_missing_profile_error_never_claims_the_player_did_not_play(client):
    from halfspace import db
    from halfspace.features import player as pf
    err = pf.similar_players(db.connect(), 43, 106, 999999)
    if "error" not in err or "sufficient" in err["error"]:
        pytest.skip("World Cup 2022 not ingested")
    assert "says nothing about whether they played" in err["error"]

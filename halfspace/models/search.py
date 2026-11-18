"""
Search by meaning over players, teams, matches and tactical concepts. Each item becomes a short text built
from our own model outputs ("Messi, Center Forward (shooting, high up the pitch). Strong in: ..."),
and queries are matched with TF-IDF over words and word pairs blended with a latent (SVD) space, plus a small
football synonym list. Runs on scikit-learn alone: no model download, no GPU, a few MB of index.
ponytail: not a neural embedder. If recall disappoints, swap `_vectorize` for sentence-transformers
(already works on the dev machine); the index format and endpoints do not change.
"""
import json
import re
import sqlite3

import joblib
import numpy as np
import pandas as pd
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer

from halfspace import db, derive, tactical
from halfspace.models import serve, style
from halfspace.models.profiles import METRICS
from halfspace.models.xg import MODEL_DIR

INDEX_PATH, CARD_PATH = MODEL_DIR / "search_index.joblib", MODEL_DIR / "search_card.json"
SYNONYMS = {"press": "pressing pressure high-press", "pressing": "press pressure high-press", "counter": "counterattack counter-attack transition",
            "deep": "low block compact defensive", "keeper": "goalkeeper goalkeepers", "goalie": "goalkeeper", "striker": "forward center forward shooting",
            "winger": "wing wide dribbling", "playmaker": "creative passing xa xt midfield", "creative": "xa xt key passes assist",
            "defender": "back center back defence", "set piece": "corner free kick", "possession": "passing build-up patient",
            "direct": "long balls vertical quick attacks", "dominant": "momentum on top possession", "comeback": "trailed fought back late",
            "upset": "lost despite higher xg unlucky", "unlucky": "lost despite higher xg"}


def _expand(q: str) -> str:
    ql = q.lower()
    extra = [v for k, v in SYNONYMS.items() if k in ql]
    return q + " " + " ".join(extra)


def _docs() -> list[dict]:
    names = sqlite3.connect(f"file:{db.DEFAULT_DB_PATH}?mode=ro", uri=True, timeout=60)
    pname = {r[0]: r[1] for r in names.execute("SELECT id, COALESCE(display_name, name) FROM player")}
    pfull = dict(names.execute("SELECT id, name FROM player").fetchall())
    tname = dict(names.execute("SELECT id, name FROM team").fetchall())
    c = derive.connect_derived()
    matches = derive.load_matches()
    ctx = {(r.competition_id, r.season_id): f"{r.competition} {r.season}" for r in matches.drop_duplicates(["competition_id", "season_id"]).itertuples()}
    docs = []
    for k in tactical.load_concepts():
        docs.append({"kind": "concept", "title": k["name"], "text": f"{k['name']}. {k['beginner_explanation']} {k['analytical_definition']}",
                     "ref": {"slug": k["slug"]}})
    prof = pd.read_sql("SELECT * FROM player_profile", c)
    roles = pd.read_sql("SELECT player_id, competition_id, season_id, role FROM player_role", c)
    prof = prof.merge(roles, on=["player_id", "competition_id", "season_id"], how="left")
    for r in prof.itertuples(index=False):
        d = r._asdict()
        pct = {m: d[m + "_pct"] for m in METRICS if d.get(m + "_pct") == d.get(m + "_pct")}
        strong = [serve.LABELS[m] for m, v in sorted(pct.items(), key=lambda x: -x[1])[:3] if v >= 75]
        weak = [serve.LABELS[m] for m, v in sorted(pct.items(), key=lambda x: x[1])[:2] if v <= 25]
        nm = pname.get(int(d["player_id"]), "?")
        title = f"{nm} ({ctx.get((d['competition_id'], d['season_id']), '')})"
        text = (f"{nm} ({pfull.get(int(d['player_id']), '')}), {d.get('role') or d['position_group']}, {ctx.get((d['competition_id'], d['season_id']), '')}. "
                f"Strong in {', '.join(strong) or 'nothing standing out'}. Weaker in {', '.join(weak) or 'nothing notable'}.")
        docs.append({"kind": "player", "title": title, "text": text,
                     "ref": {"player_id": int(d["player_id"]), "competition_id": int(d["competition_id"]), "season_id": int(d["season_id"])}})
    for r in pd.read_sql("SELECT * FROM team_style", c).itertuples(index=False):
        d = r._asdict()
        words = [style.FEATURES[f][0 if d[f + "_z"] > 0 else 1] for f in style.FEATURES if abs(d[f + "_z"]) >= 0.8]
        nm = tname.get(int(d["team_id"]), "?")
        ctxn = ctx.get((d["competition_id"], d["season_id"]), "")
        docs.append({"kind": "team", "title": f"{nm} ({ctxn})", "text": f"{nm}, {ctxn}. Style: {d['archetype']}. {', '.join(words)}.",
                     "ref": {"team_id": int(d["team_id"]), "competition_id": int(d["competition_id"]), "season_id": int(d["season_id"])}})
    shots = derive.load_shots()[["match_id", "event_id", "team_id"]].merge(pd.read_sql("SELECT event_id, xg_v2 FROM shot_xg", c), on="event_id")
    xgm = shots.groupby(["match_id", "team_id"])["xg_v2"].sum()
    for r in matches.itertuples(index=False):
        hs, as_ = r.home_score, r.away_score
        if hs != hs or as_ != as_:
            continue
        xh, xa = float(xgm.get((r.match_id, r.home_team_id), 0)), float(xgm.get((r.match_id, r.away_team_id), 0))
        tags = []
        if r.max_period >= 3:
            tags.append("went to extra time")
        if hs + as_ >= 5:
            tags.append("high scoring")
        if (hs > as_ and xh + 0.7 < xa) or (as_ > hs and xa + 0.7 < xh):
            tags.append("won despite lower xG, the other side was unlucky upset")
        if hs == as_:
            tags.append("draw")
        h, a = tname.get(r.home_team_id, "?"), tname.get(r.away_team_id, "?")
        docs.append({"kind": "match", "title": f"{h} {int(hs)}-{int(as_)} {a} ({r.competition} {r.season})",
                     "text": f"{h} {int(hs)}-{int(as_)} {a}, {r.competition} {r.season}, {r.date}. xG {xh:.1f} to {xa:.1f}. {' '.join(tags)}",
                     "ref": {"match_id": int(r.match_id)}})
    return docs


def build() -> dict:
    docs = _docs()
    texts = [d["text"] + " " + d["title"] for d in docs]
    tf = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True, min_df=1, stop_words="english")
    X = tf.fit_transform(texts)
    svd = TruncatedSVD(min(128, X.shape[1] - 1), random_state=0).fit(X)
    Z = svd.transform(X)
    Z /= np.linalg.norm(Z, axis=1, keepdims=True) + 1e-9
    joblib.dump({"tf": tf, "svd": svd, "X": X, "Z": Z.astype(np.float32), "kinds": [d["kind"] for d in docs]}, INDEX_PATH)
    derive.write_table("search_doc", pd.DataFrame([{"id": i, "kind": d["kind"], "title": d["title"], "text": d["text"], "ref": json.dumps(d["ref"])}
                                                    for i, d in enumerate(docs)]))
    counts = pd.Series([d["kind"] for d in docs]).value_counts().to_dict()
    card = {"name": "Search", "method": "TF-IDF (words and word pairs) blended with a 128-d latent space, plus a football synonym list",
            "documents": counts, "limits": "Matches words and their latent neighbours, not meaning in the neural sense. Player and team texts come from our "
                                           "model outputs (percentiles, style), so it finds what the models can say, not arbitrary facts."}
    CARD_PATH.write_text(json.dumps(card, indent=2))
    return card


_idx, _mtime = None, 0.0


def _index():
    global _idx, _mtime
    m = INDEX_PATH.stat().st_mtime
    if _idx is None or m != _mtime:
        _idx, _mtime = joblib.load(INDEX_PATH), m
    return _idx


def query(q: str, kind: str | None = None, limit: int = 10) -> dict:
    ix = _index()
    v = ix["tf"].transform([_expand(q)])
    lex = (ix["X"] @ v.T).toarray().ravel()
    z = ix["svd"].transform(v)
    z /= np.linalg.norm(z) + 1e-9
    sem = ix["Z"] @ z.ravel()
    score = 0.7 * lex + 0.3 * sem
    ql = set(re.findall(r"\w+", q.lower()))
    c = derive.connect_derived()
    rows = c.execute("SELECT id, kind, title, ref FROM search_doc").fetchall()
    boost = np.array([0.25 * (len(ql & set(re.findall(r"\w+", r["title"].lower()))) > 0 and r["kind"] in ("player", "team", "match")) for r in rows])
    kinds = np.array([r["kind"] for r in rows])
    if re.match(r"\s*(what|explain|define|how does|meaning)", q.lower()):
        boost = boost + 0.6 * (kinds == "concept")  # "what is X" questions want the explainer first
    score = score + boost
    order = np.argsort(-score)
    out = []
    for i in order:
        r = rows[int(i)]
        if kind and r["kind"] != kind:
            continue
        if score[i] <= 0.02:
            break
        out.append({"kind": r["kind"], "title": r["title"], "score": round(float(score[i]), 3), **json.loads(r["ref"])})
        if len(out) >= limit:
            break
    return {"query": q, "results": out, "note": "Keyword-and-latent search over model-derived descriptions; not a full-text search of raw data."}

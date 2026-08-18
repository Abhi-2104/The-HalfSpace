import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type MatchDetailInfo, type ShotXg, type FreezeFrame } from "../lib/api";
import { Pitch } from "../components/pitch/Pitch";
import { FreezeFrameLayer } from "../components/pitch/FreezeFrameLayer";

/**
 * Guided match walkthrough (scrollytelling). The story of a match, from the
 * data, IS its goals + big chances in time order. A sticky pitch on the left
 * follows what the reader scrolls past on the right; when a moment has a 360
 * freeze-frame we render every player's real position, otherwise just the shot.
 * Narration is derived from the shot's own fields (xG, outcome, running score) -
 * plain language first, so a beginner reads the match without knowing the stats.
 *
 * ponytail: IntersectionObserver drives the active step, no scrolly library.
 * Backend reused as-is (shots-xg + freeze-frame) - a match's story needs no new
 * endpoint, the shot list already is the story.
 */

// A moment worth narrating: every goal, plus clear chances that weren't taken.
const CHANCE_XG = 0.15;

function quality(xg: number | null): string {
  if (xg == null) return "an unmeasured chance";
  if (xg >= 0.35) return "a big chance";
  if (xg >= 0.15) return "a real opportunity";
  if (xg >= 0.05) return "a half-chance";
  return "a long shot";
}

// StatsBomb outcome codes → plain past-tense phrases for the narrative.
const OUTCOME_PHRASE: Record<string, string> = {
  "Off T": "dragged it off target",
  Saved: "forced a save",
  "Saved Off Target": "forced a save",
  "Saved To Post": "was saved onto the post",
  Blocked: "saw it blocked",
  Post: "hit the post",
  Wayward: "scuffed it wide",
};
function outcomePhrase(o: string): string {
  return OUTCOME_PHRASE[o] ?? o.toLowerCase();
}

interface Moment {
  shot: ShotXg;
  homeScore: number; // running score AFTER this moment
  awayScore: number;
  isGoal: boolean;
}

export function MatchStory() {
  const { matchId } = useParams();
  const id = Number(matchId);
  const [match, setMatch] = useState<MatchDetailInfo | null>(null);
  const [shots, setShots] = useState<ShotXg[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [frame, setFrame] = useState<FreezeFrame | null>(null);
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    setMatch(null); setShots(null); setError(null); setActive(0);
    api.match(id).then(setMatch).catch((e) => setError(e.message));
    api.shotsXg(id).then((r) => setShots(r.shots)).catch(() => setShots([]));
  }, [id]);

  const moments = useMemo<Moment[]>(() => {
    if (!match || !shots) return [];
    const picked = shots
      .filter((s) => s.outcome_name === "Goal" || (s.xg ?? 0) >= CHANCE_XG)
      .sort((a, b) => a.minute - b.minute || a.second - b.second);
    let h = 0, a = 0;
    return picked.map((shot) => {
      const isGoal = shot.outcome_name === "Goal";
      if (isGoal) { if (shot.team_id === match.home_team_id) h++; else a++; }
      return { shot, homeScore: h, awayScore: a, isGoal };
    });
  }, [match, shots]);

  // active moment's freeze-frame (only fetched when it has one)
  useEffect(() => {
    const m = moments[active];
    if (!m || !m.shot.has_freeze_frame) { setFrame(null); return; }
    let live = true;
    api.freezeFrame(m.shot.id).then((f) => { if (live) setFrame(f); }).catch(() => { if (live) setFrame(null); });
    return () => { live = false; };
  }, [moments, active]);

  // IntersectionObserver: whichever step is centered drives the pitch
  useEffect(() => {
    if (!moments.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (vis) { const i = stepRefs.current.indexOf(vis.target as HTMLDivElement); if (i >= 0) setActive(i); }
      },
      { rootMargin: "-40% 0px -40% 0px", threshold: [0, 0.5, 1] }
    );
    stepRefs.current.forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, [moments]);

  if (error) return <div className="mx-auto max-w-4xl px-6 py-12 text-clay">{error}</div>;
  if (!match || !shots) return <div className="mx-auto max-w-4xl px-6 py-12 text-ink-2">Loading…</div>;

  const cur = moments[active];

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <Link to={`/matches/${id}`} className="font-mono text-xs uppercase tracking-wide text-ink-2 hover:text-marker-bright">← back to match</Link>
      <h1 className="mt-2 font-display text-4xl font-bold text-ink-0">
        {match.home_team} <span className="text-marker-bright">{match.home_score}–{match.away_score}</span> {match.away_team}
      </h1>
      <p className="mt-1 font-mono text-xs uppercase tracking-wide text-ink-2">
        {match.competition_name} {match.season_name} — {match.match_date} · walkthrough
      </p>

      {moments.length === 0 ? (
        <p className="mt-12 text-ink-2">No goals or clear chances to walk through in this match.</p>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_1fr]">
          {/* sticky pitch — follows the scroll */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-sm border border-pitch-800 bg-pitch-900 p-4">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="font-mono text-lg font-semibold tabular-nums text-ink-0">
                  {match.home_team.slice(0, 3).toUpperCase()} {cur.homeScore}–{cur.awayScore} {match.away_team.slice(0, 3).toUpperCase()}
                </span>
                <span className="font-mono text-xs text-ink-2">{cur.shot.minute}'{cur.shot.second}"</span>
              </div>
              <Pitch>
                {frame ? (
                  <FreezeFrameLayer frame={frame} ballLocation={cur.shot.x != null ? [cur.shot.x, cur.shot.y] : undefined} />
                ) : (
                  <ShotDot shot={cur.shot} home={cur.shot.team_id === match.home_team_id} />
                )}
              </Pitch>
              <p className="mt-2 text-[11px] text-ink-2">
                {frame
                  ? "Amber = attacking team, blue = defenders, ringed = keeper, white = ball."
                  : cur.shot.has_freeze_frame ? "Loading positions…" : "No 360 data for this moment — showing the shot location only."}
              </p>
            </div>
          </div>

          {/* scrolling narrative */}
          <div className="space-y-[45vh] pb-[40vh]">
            {moments.map((m, i) => (
              <div
                key={m.shot.id}
                ref={(el) => { stepRefs.current[i] = el; }}
                className={`rounded-sm border p-5 transition ${i === active ? "border-marker bg-pitch-900" : "border-pitch-800 bg-pitch-950 opacity-60"}`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-sm tabular-nums text-marker-bright">{m.shot.minute}'</span>
                  {m.isGoal && <span className="rounded-sm bg-marker px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-ink-0">Goal</span>}
                </div>
                <p className="mt-2 text-ink-1">
                  <span className="text-ink-0">{m.shot.player_name ?? "A player"}</span> ({m.shot.team_name}){" "}
                  {m.isGoal ? "scores" : "gets " + quality(m.shot.xg)}
                  {m.shot.xg != null && (
                    <> — the model rated it <span className="text-marker-bright">{m.shot.xg.toFixed(2)} xG</span>
                      {m.isGoal ? <>, {quality(m.shot.xg)}</> : null}</>
                  )}
                  {m.isGoal ? "." : <>, but {outcomePhrase(m.shot.outcome_name)}.</>}
                </p>
                {m.isGoal && (
                  <p className="mt-1 font-mono text-xs text-ink-2">
                    {match.home_team} {m.homeScore}–{m.awayScore} {match.away_team}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ShotDot({ shot, home }: { shot: ShotXg; home: boolean }) {
  if (shot.x == null) return null;
  const color = home ? "var(--color-marker-bright)" : "var(--color-info)";
  const r = shot.xg != null ? Math.max(1, Math.sqrt(shot.xg) * 4) : 1.5;
  return (
    <g>
      <circle cx={shot.x} cy={shot.y} r={r} fill={color} opacity={0.85} />
      {shot.outcome_name === "Goal" && <circle cx={shot.x} cy={shot.y} r={r + 1.2} fill="none" stroke={color} strokeWidth={0.5} />}
    </g>
  );
}

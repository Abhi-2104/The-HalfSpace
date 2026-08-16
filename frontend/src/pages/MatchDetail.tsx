import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type MatchDetailInfo, type MatchProfile, type Shot, type Counterattack } from "../lib/api";
import { PitchShotMap } from "../components/PitchShotMap";
import { CompareBar } from "../components/CompareBar";
import { CoverageStrip } from "../components/CoverageStrip";

export function MatchDetail() {
  const { matchId } = useParams();
  const id = Number(matchId);
  const [match, setMatch] = useState<MatchDetailInfo | null>(null);
  const [profile, setProfile] = useState<MatchProfile | null>(null);
  const [shots, setShots] = useState<Shot[] | null>(null);
  const [sequences, setSequences] = useState<Counterattack[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMatch(null);
    setProfile(null);
    setShots(null);
    setSequences(null);
    setError(null);
    api.match(id).then(setMatch).catch((e) => setError(e.message));
    api.matchProfile(id).then(setProfile).catch(() => {});
    api.matchShots(id).then((r) => setShots(r.shots)).catch(() => {});
    api.matchSequences(id).then((r) => setSequences(r.counterattacks)).catch(() => {});
  }, [id]);

  if (error) return <div className="mx-auto max-w-4xl px-6 py-12 text-clay">{error}</div>;
  if (!match) return <div className="mx-auto max-w-4xl px-6 py-12 text-ink-2">Loading…</div>;

  const ppdaHome = profile?.ppda[String(match.home_team_id)];
  const ppdaAway = profile?.ppda[String(match.away_team_id)];
  const shotsHome = profile?.shots[String(match.home_team_id)];
  const shotsAway = profile?.shots[String(match.away_team_id)];

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <p className="font-mono text-xs uppercase tracking-wide text-ink-2">
        {match.competition_name} {match.season_name} — {match.match_date}
      </p>
      <h1 className="mt-2 font-display text-4xl font-bold text-ink-0">
        {match.home_team} <span className="text-marker-bright">{match.home_score}–{match.away_score}</span> {match.away_team}
      </h1>
      <div className="mt-3">
        <CoverageStrip hasEvents={!!profile?.coverage?.has_events} hasTracking={!!profile?.coverage?.has_tracking} has360={!!profile?.coverage?.has_360} />
      </div>

      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[1.3fr_1fr]">
        <div className="rounded-sm border border-pitch-800 bg-pitch-900 p-4">
          {shots ? <PitchShotMap shots={shots} homeTeamId={match.home_team_id} /> : <div className="aspect-[3/2]" />}
          <div className="mt-3 flex gap-5 font-mono text-xs text-ink-1">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-marker-bright" /> {match.home_team}</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-info" /> {match.away_team}</span>
            <span className="text-ink-2">ring = goal</span>
          </div>
        </div>

        <div className="space-y-8">
          {ppdaHome != null && ppdaAway != null && (
            <div>
              <h2 className="font-display text-lg font-bold text-ink-0">Pressing intensity (PPDA)</h2>
              <p className="mb-3 text-xs text-ink-2">Lower = more aggressive press. See Tactics → High press.</p>
              <CompareBar label="PPDA" nameA={match.home_team} nameB={match.away_team} valueA={ppdaHome} valueB={ppdaAway} lowerIsBetter />
            </div>
          )}
          {shotsHome && shotsAway && (
            <div>
              <h2 className="font-display text-lg font-bold text-ink-0">Shots</h2>
              <CompareBar label="Total shots" nameA={match.home_team} nameB={match.away_team} valueA={shotsHome.shots} valueB={shotsAway.shots} format={(v) => String(v)} />
            </div>
          )}

          <div>
            <h2 className="font-display text-lg font-bold text-ink-0">Counterattacks</h2>
            <p className="mb-3 text-xs text-ink-2">Heuristic detection, medium confidence — see method on each candidate.</p>
            {sequences && sequences.length === 0 && <p className="text-sm text-ink-2">None detected.</p>}
            <ul className="space-y-2">
              {sequences?.map((c, i) => (
                <li key={i} className="rounded-sm border border-pitch-800 bg-pitch-900 px-3 py-2 text-sm">
                  <span className="font-mono text-ink-2">{c.start_minute}'{c.start_second}"</span>{" "}
                  <span className="text-ink-0">{c.trigger_type} → shot in {c.time_to_shot_s}s, {c.distance_m}m upfield</span>{" "}
                  <span className="font-mono text-xs text-marker-bright">({c.shot_outcome})</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type MatchDetailInfo, type MatchProfile, type Counterattack, type PassNetwork } from "../lib/api";
import { CompareBar } from "../components/CompareBar";
import { CoverageStrip } from "../components/CoverageStrip";
import { MetricInfo } from "../components/MetricInfo";
import { ShotExplorer } from "../components/pitch/ShotExplorer";
import { Pitch } from "../components/pitch/Pitch";
import { PassNetworkLayer } from "../components/pitch/PassNetworkLayer";

export function MatchDetail() {
  const { matchId } = useParams();
  const id = Number(matchId);
  const [match, setMatch] = useState<MatchDetailInfo | null>(null);
  const [profile, setProfile] = useState<MatchProfile | null>(null);
  const [sequences, setSequences] = useState<Counterattack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [netTeam, setNetTeam] = useState<"home" | "away">("home");
  const [network, setNetwork] = useState<PassNetwork | null>(null);

  useEffect(() => {
    setMatch(null);
    setProfile(null);
    setSequences(null);
    setError(null);
    api.match(id).then(setMatch).catch((e) => setError(e.message));
    api.matchProfile(id).then(setProfile).catch(() => {});
    api.matchSequences(id).then((r) => setSequences(r.counterattacks)).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (!match) return;
    setNetwork(null);
    const teamId = netTeam === "home" ? match.home_team_id : match.away_team_id;
    api.passNetwork(id, teamId).then(setNetwork).catch(() => setNetwork(null));
  }, [match, netTeam, id]);

  if (error) return <div className="mx-auto max-w-4xl px-6 py-12 text-clay">{error}</div>;
  if (!match) return <div className="mx-auto max-w-4xl px-6 py-12 text-ink-2">Loading…</div>;

  const ppdaHome = profile?.ppda[String(match.home_team_id)];
  const ppdaAway = profile?.ppda[String(match.away_team_id)];
  const shotsHome = profile?.shots[String(match.home_team_id)];
  const shotsAway = profile?.shots[String(match.away_team_id)];

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <p className="font-mono text-xs uppercase tracking-wide text-ink-2">
        {match.competition_name} {match.season_name} — {match.match_date}
      </p>
      <h1 className="mt-2 font-display text-4xl font-bold text-ink-0">
        {match.home_team} <span className="text-marker-bright">{match.home_score}–{match.away_score}</span> {match.away_team}
      </h1>
      <div className="mt-3">
        <CoverageStrip hasEvents={!!profile?.coverage?.has_events} hasTracking={!!profile?.coverage?.has_tracking} has360={!!profile?.coverage?.has_360} />
      </div>

      <Link to={`/matches/${id}/story`}
        className="mt-4 inline-flex items-center gap-2 rounded-sm border border-marker/50 bg-marker/10 px-3 py-2 font-mono text-xs uppercase tracking-wide text-marker-bright transition hover:bg-marker/20">
        ▶ Walk me through this match
      </Link>

      {/* signature interaction: shot map + freeze-frame */}
      <div className="mt-10">
        <ShotExplorer matchId={id} homeTeamId={match.home_team_id} homeTeam={match.home_team} awayTeam={match.away_team} />
      </div>

      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_1fr]">
        {/* pass network */}
        <div className="rounded-sm border border-pitch-800 bg-pitch-900 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center font-display text-lg font-bold text-ink-0">Pass network<MetricInfo metric="pass_network" /></h2>
            <div className="flex rounded-sm border border-pitch-700 font-mono text-[11px] uppercase">
              {(["home", "away"] as const).map((side) => (
                <button key={side} onClick={() => setNetTeam(side)}
                  className={`px-2.5 py-1 transition ${netTeam === side ? "bg-marker text-ink-0" : "text-ink-1 hover:text-ink-0"}`}>
                  {side === "home" ? match.home_team : match.away_team}
                </button>
              ))}
            </div>
          </div>
          {network ? <Pitch><PassNetworkLayer network={network} /></Pitch> : <div className="aspect-[3/2]" />}
          {network && <p className="mt-2 text-[11px] text-ink-2">{network.cutoff_note}. Node size = passes made; edge width = passes between the pair.</p>}
        </div>

        {/* stats + sequences */}
        <div className="space-y-8">
          {ppdaHome != null && ppdaAway != null && (
            <div>
              <h2 className="flex items-center font-display text-lg font-bold text-ink-0">Pressing intensity (PPDA)<MetricInfo metric="ppda" /></h2>
              <p className="mb-3 text-xs text-ink-2">Lower = more aggressive press.</p>
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
            <h2 className="flex items-center font-display text-lg font-bold text-ink-0">Counterattacks<MetricInfo metric="counterattack" /></h2>
            <p className="mb-3 text-xs text-ink-2">Heuristic detection, medium confidence — see method on each candidate.</p>
            {sequences && sequences.length === 0 && <p className="text-sm text-ink-2">None detected.</p>}
            <ul className="space-y-2">
              {sequences?.map((c, i) => (
                <li key={i} className="rounded-sm border border-pitch-800 bg-pitch-950 px-3 py-2 text-sm">
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

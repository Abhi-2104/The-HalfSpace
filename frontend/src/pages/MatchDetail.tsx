import { LoadError } from "../components/LoadError";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type MatchDetailInfo, type MatchProfile, type PassNetwork } from "../lib/api";
import { CompareBar } from "../components/CompareBar";
import { CoverageStrip } from "../components/CoverageStrip";
import { useMode } from "../lib/mode";
import { MatchReport } from "../components/match/MatchReport";
import { MomentumChart, XgRace } from "../components/match/MatchFlow";
import { Possessions } from "../components/match/Possessions";
import { useAsync } from "../lib/useAsync";
import { MetricInfo } from "../components/MetricInfo";
import { ShotExplorer } from "../components/pitch/ShotExplorer";
import { Pitch } from "../components/pitch/Pitch";
import { PassNetworkLayer } from "../components/pitch/PassNetworkLayer";

export function MatchDetail() {
  const { matchId } = useParams();
  const { mode } = useMode();
  const id = Number(matchId);
  const [match, setMatch] = useState<MatchDetailInfo | null>(null);
  const [profile, setProfile] = useState<MatchProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const report = useAsync(() => api.matchReport(id), [id]);
  const flow = useAsync(() => api.momentum(id), [id]);
  const [netTeam, setNetTeam] = useState<"home" | "away">("home");
  const [networks, setNetworks] = useState<{ home: PassNetwork; away: PassNetwork } | null>(null);

  useEffect(() => {
    setMatch(null);
    setProfile(null);
    setError(null);
    api.match(id).then(setMatch).catch((e) => setError(e.message));
    api.matchProfile(id).then(setProfile).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (!match) return;
    setNetworks(null);
    Promise.all([api.passNetwork(id, match.home_team_id), api.passNetwork(id, match.away_team_id)])
      .then(([home, away]) => setNetworks({ home, away }))
      .catch(() => setNetworks(null));
  }, [match, id]);

  if (error) return <LoadError error={error} what="match" backTo="/matches" backLabel="Back to matches" />;
  if (!match) return <div className="mx-auto max-w-[1440px] px-6 lg:px-10 py-12 text-ink-2">Loading…</div>;

  const ppdaHome = profile?.ppda[String(match.home_team_id)];
  const ppdaAway = profile?.ppda[String(match.away_team_id)];
  const shotsHome = profile?.shots[String(match.home_team_id)];
  const shotsAway = profile?.shots[String(match.away_team_id)];

  return (
    <div className="mx-auto max-w-[1440px] px-6 lg:px-10 py-12">
      <p className="font-mono text-xs text-ink-2">
        {match.competition_name} {match.season_name} — {match.match_date}
      </p>
      <h1 className="mt-2 font-display text-4xl font-extrabold tracking-[-0.03em] text-ink-0">
        {match.home_team} <span className="text-marker-bright">{match.home_score}–{match.away_score}</span> {match.away_team}
      </h1>
      <div className="mt-3">
        <CoverageStrip hasEvents={!!profile?.coverage?.has_events} hasTracking={!!profile?.coverage?.has_tracking} has360={!!profile?.coverage?.has_360} />
      </div>

      <Link to={`/matches/${id}/story`}
        className="mt-4 inline-flex items-center gap-2 rounded-lg border border-marker/50 bg-marker/10 px-3 py-2 font-mono text-xs text-marker-bright transition hover:bg-marker/20">
        ▶ Guided match story
      </Link>

      {report.data && report.data.text.length > 0 && <div className="mt-8"><MatchReport report={report.data} home={match.home_team} away={match.away_team} homeTeamId={match.home_team_id} /></div>}

      {/* signature interaction: shot map + freeze-frame */}
      <div className="mt-10">
        <ShotExplorer matchId={id} homeTeamId={match.home_team_id} homeTeam={match.home_team} awayTeam={match.away_team} />
      </div>

      {flow.data && (
        <section className="mt-10 rounded-2xl border border-pitch-800 bg-pitch-900 p-4 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-lg font-bold text-ink-0">How the match flowed</h2>
            <span className="text-xs text-ink-2">{flow.data.extra_time || flow.data.minutes.length > 100 ? "Includes extra time" : "First 90 minutes"}</span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-ink-1">Who was creating the better chances, minute by minute, and how the chance quality added up. It describes what happened; it doesn't predict anything. <Link to="/how-it-works#momentum" className="text-marker-bright hover:underline">How is this calculated?</Link></p>
          <div className="mt-5 grid gap-8 lg:grid-cols-[1.2fr_1fr]">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink-0">Who's on top</h3>
              <MomentumChart data={flow.data} home={match.home_team} away={match.away_team} homeTeamId={match.home_team_id} />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink-0">Chance quality (xG) race</h3>
              <XgRace data={flow.data} home={match.home_team} away={match.away_team} homeTeamId={match.home_team_id} />
            </div>
          </div>
        </section>
      )}

      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_1fr]">
        {/* pass network */}
        <div className="rounded-2xl border border-pitch-800 bg-pitch-900 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center font-display text-lg font-bold text-ink-0">Pass network<MetricInfo metric="pass_network" /></h2>
            <div className="flex rounded-lg border border-pitch-700 font-mono text-xs">
              {(["home", "away"] as const).map((side) => (
                <button key={side} onClick={() => setNetTeam(side)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 transition ${netTeam === side ? "bg-pitch-800 text-ink-0" : "text-ink-2 hover:text-ink-0"}`}>
                  <i className={`h-2 w-2 rounded-full ${side === "home" ? "bg-team-a" : "bg-team-b"}`} />
                  {side === "home" ? match.home_team : match.away_team}
                </button>
              ))}
            </div>
          </div>
          {networks ? (
            <Pitch>
              <PassNetworkLayer
                selected={netTeam === "home" ? 0 : 1}
                sides={[
                  { network: networks.home, color: "var(--color-team-a)", mirror: false },
                  { network: networks.away, color: "var(--color-team-b)", mirror: true },
                ]}
              />
            </Pitch>
          ) : <div className="aspect-[3/2]" />}
          {networks && (
            <p className="mt-2 text-xs text-ink-2">
              {match.home_team} (blue) attack right, {match.away_team} (orange) attack left. The team you pick is in focus. Bigger figure = more passes; thicker line = more passes between the pair.
              {mode === "analyst" && <> {networks.home.cutoff_note}. {networks.home.recipient_note}</>}
            </p>
          )}
        </div>

        {/* stats + sequences */}
        <div className="space-y-8">
          {ppdaHome != null && ppdaAway != null && (
            <div>
              <h2 className="flex items-center font-display text-lg font-bold text-ink-0">Pressing intensity (PPDA)<MetricInfo metric="ppda" /></h2>
              <p className="mb-3 text-xs text-ink-2">{mode === "analyst" ? "Opposition passes allowed per defensive action. Lower = more aggressive press." : "A lower number means the team pressed harder."}</p>
              <CompareBar label="PPDA" nameA={match.home_team} nameB={match.away_team} valueA={ppdaHome} valueB={ppdaAway} lowerIsBetter />
            </div>
          )}
          {shotsHome && shotsAway && (
            <div>
              <h2 className="font-display text-lg font-bold text-ink-0">Shots</h2>
              <CompareBar label="Total shots" nameA={match.home_team} nameB={match.away_team} valueA={shotsHome.shots} valueB={shotsAway.shots} format={(v) => String(v)} />
            </div>
          )}

          <Possessions matchId={id} homeTeam={match.home_team} />
        </div>
      </div>
    </div>
  );
}

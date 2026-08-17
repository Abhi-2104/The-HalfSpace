import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, type SimilarPlayersResult, type Heatmap } from "../lib/api";
import { Pitch } from "../components/pitch/Pitch";
import { HeatmapLayer } from "../components/pitch/HeatmapLayer";
import { MetricInfo } from "../components/MetricInfo";

const FEATURE_LABELS: Record<string, string> = {
  goals_p90: "Goals/90", shots_p90: "Shots/90", key_passes_p90: "Key passes/90",
  prog_passes_p90: "Prog. passes/90", prog_carries_p90: "Prog. carries/90",
  dribbles_completed_p90: "Dribbles/90", pressures_p90: "Pressures/90", touches_p90: "Touches/90",
};

export function PlayerDetail() {
  const { playerId } = useParams();
  const [params] = useSearchParams();
  const competitionId = Number(params.get("competition_id"));
  const seasonId = Number(params.get("season_id"));
  const [result, setResult] = useState<SimilarPlayersResult | null>(null);
  const [heatmap, setHeatmap] = useState<Heatmap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setHeatmap(null);
    setError(null);
    api.similarPlayers(competitionId, seasonId, Number(playerId)).then(setResult).catch((e) => setError(e.message));
    api.seasonPlayerHeatmap(competitionId, seasonId, Number(playerId)).then(setHeatmap).catch(() => setHeatmap(null));
  }, [playerId, competitionId, seasonId]);

  if (error) return <div className="mx-auto max-w-4xl px-6 py-12 text-clay">{error}</div>;
  if (!result) return <div className="mx-auto max-w-4xl px-6 py-12 text-ink-2">Loading…</div>;

  const { target, most_similar, peer_group, peer_group_size, reliability_note } = result;

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="font-display text-4xl font-bold text-ink-0">{target.name}</h1>
      <p className="mt-1 font-mono text-sm text-ink-2">{target.team} · {target.position} · {target.minutes} min</p>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[1.1fr_1fr]">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-2 lg:content-start">
          {Object.entries(FEATURE_LABELS).map(([key, label]) => (
            <div key={key} className="rounded-sm border border-pitch-800 bg-pitch-900 p-3">
              <div className="font-mono text-lg font-semibold tabular-nums text-ink-0">
                {(target as unknown as Record<string, number>)[key].toFixed(2)}
              </div>
              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-ink-2">{label}</div>
            </div>
          ))}
        </div>
        <div className="rounded-sm border border-pitch-800 bg-pitch-900 p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="flex items-center font-display text-lg font-bold text-ink-0">Touch heatmap<MetricInfo metric="heatmap" /></h2>
            <span className="font-mono text-[10px] uppercase tracking-wide text-ink-2">attacking →</span>
          </div>
          {heatmap ? (
            heatmap.peak ? (
              <Pitch><HeatmapLayer heatmap={heatmap} /></Pitch>
            ) : (
              <p className="py-12 text-center text-sm text-ink-2">No touch data.</p>
            )
          ) : (
            <div className="aspect-[3/2]" />
          )}
        </div>
      </div>

      <h2 className="mt-12 font-display text-2xl font-bold text-ink-0">Most similar players</h2>
      <p className="mt-1 text-sm text-ink-1">
        Peer group: {peer_group} ({peer_group_size} players). Cosine similarity over standardized per-90 stats.
      </p>
      {reliability_note && (
        <p className="mt-2 rounded-sm border border-marker/40 bg-marker/10 px-3 py-2 text-sm text-marker-bright">
          {reliability_note}
        </p>
      )}

      <ul className="mt-4 divide-y divide-pitch-800 border-y border-pitch-800">
        {most_similar.map((m) => (
          <li key={m.player_id} className="flex items-center justify-between px-2 py-3">
            <div className="flex items-center gap-3">
              <Link to={`/players/${m.player_id}?competition_id=${competitionId}&season_id=${seasonId}`} className="text-ink-0 hover:text-marker-bright">
                {m.name}
              </Link>
              <span className="font-mono text-xs text-ink-2">{m.team}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-pitch-800">
                <div className="h-full rounded-full bg-marker-bright" style={{ width: `${m.similarity * 100}%` }} />
              </div>
              <span className="w-12 text-right font-mono text-sm tabular-nums text-ink-1">{(m.similarity * 100).toFixed(0)}%</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

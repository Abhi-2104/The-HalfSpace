import { api } from "../../lib/api";
import { displayName } from "../../lib/names";
import { useAsync } from "../../lib/useAsync";
import { Empty, SkeletonRows } from "../list";

/** Goalkeepers ranked by goals prevented compared with what an average keeper would have conceded. */
export function Goalkeepers({ competitionId, seasonId }: { competitionId: number; seasonId: number }) {
  const { data, failed } = useAsync(() => api.goalkeepers(competitionId, seasonId, 15), [competitionId, seasonId]);
  const max = Math.max(...(data?.goalkeepers.map((g) => Math.abs(g.prevented_per_100)) ?? [0]), 1e-9);
  return (
    <div className="mt-4">
      <p className="max-w-2xl text-sm text-ink-1">How many goals each keeper stopped compared with what an average keeper would have let in from the same shots. Positive is better than average.</p>
      <div className="mt-4 overflow-hidden rounded-2xl border border-pitch-800 bg-pitch-900">
        <div className="grid grid-cols-[2rem_minmax(0,1fr)_5rem_5.5rem] items-center gap-3 border-b border-pitch-800 bg-pitch-950/50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-2 md:grid-cols-[2rem_minmax(0,1fr)_minmax(0,10rem)_5rem_5.5rem_5.5rem]">
          <span className="text-right">#</span><span>Goalkeeper</span><span className="hidden md:block" /><span className="text-right">Shots</span><span className="text-right">Saved</span><span className="hidden text-right md:block">Expected</span>
        </div>
        {!data && !failed && <SkeletonRows n={6} />}
        {failed && <Empty>Goalkeeper data is unavailable right now.</Empty>}
        {data && data.goalkeepers.length === 0 && <Empty>No goalkeeper data for this league season yet.</Empty>}
        {data && (
          <ul className="divide-y divide-pitch-800">
            {data.goalkeepers.map((g, i) => {
              const good = g.prevented_per_100 >= 0;
              return (
                <li key={g.player_id} className="grid grid-cols-[2rem_minmax(0,1fr)_5rem_5.5rem] items-center gap-3 px-4 py-3 md:grid-cols-[2rem_minmax(0,1fr)_minmax(0,10rem)_5rem_5.5rem_5.5rem]">
                  <span className="text-right text-xs tabular-nums text-ink-2">{i + 1}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink-0">{displayName(g.name, g.display_name)}</span>
                    <span className={`block text-xs ${good ? "text-marker-bright" : "text-clay"}`}>{good ? "+" : ""}{g.prevented_per_100.toFixed(1)} goals per 100 shots{g.shots_faced < 150 ? " · small sample" : ""}</span>
                  </span>
                  <span className="relative hidden h-2.5 md:block" aria-hidden>
                    <span className="absolute inset-y-0 left-1/2 w-px bg-pitch-700" />
                    <span className={`absolute inset-y-0 rounded-full ${good ? "left-1/2 bg-marker" : "right-1/2 bg-warm"}`} style={{ width: `${(Math.abs(g.prevented_per_100) / max) * 50}%` }} />
                  </span>
                  <span className="text-right font-mono text-sm tabular-nums text-ink-1">{g.shots_faced}</span>
                  <span className="text-right font-mono text-sm tabular-nums text-ink-0">{(g.save_pct * (g.save_pct <= 1 ? 100 : 1)).toFixed(0)}%</span>
                  <span className="hidden text-right font-mono text-sm tabular-nums text-ink-2 md:block">{(g.expected_save_pct * (g.expected_save_pct <= 1 ? 100 : 1)).toFixed(0)}%</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {data && <p className="mt-2 text-xs text-ink-2">{data.note}</p>}
    </div>
  );
}

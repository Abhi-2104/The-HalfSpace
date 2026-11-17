import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";

/** Players with a similar style anywhere in the data, including other leagues. Style, not quality. */
export function PlaysLike({ competitionId, seasonId, playerId }: { competitionId: number; seasonId: number; playerId: number }) {
  const { data, failed } = useAsync(() => api.playsLike(competitionId, seasonId, playerId, 8), [competitionId, seasonId, playerId]);
  if (failed) return null;
  return (
    <section>
      <h2 className="font-display text-2xl font-bold text-ink-0">Plays like</h2>
      <p className="mt-1 text-sm text-ink-1">Players with a similar style from across all the leagues in the data. Similar style does not mean similar quality.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {!data && Array.from({ length: 4 }, (_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-pitch-800/30" />)}
        {data?.plays_like.map((p) => (
          <div key={p.player_id} className="rounded-2xl border border-pitch-800 bg-pitch-900 p-4">
            <div className="truncate font-medium text-ink-0">{p.name}</div>
            {p.competition && <div className="mt-0.5 truncate text-xs text-ink-2">{p.competition}</div>}
            <div className="mt-2 flex items-center gap-2" title="Closer means a more similar style">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-pitch-800">
                <div className="h-full rounded-full bg-marker" style={{ width: `${Math.max(8, 100 - p.distance * 35)}%` }} />
              </div>
              <span className="text-[11px] text-ink-2">style match</span>
            </div>
          </div>
        ))}
      </div>
      {data?.plays_like.length === 0 && <p className="mt-3 text-sm text-ink-2">No close style matches found.</p>}
    </section>
  );
}

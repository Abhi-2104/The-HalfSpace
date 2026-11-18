import { useState } from "react";
import { displayName } from "../../lib/names";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { Chip, Empty, SkeletonRows } from "../list";
import { BootIcon } from "../icons";

const METRICS: [string, string][] = [
  ["npxg", "Non-penalty xG"], ["goals_np", "Non-penalty goals"], ["shots_np", "Shots"], ["xa", "Assists (xA)"],
  ["xt", "Threat created (xT)"], ["passes", "Passes"], ["pass_pct", "Pass accuracy"], ["dribbles", "Dribbles"],
  ["carries", "Carries"], ["pressures", "Pressures"], ["interceptions", "Interceptions"], ["recoveries", "Ball recoveries"],
];
const GROUPS: [string, string][] = [["", "All"], ["ATT", "Forwards"], ["MID", "Midfielders"], ["DEF", "Defenders"]];

/** The league's leaders for any metric, ranked fairly for sample size, within an optional position group. */
export function Leaders({ competitionId, seasonId }: { competitionId: number; seasonId: number }) {
  const [metric, setMetric] = useState("npxg");
  const [group, setGroup] = useState("");
  const { data, failed } = useAsync(() => api.leaders(competitionId, seasonId, metric, group, 15), [competitionId, seasonId, metric, group]);
  const top = Math.max(...(data?.players.map((p) => p.adjusted) ?? [0]), 1e-9);
  return (
    <div>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Metric">
        {METRICS.map(([k, label]) => <Chip key={k} on={metric === k} onClick={() => setMetric(k)}><span className="inline-flex items-center gap-1.5">{k === "xa" && <BootIcon size={14} />}{label}</span></Chip>)}
      </div>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Position group">
        {GROUPS.map(([k, label]) => <Chip key={k} on={group === k} onClick={() => setGroup(k)}>{label}</Chip>)}
      </div>
      <div className="mt-4 overflow-hidden rounded-2xl border border-pitch-800 bg-pitch-900">
        {!data && !failed && <SkeletonRows n={8} />}
        {failed && <Empty>Leaders are unavailable right now.</Empty>}
        {data && data.players.length === 0 && <Empty>No players qualify for this view.</Empty>}
        {data && data.players.length > 0 && (
          <ul className="divide-y divide-pitch-800">
            {data.players.map((p, i) => (
              <li key={p.player_id}>
                <Link to={`/players/${p.player_id}?competition_id=${competitionId}&season_id=${seasonId}`} className="grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,12rem)_4rem] items-center gap-3 px-4 py-3 transition-colors hover:bg-pitch-800/40">
                  <span className="text-right text-xs tabular-nums text-ink-2">{i + 1}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink-0">{displayName(p.name, p.display_name)}</span>
                    <span className="block text-xs text-ink-2">{Math.round(p.minutes).toLocaleString()} min{p.confidence < 0.6 ? " · limited sample" : ""}</span>
                  </span>
                  <span className="hidden h-2 overflow-hidden rounded-full bg-pitch-800 sm:block" aria-hidden><span className="block h-full rounded-full bg-marker" style={{ width: `${(p.adjusted / top) * 100}%` }} /></span>
                  <span className="col-start-4 text-right font-mono text-sm font-semibold tabular-nums text-marker-bright sm:col-start-auto">{p.per90 >= 10 ? p.per90.toFixed(1) : p.per90.toFixed(2)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {data && <p className="mt-2 text-xs text-ink-2">Per 90 minutes, {data.label}. Ranked {data.ranked_by}, so a few great games don't outrank a full season.</p>}
    </div>
  );
}

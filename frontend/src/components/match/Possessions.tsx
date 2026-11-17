import { useState } from "react";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { Chip } from "../list";

const KINDS = [
  ["counter", "Counterattacks", "No counterattacks in this match."],
  ["corner", "Corners", "No corners recorded for this match."],
  ["free_kick", "Free kicks", "No dangerous free kicks recorded for this match."],
] as const;

/** Counterattacks, corners and free kicks: each possession with its length, shots and chance quality. */
export function Possessions({ matchId, homeTeam }: { matchId: number; homeTeam: string }) {
  const [kind, setKind] = useState<(typeof KINDS)[number][0]>("counter");
  const { data, failed } = useAsync(() => api.possessions(matchId, kind), [matchId, kind]);
  const empty = KINDS.find((k) => k[0] === kind)![2];
  return (
    <section>
      <h2 className="font-display text-lg font-bold text-ink-0">Set pieces and counters</h2>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Type of possession">
        {KINDS.map(([k, label]) => <Chip key={k} on={kind === k} onClick={() => setKind(k)}>{label}</Chip>)}
      </div>
      <div className="mt-3 overflow-hidden rounded-2xl border border-pitch-800 bg-pitch-900">
        {!data && !failed && <div className="h-24 animate-pulse bg-pitch-800/20" />}
        {failed && <p className="px-4 py-8 text-center text-sm text-ink-2">This is unavailable right now.</p>}
        {data && data.possessions.length === 0 && <p className="px-4 py-8 text-center text-sm text-ink-2">{empty}</p>}
        {data && data.possessions.length > 0 && (
          <ul className="divide-y divide-pitch-800">
            {data.possessions.map((p, i) => (
              <li key={i} className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-sm">
                <span className="font-mono text-xs text-ink-2">{p.minute}′</span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 truncate text-ink-0"><i className={`h-2 w-2 shrink-0 rounded-full ${p.team === homeTeam ? "bg-team-a" : "bg-team-b"}`} />{p.team}</span>
                  <span className="block text-xs text-ink-2">{p.passes} passes · {p.duration_s}s{p.zone ? ` · ${p.zone}` : ""}</span>
                </span>
                <span className="text-right text-xs">
                  {p.goals > 0 && <span className="mr-2 font-semibold text-marker-bright">Goal</span>}
                  <span className="text-ink-1">{p.shots} {p.shots === 1 ? "shot" : "shots"} · <span className="font-mono tabular-nums text-ink-0">{p.xg.toFixed(2)}</span> xG</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

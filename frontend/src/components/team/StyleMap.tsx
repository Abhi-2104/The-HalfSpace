import { useMemo, useState } from "react";
import { api, type TeamStyle } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { Empty } from "../list";

const FEATURES: Record<string, string> = {
  possession: "Keeps the ball", build_up: "Builds from the back", directness: "Plays direct", width: "Uses the wings",
  territory: "Plays in the opponent's half", press_high: "Presses high", press_volume: "Presses often", carry_rate: "Carries the ball",
  shot_quality: "Quality of shots", shot_volume: "Shooting volume", set_piece_share: "Relies on set pieces",
};
const label = (k: string) => FEATURES[k] ?? k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const PALETTE = ["#4f63f0", "#ff6b1a", "#18a999", "#c2409a", "#d4a017", "#8a5cf5", "#2f9e44", "#6b7a90"];
const W = 640;
const H = 440;
const P = 38;

/** Every team of the league season placed by how it plays: teams that play alike sit close together. */
export function StyleMap({ competitionId, seasonId }: { competitionId: number; seasonId: number }) {
  const { data, failed } = useAsync(() => api.teamStyles(competitionId, seasonId), [competitionId, seasonId]);
  const [active, setActive] = useState<number | null>(null);
  const [arch, setArch] = useState<string | null>(null);

  const view = useMemo(() => {
    if (!data || data.teams.length === 0) return null;
    const xs = data.teams.map((t) => t.x), ys = data.teams.map((t) => t.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const archs = [...new Set(data.teams.map((t) => t.archetype))];
    return {
      archs,
      px: (x: number) => P + ((x - x0) / (x1 - x0 || 1)) * (W - 2 * P),
      py: (y: number) => P + ((y1 - y) / (y1 - y0 || 1)) * (H - 2 * P),
    };
  }, [data]);

  if (failed) return <Empty>The style map is unavailable right now.</Empty>;
  if (!data || !view) return <div className="mt-4 h-96 animate-pulse rounded-2xl bg-pitch-800/30" />;
  const color = (a: string) => PALETTE[view.archs.indexOf(a) % PALETTE.length];
  const sel = data.teams.find((t) => t.team_id === active) ?? null;

  return (
    <div className="mt-4 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <div className="rounded-2xl border border-pitch-800 bg-pitch-900 p-4">
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Playing styles">
          {view.archs.map((a) => (
            <button key={a} type="button" onClick={() => setArch(arch === a ? null : a)} aria-pressed={arch === a}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition-colors ${arch === a ? "border-marker bg-marker/10 text-ink-0" : "border-pitch-800 text-ink-1 hover:border-pitch-700"}`}>
              <i className="h-2.5 w-2.5 rounded-full" style={{ background: color(a) }} />{a}
            </button>
          ))}
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Map of teams by playing style">
          <rect x="1" y="1" width={W - 2} height={H - 2} rx="14" fill="var(--color-pitch-950)" fillOpacity="0.45" stroke="var(--color-pitch-800)" />
          <text x={W / 2} y={H - 10} textAnchor="middle" fontSize="10" fill="var(--color-ink-2)">Teams close together play alike</text>
          {data.teams.map((t) => {
            const dim = arch != null && t.archetype !== arch;
            const on = t.team_id === active;
            return (
              <g key={t.team_id} opacity={dim ? 0.2 : 1} style={{ cursor: "pointer" }} onClick={() => setActive(on ? null : t.team_id)} onPointerEnter={() => setActive(t.team_id)}>
                <circle cx={view.px(t.x)} cy={view.py(t.y)} r={on ? 9 : 6.5} fill={color(t.archetype)} stroke="#fff" strokeWidth={on ? 3 : 1.8} />
                <text x={view.px(t.x)} y={view.py(t.y) - 11} textAnchor="middle" fontSize={on ? 12 : 10} fontWeight={on ? 700 : 500} fill="var(--color-ink-0)" stroke="var(--color-pitch-900)" strokeWidth="3" paintOrder="stroke">{t.team}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <TeamPanel team={sel} competitionId={competitionId} seasonId={seasonId} color={sel ? color(sel.archetype) : ""} />
    </div>
  );
}

function TeamPanel({ team, competitionId, seasonId, color }: { team: TeamStyle | null; competitionId: number; seasonId: number; color: string }) {
  const sim = useAsync(() => api.similarStyles(team!.team_id, competitionId, seasonId), [team?.team_id], !!team);
  if (!team) return <div className="grid place-items-center rounded-2xl border border-dashed border-pitch-700 p-8 text-center text-sm text-ink-2">Hover or tap a team to see how it plays and which teams play most like it.</div>;
  const top = Object.entries(team.z).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5);
  return (
    <div className="rounded-2xl border border-pitch-800 bg-pitch-900 p-5">
      <h3 className="font-display text-xl font-bold text-ink-0">{team.team}</h3>
      <p className="mt-1 flex items-center gap-2 text-sm capitalize text-ink-1"><i className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />{team.archetype}</p>
      <h4 className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-2">What stands out</h4>
      <ul className="mt-2 space-y-2">
        {top.map(([k, z]) => (
          <li key={k} className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-3 text-sm">
            <span className="text-ink-0">{label(k)}</span>
            <span className="relative h-2" title={`${z > 0 ? "More" : "Less"} than most teams`}>
              <span className="absolute inset-y-0 left-1/2 w-px bg-pitch-700" />
              <span className={`absolute inset-y-0 rounded-full ${z > 0 ? "left-1/2 bg-marker" : "right-1/2 bg-warm"}`} style={{ width: `${Math.min(Math.abs(z) / 2, 1) * 50}%` }} />
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-2">Compared with all team seasons in the data. Right of centre means more than most, left means less.</p>
      <h4 className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-ink-2">Plays most like</h4>
      <ul className="mt-2 divide-y divide-pitch-800 text-sm">
        {!sim.data && !sim.failed && <li className="h-16 animate-pulse rounded-lg bg-pitch-800/30" />}
        {sim.data?.most_similar.slice(0, 5).map((m, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3 py-1.5">
            <span className="text-ink-0">{m.team}</span>
            <span className="truncate text-xs text-ink-2">{m.competition ?? ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

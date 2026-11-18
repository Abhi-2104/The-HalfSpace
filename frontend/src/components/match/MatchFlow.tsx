import { useMemo, useState, type ReactNode } from "react";
import type { Momentum } from "../../lib/api";
import { BallIcon, ChanceIcon } from "../icons";
import { displayName } from "../../lib/names";

const W = 640;
const H = 220;
const PAD = { l: 34, r: 12, t: 16, b: 26 };

/** Axis ticks that adapt to how long the data runs: every 15 minutes, on to 120 for extra time. */
const ticksFor = (n: number) => Array.from({ length: Math.floor((n - 1) / 15) + 1 }, (_, i) => i * 15);

type Team = { name: string; id: number; color: string };

function useHover(n: number) {
  const [hover, setHover] = useState<number | null>(null);
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1)))));
  };
  return { hover, onMove, clear: () => setHover(null) };
}

/** What happened around a minute: goals and big chances within a minute of it. */
const nearby = (data: Momentum, minute: number) => data.moments.filter((m) => Math.abs(m.minute - minute) <= 1);

function Tip({ left, children }: { left: number; children: ReactNode }) {
  const pct = Math.min(88, Math.max(12, (left / W) * 100));
  return (
    <div className="pointer-events-none absolute top-0 z-10 w-max max-w-[15rem] -translate-x-1/2 rounded-xl border border-pitch-800 bg-pitch-900 px-3 py-2 text-xs shadow-lg" style={{ left: `${pct}%` }}>
      {children}
    </div>
  );
}

function Moment({ m, teams }: { m: Momentum["moments"][number]; teams: Team[] }) {
  const t = teams.find((x) => x.id === m.team_id) ?? teams[1];
  return (
    <div className="mt-1 flex items-center gap-1.5 text-ink-0">
      {m.kind === "goal" ? <BallIcon size={13} ring={t.color} /> : <ChanceIcon size={12} ring={t.color} />}
      <span className="font-semibold">{m.minute}′ {m.kind === "goal" ? "Goal" : "Big chance"}</span>
      <span className="text-ink-1">{displayName(m.player, m.display_name)} · {m.xg.toFixed(2)} xG</span>
    </div>
  );
}

function Periods({ data, n, x }: { data: Momentum; n: number; x: (i: number) => number }) {
  const lines = (data.period_ends ?? [45, 90]).filter((m) => m < n - 1);
  return (
    <>
      {lines.map((m) => <line key={m} x1={x(m)} x2={x(m)} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-pitch-700)" strokeDasharray="2 4" />)}
      {n > 100 && <text x={(x(90) + x(n - 1)) / 2} y={PAD.t - 5} textAnchor="middle" fontSize="9" fill="var(--color-ink-2)">extra time</text>}
    </>
  );
}

/**
 * "Who's on top": the trailing ten minutes of threat created by each side, minute by minute.
 * Above the line the home team is on top, below it the away team. It describes what already
 * happened, it does not predict anything. Hover any minute to read it, with the goals and chances around it.
 */
export function MomentumChart({ data, home, away, homeTeamId }: { data: Momentum; home: string; away: string; homeTeamId: number }) {
  const n = data.minutes.length;
  const { hover, onMove, clear } = useHover(n);
  const teams: Team[] = [{ name: home, id: homeTeamId, color: "var(--color-team-a)" }, { name: away, id: -1, color: "var(--color-team-b)" }];
  const x = (i: number) => PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + ((100 - v) / 200) * (H - PAD.t - PAD.b);
  const mid = y(0);
  const line = useMemo(() => data.momentum.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(""), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const area = `${line}L${x(n - 1)} ${mid}L${x(0)} ${mid}Z`;
  const hv = hover != null ? data.momentum[hover] : null;
  const near = hover != null ? nearby(data, hover) : [];

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-ink-1">
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-team-a" />{home} on top</span>
        <span className="flex items-center gap-1.5">{away} on top<i className="h-2 w-2 rounded-full bg-team-b" /></span>
      </div>
      <div className="relative">
        {hover != null && hv != null && (
          <Tip left={x(hover)}>
            <div className="font-semibold text-ink-0">{hover}′ · {Math.abs(hv) < 5 ? "Even" : `${hv > 0 ? home : away} on top`}{Math.abs(hv) >= 5 && <span className="font-normal text-ink-2"> ({Math.abs(Math.round(hv))})</span>}</div>
            {near.map((m, i) => <Moment key={i} m={m} teams={teams} />)}
          </Tip>
        )}
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-8 h-auto w-full touch-none" onPointerMove={onMove} onPointerLeave={clear} role="img" aria-label={`Momentum across the match: ${home} above the line, ${away} below`}>
          <defs>
            <clipPath id="mo-up"><rect x="0" y="0" width={W} height={mid} /></clipPath>
            <clipPath id="mo-down"><rect x="0" y={mid} width={W} height={H - mid} /></clipPath>
          </defs>
          {[50, 0, -50].map((g) => (
            <g key={g}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} stroke="var(--color-pitch-800)" strokeWidth={g === 0 ? 1.4 : 1} strokeDasharray={g === 0 ? undefined : "3 4"} />
              <text x={PAD.l - 6} y={y(g) + 3.5} textAnchor="end" fontSize="9.5" fill="var(--color-ink-2)">{g === 0 ? "even" : Math.abs(g)}</text>
            </g>
          ))}
          {ticksFor(n).map((m) => <text key={m} x={x(m)} y={H - 8} textAnchor="middle" fontSize="9.5" fill="var(--color-ink-2)">{m}′</text>)}
          <Periods data={data} n={n} x={x} />
          <path d={area} fill="var(--color-team-a)" fillOpacity="0.55" clipPath="url(#mo-up)" />
          <path d={area} fill="var(--color-team-b)" fillOpacity="0.55" clipPath="url(#mo-down)" />
          <path d={line} fill="none" stroke="var(--color-ink-1)" strokeWidth="1" strokeLinejoin="round" />
          {data.moments.map((m, i) => {
            const idx = Math.min(m.minute, n - 1);
            const c = m.team_id === homeTeamId ? "var(--color-team-a)" : "var(--color-team-b)";
            const cy = y(data.momentum[idx] ?? 0);
            return m.kind === "goal" ? <BallIcon key={i} x={x(idx) - 7} y={cy - 7} width={14} height={14} ring={c} /> : <ChanceIcon key={i} x={x(idx) - 6} y={cy - 6} width={12} height={12} ring={c} />;
          })}
          {hover != null && hv != null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-ink-1)" strokeWidth="1" />
              <circle cx={x(hover)} cy={y(hv)} r="3" fill="var(--color-ink-0)" />
            </g>
          )}
        </svg>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
        <span className="flex items-center gap-1.5"><BallIcon size={13} />goal</span>
        <span className="flex items-center gap-1.5"><ChanceIcon size={13} />big chance</span>
        <span className="ml-auto text-ink-2">Hover to read any minute</span>
      </div>
    </div>
  );
}

/** Cumulative chance quality (xG) for both teams across the match. Hover any minute to read both totals. */
export function XgRace({ data, home, away, homeTeamId }: { data: Momentum; home: string; away: string; homeTeamId: number }) {
  const n = data.minutes.length;
  const { hover, onMove, clear } = useHover(n);
  const a = data.xg_cumulative.home;
  const b = data.xg_cumulative.away;
  const max = Math.max(a[n - 1] ?? 0, b[n - 1] ?? 0, 0.5) * 1.1;
  const x = (i: number) => PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - (v / max) * (H - PAD.t - PAD.b);
  const path = (s: number[]) => s.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const ticks = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5].filter((t) => t <= max).filter((_, i, arr) => arr.length <= 5 || i % 2 === 0);
  const teams: Team[] = [{ name: home, id: homeTeamId, color: "var(--color-team-a)" }, { name: away, id: -1, color: "var(--color-team-b)" }];
  const near = hover != null ? nearby(data, hover).filter((m) => m.kind === "goal") : [];
  return (
    <div>
      <div className="mb-1 flex items-center gap-4 text-xs text-ink-1">
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-team-a" />{home} {(a[n - 1] ?? 0).toFixed(2)}</span>
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-team-b" />{away} {(b[n - 1] ?? 0).toFixed(2)}</span>
      </div>
      <div className="relative">
        {hover != null && (
          <Tip left={x(hover)}>
            <div className="font-semibold text-ink-0">{hover}′</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-ink-1"><i className="h-2 w-2 rounded-full bg-team-a" />{home} <span className="font-mono text-ink-0">{(a[hover] ?? 0).toFixed(2)}</span> xG</div>
            <div className="flex items-center gap-1.5 text-ink-1"><i className="h-2 w-2 rounded-full bg-team-b" />{away} <span className="font-mono text-ink-0">{(b[hover] ?? 0).toFixed(2)}</span> xG</div>
            {near.map((m, i) => <Moment key={i} m={m} teams={teams} />)}
          </Tip>
        )}
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-12 h-auto w-full touch-none" onPointerMove={onMove} onPointerLeave={clear} role="img" aria-label="Cumulative expected goals for both teams">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--color-pitch-800)" strokeDasharray={t === 0 ? undefined : "3 4"} />
              <text x={PAD.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize="9.5" fill="var(--color-ink-2)">{t}</text>
            </g>
          ))}
          {ticksFor(n).map((m) => <text key={m} x={x(m)} y={H - 8} textAnchor="middle" fontSize="9.5" fill="var(--color-ink-2)">{m}′</text>)}
          <Periods data={data} n={n} x={x} />
          <path d={path(a)} fill="none" stroke="var(--color-team-a)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
          <path d={path(b)} fill="none" stroke="var(--color-team-b)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
          {data.moments.filter((m) => m.kind === "goal").map((m, i) => {
            const idx = Math.min(m.minute, n - 1);
            const isHome = m.team_id === homeTeamId;
            return <BallIcon key={i} x={x(idx) - 7} y={y((isHome ? a : b)[idx] ?? 0) - 7} width={14} height={14} ring={isHome ? "var(--color-team-a)" : "var(--color-team-b)"} />;
          })}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-ink-1)" strokeWidth="1" pointerEvents="none" />}
        </svg>
      </div>
      <p className="mt-1 text-xs text-ink-2">Running total of chance quality. The line that climbs faster created better chances.</p>
    </div>
  );
}

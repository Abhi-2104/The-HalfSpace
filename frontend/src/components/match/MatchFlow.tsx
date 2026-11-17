import { useMemo, useState } from "react";
import type { Momentum } from "../../lib/api";

const W = 640;
const H = 220;
const PAD = { l: 34, r: 12, t: 14, b: 26 };

/**
 * "Who's on top": the trailing ten minutes of threat created by each side, minute by minute.
 * Above the line the home team is on top, below it the away team. It describes what already
 * happened, it does not predict anything. Goals and big chances are marked on the line.
 */
export function MomentumChart({ data, home, away, homeTeamId }: { data: Momentum; home: string; away: string; homeTeamId: number }) {
  const n = data.minutes.length;
  const [hover, setHover] = useState<number | null>(null);
  const x = (i: number) => PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + ((100 - v) / 200) * (H - PAD.t - PAD.b);
  const mid = y(0);

  const line = useMemo(() => data.momentum.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(""), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const area = `${line}L${x(n - 1)} ${mid}L${x(0)} ${mid}Z`;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1)))));
  };
  const hv = hover != null ? data.momentum[hover] : null;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-ink-1">
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-team-a" />{home} on top</span>
        <span className="flex items-center gap-1.5">{away} on top<i className="h-2 w-2 rounded-full bg-team-b" /></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full touch-none" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`Momentum across the match: ${home} above the line, ${away} below`}>
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
        {[0, 15, 30, 45, 60, 75, 90].map((m) => m < n && (
          <text key={m} x={x(m)} y={H - 8} textAnchor="middle" fontSize="9.5" fill="var(--color-ink-2)">{m}′</text>
        ))}
        <line x1={x(45)} x2={x(45)} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-pitch-800)" strokeDasharray="2 4" />
        <path d={area} fill="var(--color-team-a)" fillOpacity="0.55" clipPath="url(#mo-up)" />
        <path d={area} fill="var(--color-team-b)" fillOpacity="0.55" clipPath="url(#mo-down)" />
        <path d={line} fill="none" stroke="var(--color-ink-1)" strokeWidth="1.2" strokeLinejoin="round" />

        {data.moments.map((m, i) => {
          const cx = x(Math.min(m.minute, n - 1));
          const side = m.team_id === homeTeamId;
          const cy = y(data.momentum[Math.min(m.minute, n - 1)] ?? 0);
          const c = side ? "var(--color-team-a)" : "var(--color-team-b)";
          return (
            <g key={i}>
              <title>{`${m.minute}′ ${m.kind === "goal" ? "Goal" : "Big chance"}${m.player ? `, ${m.player}` : ""} (${m.xg.toFixed(2)} xG)`}</title>
              {m.kind === "goal" ? (
                <circle cx={cx} cy={cy} r="5.5" fill="#fff" stroke={c} strokeWidth="2.5" />
              ) : (
                <path d={`M${cx} ${cy - 5}L${cx + 5} ${cy}L${cx} ${cy + 5}L${cx - 5} ${cy}Z`} fill="var(--color-pitch-900)" stroke={c} strokeWidth="2" />
              )}
            </g>
          );
        })}

        {hover != null && hv != null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-ink-1)" strokeWidth="1" />
            <circle cx={x(hover)} cy={y(hv)} r="3.5" fill="var(--color-ink-0)" />
          </g>
        )}
      </svg>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-2">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full border-2 border-ink-1 bg-white" />goal</span>
          <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rotate-45 border-2 border-ink-1" />big chance</span>
        </span>
        <span aria-live="polite" className="text-ink-1">
          {hover != null && hv != null ? `${hover}′: ${Math.abs(hv) < 5 ? "even" : `${hv > 0 ? home : away} on top`} (${Math.abs(Math.round(hv))})` : "Hover to read any minute"}
        </span>
      </div>
    </div>
  );
}

/** Cumulative chance quality (xG) for both teams across the match. */
export function XgRace({ data, home, away, homeTeamId }: { data: Momentum; home: string; away: string; homeTeamId: number }) {
  const n = data.minutes.length;
  const a = data.xg_cumulative.home;
  const b = data.xg_cumulative.away;
  const max = Math.max(a[n - 1] ?? 0, b[n - 1] ?? 0, 0.5) * 1.1;
  const x = (i: number) => PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - (v / max) * (H - PAD.t - PAD.b);
  const path = (s: number[]) => s.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const ticks = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5].filter((t) => t <= max).filter((_, i, arr) => arr.length <= 5 || i % 2 === 0);
  return (
    <div>
      <div className="mb-1 flex items-center gap-4 text-xs text-ink-1">
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-team-a" />{home} {(a[n - 1] ?? 0).toFixed(2)}</span>
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-team-b" />{away} {(b[n - 1] ?? 0).toFixed(2)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Cumulative expected goals for both teams">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--color-pitch-800)" strokeDasharray={t === 0 ? undefined : "3 4"} />
            <text x={PAD.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize="9.5" fill="var(--color-ink-2)">{t}</text>
          </g>
        ))}
        {[0, 15, 30, 45, 60, 75, 90].map((m) => m < n && <text key={m} x={x(m)} y={H - 8} textAnchor="middle" fontSize="9.5" fill="var(--color-ink-2)">{m}′</text>)}
        <path d={path(a)} fill="none" stroke="var(--color-team-a)" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
        <path d={path(b)} fill="none" stroke="var(--color-team-b)" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
        {data.moments.filter((m) => m.kind === "goal").map((m, i) => {
          const idx = Math.min(m.minute, n - 1);
          const isHome = m.team_id === homeTeamId;
          return <circle key={i} cx={x(idx)} cy={y((isHome ? a : b)[idx] ?? 0)} r="5" fill="#fff" stroke={isHome ? "var(--color-team-a)" : "var(--color-team-b)"} strokeWidth="2.5" />;
        })}
      </svg>
      <p className="mt-1 text-xs text-ink-2">Running total of chance quality. The line that climbs faster created better chances.</p>
    </div>
  );
}

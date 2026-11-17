import type { ReactNode } from "react";

/**
 * The flat pitch everything else is drawn onto: turf with mowing stripes and a
 * soft sheen, chalk markings, and a little run-off around the touchlines. It uses
 * the same grass and chalk tokens as the isometric pitch, so both read as the
 * same place, in light and dark. StatsBomb coordinates (120 x 80, attacking
 * right). Every overlay (shots, freeze-frame, pass network, heat) is a child in
 * that same space, so a shot at x=110 lands in the same spot whichever layer draws it.
 */
export const PITCH_W = 120;
export const PITCH_H = 80;

const PAD = 4; // turf run-off around the lines, in yards
const CHALK = "var(--color-grass-line)";

export function Pitch({
  children,
  half = false,
  className,
}: {
  children?: ReactNode;
  half?: boolean; // show only the attacking half (x 60 -> 120)
  className?: string;
}) {
  const xMin = half ? 60 : 0;
  const x0 = xMin - PAD;
  const w = PITCH_W - xMin + PAD * 2;
  const viewBox = `${x0} ${-PAD} ${w} ${PITCH_H + PAD * 2}`;
  // mowing stripes, one every 10 yards, covering the visible turf
  const stripes: number[] = [];
  for (let x = Math.floor(x0 / 10) * 10; x < PITCH_W + PAD; x += 10) if (Math.round(x / 10) % 2 !== 0) stripes.push(x);

  return (
    <svg viewBox={viewBox} className={className ?? "block w-full rounded-2xl"} role="img" aria-label="Football pitch">
      <defs>
        <linearGradient id="pitch-sheen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.2" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.16" />
        </linearGradient>
      </defs>
      <rect x={x0} y={-PAD} width={w} height={PITCH_H + PAD * 2} fill="var(--color-grass-1)" />
      {stripes.map((x) => (
        <rect key={x} x={x} y={-PAD} width={10} height={PITCH_H + PAD * 2} fill="var(--color-grass-2)" />
      ))}
      <rect x={x0} y={-PAD} width={w} height={PITCH_H + PAD * 2} fill="url(#pitch-sheen)" />
      <PitchMarkings xMin={xMin} />
      {children}
    </svg>
  );
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  return `M${p(a0)}A${r} ${r} 0 0 ${a1 > a0 ? 1 : 0} ${p(a1)}`;
}

function PitchMarkings({ xMin }: { xMin: number }) {
  const left = xMin === 0;
  const dot = (cx: number, cy: number) => <circle key={`${cx},${cy}`} cx={cx} cy={cy} r={0.5} fill={CHALK} stroke="none" />;
  return (
    <g stroke={CHALK} strokeWidth={0.5} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.92}>
      <rect x={xMin} y={0} width={PITCH_W - xMin} height={PITCH_H} />
      {/* the half-way line and centre circle are always on screen (x = 60) */}
      <line x1={60} y1={0} x2={60} y2={PITCH_H} />
      <circle cx={60} cy={PITCH_H / 2} r={9.15} />
      {dot(60, 40)}
      {/* right end: boxes, spot, arc, goal */}
      <rect x={102} y={18} width={18} height={44} />
      <rect x={114} y={30} width={6} height={20} />
      <path d={arc(108, 40, 9.15, Math.PI - 0.9, Math.PI + 0.9)} />
      {dot(108, 40)}
      <rect x={PITCH_W} y={36} width={2.2} height={8} strokeWidth={0.6} />
      {/* corners */}
      <path d={arc(PITCH_W, 0, 1.4, Math.PI / 2, Math.PI)} />
      <path d={arc(PITCH_W, PITCH_H, 1.4, Math.PI, Math.PI * 1.5)} />
      {left && (
        <>
          <rect x={0} y={18} width={18} height={44} />
          <rect x={0} y={30} width={6} height={20} />
          <path d={arc(12, 40, 9.15, -0.9, 0.9)} />
          {dot(12, 40)}
          <rect x={-2.2} y={36} width={2.2} height={8} strokeWidth={0.6} />
          <path d={arc(0, 0, 1.4, 0, Math.PI / 2)} />
          <path d={arc(0, PITCH_H, 1.4, -Math.PI / 2, 0)} />
        </>
      )}
    </g>
  );
}

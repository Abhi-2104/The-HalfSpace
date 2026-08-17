import type { ReactNode } from "react";

/**
 * The base pitch primitive everything else renders onto. StatsBomb coordinates
 * (120 x 80, x attacking-right). All overlays (heatmap, pass network,
 * freeze-frame, shots) are children drawn in the same coordinate space, so a
 * shot at x=110 lands in the same place regardless of which layer draws it.
 *
 * ponytail: horizontal only. A vertical/rotated pitch is a real feature but no
 * page needs it yet - add a rotation wrapper when one does, don't carry the
 * transform math speculatively.
 */
export const PITCH_W = 120;
export const PITCH_H = 80;

export function Pitch({
  children,
  half = false,
  className,
}: {
  children?: ReactNode;
  half?: boolean; // show only the attacking half (x 60->120)
  className?: string;
}) {
  const xMin = half ? 60 : 0;
  const pad = 3;
  const viewBox = `${xMin - pad} ${-pad} ${PITCH_W - xMin + pad * 2} ${PITCH_H + pad * 2}`;

  return (
    <svg viewBox={viewBox} className={className ?? "w-full"} role="img" aria-label="Football pitch">
      <PitchMarkings xMin={xMin} />
      {children}
    </svg>
  );
}

function PitchMarkings({ xMin }: { xMin: number }) {
  return (
    <g stroke="var(--color-pitch-700)" strokeWidth={0.4} fill="none">
      <rect x={xMin} y={0} width={PITCH_W - xMin} height={PITCH_H} />
      {xMin === 0 && <line x1={60} y1={0} x2={60} y2={PITCH_H} />}
      <circle cx={60} cy={PITCH_H / 2} r={9.15} />
      <circle cx={60} cy={PITCH_H / 2} r={0.4} fill="var(--color-pitch-700)" />
      {/* right goal + boxes (always visible) */}
      <rect x={102} y={18} width={18} height={44} />
      <rect x={114} y={30} width={6} height={20} />
      <rect x={120} y={36} width={1.5} height={8} />
      <circle cx={108} cy={40} r={0.4} fill="var(--color-pitch-700)" />
      {/* left goal + boxes (only on full pitch) */}
      {xMin === 0 && (
        <>
          <rect x={0} y={18} width={18} height={44} />
          <rect x={0} y={30} width={6} height={20} />
          <rect x={-1.5} y={36} width={1.5} height={8} />
          <circle cx={12} cy={40} r={0.4} fill="var(--color-pitch-700)" />
        </>
      )}
    </g>
  );
}

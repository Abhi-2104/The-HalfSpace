/**
 * The one ambient decorative element in the whole app - a faint pitch outline
 * fixed behind everything. Deliberately quiet (per frontend-design guidance:
 * spend boldness in one place) - the coverage-strip ticks are the loud
 * signature; this is atmosphere, not a second one competing for attention.
 */
export function PitchTexture() {
  return (
    <svg
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full opacity-[0.05]"
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <g stroke="var(--color-ink-0)" strokeWidth="1" fill="none">
        <line x1="600" y1="-100" x2="600" y2="900" />
        <circle cx="600" cy="400" r="130" />
        <circle cx="600" cy="400" r="3" fill="var(--color-ink-0)" />
        <rect x="-50" y="150" width="260" height="500" />
        <rect x="-50" y="280" width="90" height="240" />
        <rect x="990" y="150" width="260" height="500" />
        <rect x="1160" y="280" width="90" height="240" />
      </g>
    </svg>
  );
}

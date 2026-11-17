/**
 * A player on the pitch: a little figure (head and shoulders) standing on a ground
 * shadow, feet on the exact spot they stood. Colour is the team; the shooter gets a
 * pulsing ground ring, the keeper gloves and a GK tag. Sized in pitch yards, so it
 * scales with the pitch. Paint these in ascending y so nearer players overlap farther ones.
 */
export function PlayerMark({
  x, y, color, scale = 1, shooter = false, keeper = false, label, faded = false,
}: {
  x: number;
  y: number;
  color: string;
  scale?: number;
  shooter?: boolean;
  keeper?: boolean;
  label?: string;
  faded?: boolean;
}) {
  const s = scale;
  const w = 1.7 * s; // half shoulder width
  const top = 3.1 * s; // shoulder height above the feet
  const head = 1.12 * s;
  const body = `M${x - w} ${y}C${x - w} ${y - top * 0.8} ${x - w * 0.62} ${y - top} ${x} ${y - top}C${x + w * 0.62} ${y - top} ${x + w} ${y - top * 0.8} ${x + w} ${y}Z`;
  return (
    <g opacity={faded ? 0.45 : 1}>
      {shooter && (
        <ellipse cx={x} cy={y} rx={3.3 * s} ry={1.5 * s} fill="none" stroke="#fff" strokeWidth={0.45} opacity={0.95}>
          <animate attributeName="rx" values={`${2.6 * s};${4.2 * s};${2.6 * s}`} dur="2.2s" repeatCount="indefinite" />
          <animate attributeName="ry" values={`${1.2 * s};${1.9 * s};${1.2 * s}`} dur="2.2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.95;0.2;0.95" dur="2.2s" repeatCount="indefinite" />
        </ellipse>
      )}
      <ellipse cx={x} cy={y + 0.1 * s} rx={w * 1.15} ry={0.62 * s} fill="#04101f" opacity={0.38} />
      <path d={body} fill={color} stroke="#fff" strokeWidth={0.4} strokeLinejoin="round" />
      {/* collar line so the shoulders read as a shirt */}
      <path d={`M${x - w * 0.34} ${y - top * 0.96}Q${x} ${y - top * 0.72} ${x + w * 0.34} ${y - top * 0.96}`} fill="none" stroke="#fff" strokeWidth={0.28} opacity={0.8} />
      <circle cx={x} cy={y - top - head * 0.7} r={head} fill={shooter ? "#fff" : keeper ? "var(--color-warm)" : color} stroke={shooter ? color : "#fff"} strokeWidth={0.4} />
      {keeper && (
        <text x={x} y={y + 2.7 * s} textAnchor="middle" fontSize={1.5 * s} fontWeight={800} fill="#fff" stroke="#04101f" strokeWidth={0.35} paintOrder="stroke">
          GK
        </text>
      )}
      {label && (
        <text x={x} y={y + 2.6 * s} textAnchor="middle" fontSize={1.7} fontWeight={700} fill="#fff" stroke="#04101f" strokeWidth={0.45} paintOrder="stroke" strokeLinejoin="round">
          {label}
        </text>
      )}
    </g>
  );
}

import { motion } from "framer-motion";
import type { FreezeFrame } from "../../lib/api";

/**
 * The 360 freeze-frame: every visible player where they stood the instant a shot
 * was taken. Blue is the shooter's team, orange the defenders, the keeper is
 * marked GK, and the shooter is larger with a double ring. The warm wedge shows
 * how much of the goal the shooter could see from there, with the distance and
 * angle computed from the shot's real position. The faint dashed area is what the
 * broadcast camera could see: players outside it are simply not in the data.
 */
export function FreezeFrameLayer({ frame, ballLocation }: { frame: FreezeFrame; ballLocation?: [number, number] }) {
  const areaPoints = polygonPoints(frame.visible_area);
  const goal = ballLocation ? shotGeometry(ballLocation) : null;

  return (
    <g>
      <defs>
        <filter id="ff-shadow" x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="0.4" stdDeviation="0.4" floodColor="#04101f" floodOpacity="0.45" />
        </filter>
      </defs>

      {areaPoints && <polygon points={areaPoints} fill="#fff" fillOpacity={0.07} stroke="#fff" strokeOpacity={0.35} strokeWidth={0.25} strokeDasharray="1.2 1" />}

      {goal && (
        <g>
          <polygon points={`${goal.x},${goal.y} 120,36 120,44`} fill="var(--color-warm)" fillOpacity={0.24} stroke="var(--color-warm)" strokeWidth={0.35} strokeDasharray="1.2 1" />
          <line x1={goal.x} y1={goal.y} x2={120} y2={40} stroke="var(--color-warm)" strokeWidth={0.5} strokeDasharray="1.4 1.1" strokeLinecap="round" />
        </g>
      )}

      {frame.freeze_frame.map((p, i) => {
        const [x, y] = p.location;
        const color = p.teammate ? "var(--color-team-a)" : "var(--color-team-b)";
        const r = p.actor ? 1.9 : 1.5;
        return (
          <motion.g
            key={i}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35, delay: i * 0.025, ease: [0.34, 1.56, 0.64, 1] }}
            style={{ transformOrigin: `${x}px ${y}px` }}
            filter="url(#ff-shadow)"
          >
            {p.actor && <circle cx={x} cy={y} r={r + 1.5} fill="none" stroke="#fff" strokeWidth={0.45} />}
            <circle cx={x} cy={y} r={r} fill={color} stroke="#fff" strokeWidth={p.keeper ? 0.7 : 0.45} />
            {p.keeper && (
              <text x={x} y={y + 0.5} textAnchor="middle" fontSize={1.4} fontWeight={700} fill="#fff" style={{ pointerEvents: "none" }}>
                GK
              </text>
            )}
            {p.actor && <circle cx={x} cy={y} r={0.55} fill="#fff" />}
          </motion.g>
        );
      })}

      {goal && (
        <g style={{ pointerEvents: "none" }}>
          <rect x={goal.labelX - goal.labelW / 2} y={goal.labelY - 2} width={goal.labelW} height={3.6} rx={1.8} fill="var(--color-warm)" />
          <text x={goal.labelX} y={goal.labelY + 0.55} textAnchor="middle" fontSize={2} fontWeight={700} fill="#14213d">
            {goal.text}
          </text>
        </g>
      )}
    </g>
  );
}

/** Distance to the middle of the goal and the angle of goal in view, from the shot's position (yards). */
function shotGeometry([x, y]: [number, number]) {
  const dist = Math.hypot(120 - x, 40 - y);
  const ang = Math.abs(Math.atan2(44 - y, 120 - x) - Math.atan2(36 - y, 120 - x)) * (180 / Math.PI);
  const text = `${dist.toFixed(0)} yd · ${ang.toFixed(0)}° of goal in view`;
  const labelW = text.length * 1.05 + 3;
  // pinned in the run-off strip above the touchline, where it covers no player
  return { x, y, text, labelW, labelX: 90, labelY: -1.9 };
}

function polygonPoints(area: number[]): string | null {
  if (!area || area.length < 6) return null;
  const pts: string[] = [];
  for (let i = 0; i + 1 < area.length; i += 2) pts.push(`${area[i]},${area[i + 1]}`);
  return pts.join(" ");
}

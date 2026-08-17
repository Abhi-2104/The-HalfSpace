import { motion } from "framer-motion";
import type { FreezeFrame } from "../../lib/api";

/**
 * The 360 freeze-frame: every visible player as a dot at their real position
 * the instant a shot was taken. Teammates (of the shooter) in amber, opponents
 * in blue, keeper ringed, the shooter (actor) larger. The visible-area polygon
 * is drawn faint so the viewer knows the camera didn't see the whole pitch -
 * honesty about coverage, same principle as the coverage strip.
 */
export function FreezeFrameLayer({ frame, ballLocation }: { frame: FreezeFrame; ballLocation?: [number, number] }) {
  const areaPoints = polygonPoints(frame.visible_area);
  return (
    <g>
      {areaPoints && <polygon points={areaPoints} fill="var(--color-ink-0)" opacity={0.04} />}

      {frame.freeze_frame.map((p, i) => {
        const color = p.teammate ? "var(--color-marker-bright)" : "var(--color-info)";
        const r = p.actor ? 2 : 1.4;
        return (
          <motion.g
            key={i}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25, delay: i * 0.015, ease: "backOut" }}
            style={{ transformOrigin: `${p.location[0]}px ${p.location[1]}px` }}
          >
            {p.keeper && <circle cx={p.location[0]} cy={p.location[1]} r={r + 1} fill="none" stroke={color} strokeWidth={0.4} />}
            {p.actor && <circle cx={p.location[0]} cy={p.location[1]} r={r + 1.2} fill="none" stroke={color} strokeWidth={0.5} />}
            <circle cx={p.location[0]} cy={p.location[1]} r={r} fill={color} />
          </motion.g>
        );
      })}

      {ballLocation && (
        <circle cx={ballLocation[0]} cy={ballLocation[1]} r={1.1} fill="var(--color-ink-0)" stroke="var(--color-pitch-950)" strokeWidth={0.4} />
      )}
    </g>
  );
}

function polygonPoints(area: number[]): string | null {
  if (!area || area.length < 6) return null;
  const pts: string[] = [];
  for (let i = 0; i + 1 < area.length; i += 2) pts.push(`${area[i]},${area[i + 1]}`);
  return pts.join(" ");
}

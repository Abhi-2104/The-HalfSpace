import { motion } from "framer-motion";
import type { Shot } from "../lib/api";

/**
 * StatsBomb pitch: 120x80 units, origin top-left. Verified against real data
 * (WC2022 final) that x is already recorded relative to each team's own
 * attacking direction - both teams' shots cluster near x=120, not split
 * across both ends by physical pitch side. So this crops to the attacking
 * third (x=70-120), the standard shot-map convention, rather than wasting
 * half the canvas on an empty defensive half.
 */
const X_MIN = 70;
const X_MAX = 120;
const H = 80;

export function PitchShotMap({ shots, homeTeamId }: { shots: Shot[]; homeTeamId: number }) {
  return (
    <svg viewBox={`${X_MIN - 3} -4 ${X_MAX - X_MIN + 6} ${H + 8}`} className="w-full" role="img" aria-label="Shot map">
      <g stroke="var(--color-pitch-700)" strokeWidth={0.4} fill="none">
        <rect x={X_MIN} y={0} width={X_MAX - X_MIN} height={H} />
        <circle cx={X_MIN} cy={H / 2} r={9.15} />
        <rect x={102} y={18} width={18} height={44} />
        <rect x={114} y={30} width={6} height={20} />
        <rect x={X_MAX} y={36} width={1.5} height={8} />
      </g>

      {shots.map((s, i) => {
        const isGoal = s.outcome_name === "Goal";
        const isHome = s.team_id === homeTeamId;
        const color = isHome ? "var(--color-marker-bright)" : "var(--color-info)";
        return (
          <motion.g
            key={s.id}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, delay: i * 0.02, ease: "backOut" }}
            style={{ transformOrigin: `${s.x}px ${s.y}px` }}
          >
            {isGoal && <circle cx={s.x} cy={s.y} r={2.6} fill="none" stroke={color} strokeWidth={0.5} />}
            <circle cx={s.x} cy={s.y} r={isGoal ? 1.7 : 1.1} fill={color} opacity={isGoal ? 1 : 0.6}>
              <title>
                {s.player_name ?? "Unknown"} ({s.team_name}) — {s.outcome_name}, {s.minute}'{s.second}"
              </title>
            </circle>
          </motion.g>
        );
      })}
    </svg>
  );
}

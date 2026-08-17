import { motion } from "framer-motion";
import type { ShotXg } from "../../lib/api";

/**
 * xG shot map: dot area scales with xG (our own xG-lite model), goals ringed,
 * home team amber / away blue. A shot with a 360 freeze-frame is clickable
 * (subtle ring cue) - clicking asks "what made this chance?".
 */
export function ShotMapLayer({
  shots,
  homeTeamId,
  selectedId,
  onSelect,
}: {
  shots: ShotXg[];
  homeTeamId: number;
  selectedId?: string | null;
  onSelect?: (shot: ShotXg) => void;
}) {
  return (
    <g>
      {shots.map((s, i) => {
        if (s.x == null) return null;
        const isGoal = s.outcome_name === "Goal";
        const isHome = s.team_id === homeTeamId;
        const color = isHome ? "var(--color-marker-bright)" : "var(--color-info)";
        // radius from xG: sqrt so AREA scales with xG, floor so tiny chances stay visible
        const r = 0.9 + Math.sqrt(s.xg ?? 0.05) * 3.2;
        const clickable = s.has_freeze_frame && onSelect;
        const selected = selectedId === s.id;
        return (
          <motion.g
            key={s.id}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, delay: i * 0.02, ease: "backOut" }}
            style={{ transformOrigin: `${s.x}px ${s.y}px`, cursor: clickable ? "pointer" : "default" }}
            onClick={clickable ? () => onSelect!(s) : undefined}
          >
            {isGoal && <circle cx={s.x} cy={s.y} r={r + 1} fill="none" stroke={color} strokeWidth={0.4} />}
            {selected && <circle cx={s.x} cy={s.y} r={r + 2} fill="none" stroke="var(--color-ink-0)" strokeWidth={0.5} />}
            <circle cx={s.x} cy={s.y} r={r} fill={color} opacity={isGoal ? 1 : 0.55} />
            {s.has_freeze_frame && !isGoal && (
              <circle cx={s.x} cy={s.y} r={r} fill="none" stroke={color} strokeWidth={0.3} opacity={0.9} />
            )}
            <title>
              {s.player_name ?? "Unknown"} ({s.team_name}) — {s.outcome_name}
              {s.xg != null ? `, xG ${s.xg.toFixed(2)}` : ""}, {s.minute}'{s.second}"
              {s.has_freeze_frame ? " · click for freeze-frame" : ""}
            </title>
          </motion.g>
        );
      })}
    </g>
  );
}

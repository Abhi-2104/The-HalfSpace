import { motion } from "framer-motion";
import type { ShotXg } from "../../lib/api";

/**
 * xG shot map. Dot area scales with xG (our own xG-lite model). Blue is the home
 * team, orange the away team. Dots have a chalk-white edge and a soft shadow so
 * they read on the turf. A goal gets a white ring and a white centre. A shot with
 * a 360 freeze-frame is clickable: a ring appears on hover, and the selected shot
 * keeps a bold ring, so "click to see everyone" is discoverable.
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
      <defs>
        <filter id="shot-shadow" x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="0.35" stdDeviation="0.35" floodColor="#04101f" floodOpacity="0.4" />
        </filter>
      </defs>
      {shots.map((s, i) => {
        if (s.x == null) return null;
        const isGoal = s.outcome_name === "Goal";
        const color = s.team_id === homeTeamId ? "var(--color-team-a)" : "var(--color-team-b)";
        // radius from xG: sqrt so AREA scales with xG, floor so tiny chances stay visible
        const r = 1 + Math.sqrt(s.xg ?? 0.05) * 3.4;
        const clickable = !!(s.has_freeze_frame && onSelect);
        const selected = selectedId === s.id;
        return (
          <motion.g
            key={s.id}
            className="shot-dot"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35, delay: i * 0.02, ease: [0.34, 1.56, 0.64, 1] }}
            style={{ transformOrigin: `${s.x}px ${s.y}px`, cursor: clickable ? "pointer" : "default" }}
            onClick={clickable ? () => onSelect!(s) : undefined}
          >
            {clickable && <circle className="shot-hover-ring" cx={s.x} cy={s.y} r={r + 1.5} fill="none" stroke="#fff" strokeWidth={0.5} />}
            {selected && <circle cx={s.x} cy={s.y} r={r + 1.9} fill="none" stroke="#fff" strokeWidth={0.8} />}
            <g filter="url(#shot-shadow)">
              {isGoal && <circle cx={s.x} cy={s.y} r={r + 1} fill="none" stroke="#fff" strokeWidth={0.55} />}
              <circle cx={s.x} cy={s.y} r={r} fill={color} fillOpacity={isGoal ? 1 : 0.8} stroke="#fff" strokeWidth={isGoal ? 0.5 : 0.35} />
              {isGoal && <circle cx={s.x} cy={s.y} r={Math.max(0.5, r * 0.32)} fill="#fff" />}
            </g>
            <title>
              {s.player_name ?? "Unknown"} ({s.team_name}) — {s.outcome_name}
              {s.xg != null ? `, xG ${s.xg.toFixed(2)}` : ""}, {s.minute}'{s.second}"
              {clickable ? " · click for freeze-frame" : ""}
            </title>
          </motion.g>
        );
      })}
    </g>
  );
}

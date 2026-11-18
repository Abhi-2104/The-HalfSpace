import { motion } from "framer-motion";
import { displayName } from "../../lib/names";
import type { ShotXg } from "../../lib/api";
import { BallIcon } from "../icons";

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
            {selected && <circle cx={s.x} cy={s.y} r={r + 2.1} fill="none" stroke="#fff" strokeWidth={1} />}
            <g filter="url(#shot-shadow)">
              <circle cx={s.x} cy={s.y} r={r} fill={color} fillOpacity={isGoal ? 1 : 0.8} stroke="#fff" strokeWidth={isGoal ? 0.55 : 0.35} />
              {isGoal && <BallIcon x={s.x - Math.max(1.3, r * 0.6)} y={s.y - Math.max(1.3, r * 0.6)} width={Math.max(2.6, r * 1.2)} height={Math.max(2.6, r * 1.2)} />}
            </g>
            <title>
              {displayName(s.player_name, s.display_name)} ({s.team_name}) — {s.outcome_name}
              {s.xg != null ? `, xG ${s.xg.toFixed(2)}` : ""}, {s.minute}'{s.second}"
              {clickable ? " · click for freeze-frame" : ""}
            </title>
          </motion.g>
        );
      })}
      {(() => {
        // the chosen shot's label is drawn last, so no other dot can cover it
        const s = shots.find((x) => x.id === selectedId);
        if (!s || s.x == null) return null;
        const r = 1 + Math.sqrt(s.xg ?? 0.05) * 3.4;
        const text = `${displayName(s.player_name, s.display_name)}${s.xg != null ? ` · ${s.xg.toFixed(2)} xG` : ""}`;
        const w = text.length * 1.35 + 4;
        const cx = Math.min(116 - w / 2, Math.max(4 + w / 2, s.x)); // kept inside the pitch
        const y = s.y - r - 3.2 < 3 ? s.y + r + 6 : s.y - r - 3.2; // below the dot when near the top edge
        return (
          <g style={{ pointerEvents: "none" }}>
            <rect x={cx - w / 2} y={y - 3.4} width={w} height={5} rx={2.5} fill="var(--color-ink-0)" />
            <text x={cx} y={y} textAnchor="middle" fontSize={2.5} fontWeight={700} fill="var(--color-pitch-950)">{text}</text>
          </g>
        );
      })()}
    </g>
  );
}

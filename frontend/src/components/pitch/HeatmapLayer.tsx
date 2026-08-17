import type { Heatmap } from "../../lib/api";
import { PITCH_W, PITCH_H } from "./Pitch";

/**
 * Sequential single-hue heatmap (amber ramp) - magnitude encoding, so one hue
 * light->dark, never a rainbow (dataviz sequential rule). Cells below a floor
 * are omitted so the empty pitch reads as "nothing here", not "dark = zero".
 */
export function HeatmapLayer({ heatmap }: { heatmap: Heatmap }) {
  const { grid, bins_x, bins_y, peak } = heatmap;
  if (!peak) return null;
  const cw = PITCH_W / bins_x;
  const ch = PITCH_H / bins_y;

  return (
    <g>
      {grid.flatMap((row, by) =>
        row.map((count, bx) => {
          if (count === 0) return null;
          const t = count / peak; // 0..1
          // light -> dark amber ramp; opacity carries low end so the pitch shows through
          const opacity = 0.12 + t * 0.7;
          return (
            <rect
              key={`${bx}-${by}`}
              x={bx * cw}
              y={by * ch}
              width={cw}
              height={ch}
              fill="var(--color-marker)"
              opacity={opacity}
            />
          );
        })
      )}
    </g>
  );
}

import type { Heatmap } from "../../lib/api";
import { PITCH_W, PITCH_H } from "./Pitch";

/**
 * Touch heat map on the turf. One warm hue from faint to strong (magnitude, never
 * a rainbow), softened with a blur so it reads as a smooth surface instead of
 * blocks. Empty cells are left out, so an empty part of the pitch reads as
 * "nothing here" and not "low".
 */
export function HeatmapLayer({ heatmap }: { heatmap: Heatmap }) {
  const { grid, bins_x, bins_y, peak } = heatmap;
  if (!peak) return null;
  const cw = PITCH_W / bins_x;
  const ch = PITCH_H / bins_y;

  return (
    <g>
      <defs>
        <filter id="heat-soft" x="-5%" y="-5%" width="110%" height="110%">
          <feGaussianBlur stdDeviation={Math.min(cw, ch) * 0.55} />
        </filter>
      </defs>
      {/* a soft dark veil so the heat stands out from the turf instead of blending into it */}
      <rect x={0} y={0} width={PITCH_W} height={PITCH_H} fill="#06241a" opacity={0.3} />
      <g filter="url(#heat-soft)">
        {grid.flatMap((row, by) =>
          row.map((count, bx) => {
            if (count === 0) return null;
            const t = count / peak; // 0..1
            const cell = { x: bx * cw, y: by * ch, width: cw, height: ch };
            return (
              <g key={`${bx}-${by}`}>
                <rect {...cell} fill="var(--color-warm)" opacity={0.12 + Math.pow(t, 0.8) * 0.78} />
                {t > 0.45 && <rect {...cell} fill="#ffd166" opacity={Math.pow((t - 0.45) / 0.55, 1.6) * 0.85} />}
              </g>
            );
          }),
        )}
      </g>
    </g>
  );
}

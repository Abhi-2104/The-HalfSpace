import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";

const NAMES: Record<string, string> = {
  angle: "Angle to goal",
  dist: "Distance from goal",
  n_def_cone: "Defenders in the way",
  n_team_vis: "Teammates in view",
  play_pattern: "How the move began",
  body_part: "Body part used",
  gk_dist: "Keeper's distance",
  shot_type: "Type of shot",
};
const pretty = (f: string) => NAMES[f] ?? f.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const fmt = (f: string, v: number | string) => {
  if (typeof v === "string") return v;
  if (f === "dist") return `${v.toFixed(0)} yd`;
  if (f === "angle") return `${Math.round(v * (180 / Math.PI))}° of goal`;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
};

/** Which things about the shot raised or lowered its chance quality. Approximate: each factor is tested on its own. */
export function WhyXg({ eventId }: { eventId: string }) {
  const { data, failed } = useAsync(() => api.xgExplain(eventId), [eventId]);
  if (failed) return null;
  if (!data) return <div className="mt-4 h-28 animate-pulse rounded-2xl bg-pitch-800/30" />;
  const factors = [...data.factors].sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect)).filter((f) => Math.abs(f.effect) >= 0.005).slice(0, 5);
  if (factors.length === 0) return null;
  const max = Math.max(...factors.map((f) => Math.abs(f.effect)));
  return (
    <div className="mt-4 rounded-2xl border border-pitch-800 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-semibold text-ink-0">Why this chance is rated {data.xg.toFixed(2)}</h4>
        <span className="rounded-full bg-pitch-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-2">Approximate</span>
      </div>
      <ul className="mt-3 space-y-2.5">
        {factors.map((f) => {
          const up = f.effect > 0;
          return (
            <li key={f.feature} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3 text-sm">
              <span className="min-w-0"><span className="text-ink-0">{pretty(f.feature)}</span> <span className="text-xs text-ink-2">{fmt(f.feature, f.value)}</span></span>
              <span className="relative h-2.5" title={`${up ? "Raises" : "Lowers"} the rating by about ${Math.abs(f.effect).toFixed(2)}`}>
                <span className="absolute inset-y-0 left-1/2 w-px bg-pitch-700" />
                <span className={`absolute inset-y-0 rounded-full ${up ? "left-1/2 bg-marker" : "right-1/2 bg-warm"}`} style={{ width: `${(Math.abs(f.effect) / max) * 50}%` }} />
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-ink-2">Bars to the right raise the rating, bars to the left lower it. Each factor is tested on its own, so treat the sizes as a guide. <Link to="/how-it-works#xg_v2" className="text-marker-bright hover:underline">How is this calculated?</Link></p>
    </div>
  );
}

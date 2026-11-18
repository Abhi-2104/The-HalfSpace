import type { ScoutingCard as Card } from "../../lib/api";
import { Link } from "react-router-dom";
import { useMode } from "../../lib/mode";
import { BootIcon } from "../icons";

const GROUPS: Record<string, string> = { ATT: "forwards", MID: "midfielders", DEF: "defenders", GK: "goalkeepers" };
const tone = (p: number) => (p >= 75 ? "bg-marker" : p >= 40 ? "bg-marker/55" : "bg-pitch-700");
const unit = (m: string, v: number) => (m === "pass_pct" ? `${v.toFixed(0)}%` : v >= 10 ? v.toFixed(1) : v.toFixed(2));

/** A scouting card: how the player ranks, per metric, against others in the same league season and position group. */
export function ScoutingCardView({ card }: { card: Card }) {
  const { mode } = useMode();
  const group = GROUPS[card.position_group] ?? "players in the same position group";
  const limited = card.confidence < 0.6;
  return (
    <section className="rounded-2xl border border-pitch-800 bg-pitch-900 p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-xl font-bold text-ink-0">Scouting card</h2>
        {card.role && <span className="rounded-full bg-marker/12 px-3 py-1 text-xs font-medium text-marker-bright">{card.role}</span>}
        {limited && <span className="rounded-full bg-clay/15 px-3 py-1 text-xs font-medium text-clay" title="Few minutes played, so these numbers can move a lot.">Limited sample</span>}
      </div>
      <p className="mt-2 max-w-2xl text-sm text-ink-1">
        Each bar shows where this player ranks among {card.pool_size} {group} in the same league and season. A full bar means the best of the group.
      </p>

      <ul className="mt-5 grid gap-x-10 gap-y-3.5 md:grid-cols-2">
        {card.metrics.map((m) => (
          <li key={m.metric}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="inline-flex items-center gap-1.5 text-ink-0">{m.metric === "xa" && <BootIcon size={15} />}{m.label}</span>
              <span className="flex items-baseline gap-2">
                {mode === "analyst" && <span className="font-mono text-xs text-ink-2">{unit(m.metric, m.per90)} /90</span>}
                <span className="font-mono text-xs font-semibold tabular-nums text-ink-0" title="Percentile within the same league season and position group">{Math.round(m.percentile)}</span>
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-pitch-800" role="img" aria-label={`${m.label}: ${Math.round(m.percentile)}th percentile`}>
              <div className={`h-full rounded-full ${tone(m.percentile)}`} style={{ width: `${Math.max(2, m.percentile)}%` }} />
            </div>
          </li>
        ))}
      </ul>

      {(card.passing || card.on_ball_value) && (
        <div className="mt-6 grid gap-4 border-t border-pitch-800 pt-5 sm:grid-cols-2">
          {card.on_ball_value && (
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">Impact on the ball</h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-1">
                Ranks in the top <span className="font-semibold text-ink-0">{Math.max(1, Math.round(100 - card.on_ball_value.percentile))}%</span> of the group for how much their actions with the ball raise the team's chances.
              </p>
            </div>
          )}
          {card.passing && (
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">Passing against difficulty</h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-1">
                Completed <span className="font-semibold text-ink-0">{card.passing.actual_pct.toFixed(0)}%</span> of {card.passing.passes.toLocaleString()} passes, against {card.passing.expected_pct.toFixed(0)}% expected for passes that hard
                {card.passing.poe_per100 >= 0 ? ", so they beat the odds" : ", so slightly below the odds"} ({card.passing.poe_per100 >= 0 ? "+" : ""}{card.passing.poe_per100.toFixed(1)} per 100).
                {card.passing.line_breaks_per_100_passes != null && <> Breaks a defensive line {card.passing.line_breaks_per_100_passes.toFixed(1)} times per 100 passes.</>}
              </p>
            </div>
          )}
        </div>
      )}
      <p className="mt-5 text-xs text-ink-2">
        {card.minutes.toLocaleString()} minutes played. Percentiles compare players within one league season and position, so they can't be compared across leagues. <Link to="/how-it-works#profiles" className="text-marker-bright hover:underline">How is this calculated?</Link>
      </p>
    </section>
  );
}

import type { ShotXg } from "../../lib/api";
import { displayName } from "../../lib/names";
import { BallIcon, ChanceIcon } from "../icons";

/** The chosen shot, large: who, when, what happened and how good a chance it was. */
export function SelectedShot({ shot, home }: { shot: ShotXg; home: boolean }) {
  const goal = shot.outcome_name === "Goal";
  const ring = home ? "var(--color-team-a)" : "var(--color-team-b)";
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-pitch-800 bg-pitch-950/40 p-4">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-pitch-900">
        {goal ? <BallIcon size={32} ring={ring} /> : <ChanceIcon size={30} ring={ring} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-xl font-extrabold leading-tight tracking-tight text-ink-0">{displayName(shot.player_name, shot.display_name)}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-ink-1">
          <i className={`h-2.5 w-2.5 rounded-full ${home ? "bg-team-a" : "bg-team-b"}`} />
          <span>{shot.team_name}</span><span className="text-ink-2">·</span>
          <span className="font-mono">{shot.minute}′</span><span className="text-ink-2">·</span>
          <span className={goal ? "font-semibold text-ink-0" : ""}>{shot.outcome_name}</span>
        </div>
      </div>
      {shot.xg != null && (
        <div className="shrink-0 text-right">
          <div className="font-display text-3xl font-extrabold leading-none text-marker-bright">{shot.xg.toFixed(2)}</div>
          <div className="mt-1 text-[11px] uppercase tracking-wider text-ink-2">xG</div>
        </div>
      )}
    </div>
  );
}

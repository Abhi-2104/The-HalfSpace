import { useEffect, useState } from "react";
import { AnimatePresence, motion, useMotionValue } from "framer-motion";
import { api, type ShotXg, type FreezeFrame } from "../../lib/api";
import { IsoPitch } from "../iso/IsoPitch";
import { Pitch } from "./Pitch";
import { ShotMapLayer } from "./ShotMapLayer";
import { FreezeFrameLayer } from "./FreezeFrameLayer";
import { MetricInfo } from "../MetricInfo";

/**
 * The signature "what made this chance?" interaction. Left: xG shot map for the
 * whole match. Click a shot that has 360 -> right pane shows the freeze-frame
 * (every player's real position that instant) + a plain-language read of the
 * chance. This is the X-factor moment - real spatial data, free.
 */
export function ShotExplorer({ matchId, homeTeamId, homeTeam, awayTeam }: {
  matchId: number;
  homeTeamId: number;
  homeTeam: string;
  awayTeam: string;
}) {
  const [shots, setShots] = useState<ShotXg[] | null>(null);
  const [selected, setSelected] = useState<ShotXg | null>(null);
  const [frame, setFrame] = useState<FreezeFrame | null>(null);
  const [loadingFrame, setLoadingFrame] = useState(false);
  const [view, setView] = useState<"map" | "3d">("map");
  const isoProgress = useMotionValue(0.58); // isometric camera, leaning toward the attacking third

  useEffect(() => {
    api.shotsXg(matchId).then((r) => setShots(r.shots)).catch(() => setShots([]));
  }, [matchId]);

  function pick(shot: ShotXg) {
    setSelected(shot);
    setFrame(null);
    setLoadingFrame(true);
    api.freezeFrame(shot.id).then(setFrame).catch(() => setFrame(null)).finally(() => setLoadingFrame(false));
  }

  const anyFreeze = shots?.some((s) => s.has_freeze_frame);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="rounded-2xl border border-pitch-800 bg-pitch-900 p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="font-display text-lg font-bold text-ink-0">Shot map</h3>
          <div className="flex items-center gap-3">
            <span className="flex items-center text-xs text-ink-2">{view === "map" ? "dot size = xG" : "height = xG"}<MetricInfo metric="xg" /></span>
            <div className="flex rounded-full border border-pitch-800 p-0.5 text-xs font-medium" role="group" aria-label="Shot map view">
              {([["map", "Map"], ["3d", "3D"]] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={`rounded-full px-3 py-1 transition-colors ${view === v ? "bg-marker text-on-accent" : "text-ink-1 hover:text-ink-0"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {shots ? (
          view === "map" ? (
            <Pitch>
              <ShotMapLayer shots={shots} homeTeamId={homeTeamId} selectedId={selected?.id} onSelect={pick} />
            </Pitch>
          ) : (
            <div className="overflow-hidden rounded-xl">
              <IsoPitch shots={shots} homeTeamId={homeTeamId} progress={isoProgress} onSelect={pick} />
            </div>
          )
        ) : (
          <div className="aspect-[3/2]" />
        )}
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-1">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-team-a" /> {homeTeam}</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-team-b" /> {awayTeam}</span>
          <span className="text-ink-2">{view === "map" ? "ring = goal" : "ringed top = goal"}</span>
          {anyFreeze && <span className="text-marker-bright">{view === "map" ? "click a hollow-ringed shot" : "click a column"} to see everyone</span>}
        </div>
      </div>

      <div className="rounded-2xl border border-pitch-800 bg-pitch-900 p-4">
        <h3 className="mb-2 font-display text-lg font-bold text-ink-0">What made this chance?</h3>
        <AnimatePresence mode="wait">
          {!selected && (
            <motion.p key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="pt-16 text-center text-sm text-ink-2">
              {anyFreeze
                ? "Pick a shot on the left to see exactly where every player stood the moment it was taken."
                : "This match has no 360 freeze-frame data — pick a match from a tournament that does (World Cup 2022, Euro 2024, Copa América 2024, Women's Euro 2025)."}
            </motion.p>
          )}
          {selected && (
            <motion.div key={selected.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {loadingFrame && <div className="aspect-[3/2]" />}
              {frame && (
                <Pitch half>
                  <FreezeFrameLayer frame={frame} ballLocation={selected.x != null ? [selected.x, selected.y] : undefined} />
                </Pitch>
              )}
              {!loadingFrame && !frame && <p className="pt-12 text-center text-sm text-clay">No freeze-frame for this shot.</p>}
              <p className="mt-3 text-sm text-ink-1">
                <span className="text-ink-0">{selected.player_name}</span> ({selected.team_name}),{" "}
                {selected.minute}'{selected.second}" — {selected.outcome_name}
                {selected.xg != null && <>, <span className="text-marker-bright">xG {selected.xg.toFixed(2)}</span></>}.
                {" "}White dot = ball. Blue = shooter's team, orange = defenders, ringed = keeper.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

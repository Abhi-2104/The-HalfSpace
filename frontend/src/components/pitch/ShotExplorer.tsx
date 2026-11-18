import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useMotionValue } from "framer-motion";
import { api, type ShotXg, type FreezeFrame } from "../../lib/api";
import { IsoPitch, REST } from "../iso/IsoPitch";
import { Pitch } from "./Pitch";
import { ShotMapLayer } from "./ShotMapLayer";
import { FreezeFrameLayer } from "./FreezeFrameLayer";
import { MetricInfo } from "../MetricInfo";
import { BallIcon, ChanceIcon } from "../icons";
import { SelectedShot } from "./SelectedShot";
import { WhyXg } from "../match/WhyXg";
import { ExpandedView } from "./ExpandedView";

/**
 * The signature "what made this chance?" interaction. Left: xG shot map for the
 * whole match. Click a shot that has 360 -> right pane shows the freeze-frame
 * (every player's real position that instant) + a plain-language read of the
 * chance. This is the X-factor moment - real spatial data, free.
 */
// the settled 3D view sits a little right and low in its frame; nudge it to the middle and fill the card better
const HOME = { zoom: 1, ox: -28, oy: 0 };

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
  const [expanded, setExpanded] = useState(false);
  const isoProgress = useMotionValue(REST); // the settled isometric camera, framed to fit the whole pitch

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
  // quick picks: every goal that has a freeze-frame, or else the biggest chances that do (any match, any data)
  const quickPicks = useMemo(() => {
    const framed = (shots ?? []).filter((s) => s.has_freeze_frame);
    const goals = framed.filter((s) => s.outcome_name === "Goal").sort((a, b) => a.minute - b.minute);
    const list = goals.length ? goals : [...framed].sort((a, b) => (b.xg ?? 0) - (a.xg ?? 0)).slice(0, 5);
    return list.slice(0, 8).map((shot) => ({ shot, goal: shot.outcome_name === "Goal" }));
  }, [shots]);

  return (
    <>
    <ExpandedView open={expanded} onClose={() => setExpanded(false)} shots={shots} homeTeamId={homeTeamId} homeTeam={homeTeam} awayTeam={awayTeam}
      progress={isoProgress} selected={selected} frame={frame} loadingFrame={loadingFrame} onPick={pick} />
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-start">
      <div className="rounded-2xl border border-pitch-800 bg-pitch-900 p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="font-display text-lg font-bold text-ink-0">Shot map</h3>
          <div className="flex items-center gap-3">
            {view === "3d" && (
              <button type="button" onClick={() => setExpanded(true)} aria-label="Expand the 3D view" className="flex items-center gap-1.5 rounded-full border border-pitch-800 px-3 py-1 text-xs font-medium text-ink-1 transition-colors hover:border-marker hover:text-ink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
                Expand
              </button>
            )}
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
        {/* one stage for both views, so switching never changes the card's height */}
        <div className={`flex aspect-[128/88] items-center justify-center overflow-hidden rounded-2xl ${view === "3d" ? "bg-pitch-950/40" : ""}`}>
          {shots ? (
            view === "map" ? (
              <Pitch>
                <ShotMapLayer shots={shots} homeTeamId={homeTeamId} selectedId={selected?.id} onSelect={pick} />
              </Pitch>
            ) : (
              <IsoPitch shots={shots} homeTeamId={homeTeamId} progress={isoProgress} onSelect={pick} interactive home={HOME} className="w-full" />
            )
          ) : (
            <div className="h-full w-full animate-pulse rounded-2xl bg-pitch-800/40" aria-label="Loading shots" />
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-1">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-team-a" /> {homeTeam}</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-team-b" /> {awayTeam}</span>
          <span className="flex items-center gap-1 text-ink-2"><BallIcon size={14} />goal</span>
          {view === "3d" && <span className="text-ink-2">+/− or pinch to zoom, drag to turn, shift-drag to pan</span>}
          {anyFreeze && <span className="text-marker-bright">{view === "map" ? "select a shot with a ring" : "select a column"} to see every player</span>}
        </div>
        {quickPicks.length > 0 && (
          <div className="mt-4 border-t border-pitch-800 pt-3">
            <p className="mb-2 text-xs text-ink-2">{quickPicks[0].goal ? "Jump to a goal" : "Jump to the biggest chances"}</p>
            <div className="flex flex-wrap gap-2">
              {quickPicks.map(({ shot: s }) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => pick(s)}
                  aria-pressed={selected?.id === s.id}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    selected?.id === s.id ? "border-marker bg-marker/10 text-ink-0" : "border-pitch-800 text-ink-1 hover:border-pitch-700 hover:text-ink-0"
                  }`}
                >
                  {s.outcome_name === "Goal" ? <BallIcon size={15} ring={s.team_id === homeTeamId ? "var(--color-team-a)" : "var(--color-team-b)"} /> : <ChanceIcon size={14} ring={s.team_id === homeTeamId ? "var(--color-team-a)" : "var(--color-team-b)"} />}
                  {s.minute}′ {s.team_name}
                  {s.xg != null && <span className="text-ink-2">{s.xg.toFixed(2)} xG</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-pitch-800 bg-pitch-900 p-4">
        <h3 className="mb-2 font-display text-lg font-bold text-ink-0">What made this chance?</h3>
        <AnimatePresence mode="wait">
          {!selected && (
            <motion.p key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="pt-16 text-center text-sm text-ink-2">
              {anyFreeze
                ? "Pick a shot, or use a quick pick, to see exactly where every player stood the moment it was taken."
                : "This match has no 360 freeze-frame data, so the shot map is all there is to show. Matches that have it show a check beside 360 in their coverage mark."}
            </motion.p>
          )}
          {selected && (
            <motion.div key={selected.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="mb-3"><SelectedShot shot={selected} home={selected.team_id === homeTeamId} /></div>
              {loadingFrame && <div className="mx-auto aspect-[68/88] max-h-[560px] animate-pulse rounded-2xl bg-pitch-800/40" aria-label="Loading player positions" />}
              {frame && (
                <Pitch half className="mx-auto block h-auto max-h-[600px] w-auto max-w-full rounded-2xl">
                  <FreezeFrameLayer frame={frame} ballLocation={selected.x != null ? [selected.x, selected.y] : undefined} />
                </Pitch>
              )}
              {!loadingFrame && !frame && <p className="pt-12 text-center text-sm text-clay">No freeze-frame for this shot.</p>}
              {frame && <WhyXg eventId={selected.id} />}
              <p className="mt-3 text-sm text-ink-1">
                The shooter has the pulsing ring. Blue is the shooter's team, orange the defenders, GK the keeper. The shaded wedge is how much of the goal the shooter could see.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
    </>
  );
}

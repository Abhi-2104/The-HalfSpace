import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, type MotionValue } from "framer-motion";
import type { FreezeFrame, ShotXg } from "../../lib/api";
import { IsoPitch } from "../iso/IsoPitch";
import { Pitch } from "./Pitch";
import { FreezeFrameLayer } from "./FreezeFrameLayer";
import { Chip } from "../list";
import { WhyXg } from "../match/WhyXg";

const HOME = { zoom: 1, ox: -28, oy: 0 };
type Filter = "all" | "goals" | "home" | "away";

/**
 * The 3D view full-screen: a big interactive pitch on the left, and on the right the match
 * totals, the freeze-frame of the chosen shot and every shot as a filterable list.
 */
export function ExpandedView({ open, onClose, shots, homeTeamId, homeTeam, awayTeam, progress, selected, frame, loadingFrame, onPick }: {
  open: boolean;
  onClose: () => void;
  shots: ShotXg[] | null;
  homeTeamId: number;
  homeTeam: string;
  awayTeam: string;
  progress: MotionValue<number>;
  selected: ShotXg | null;
  frame: FreezeFrame | null;
  loadingFrame: boolean;
  onPick: (s: ShotXg) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = prev; };
  }, [open, onClose]);

  const stats = useMemo(() => {
    const side = (home: boolean) => {
      const own = (shots ?? []).filter((s) => (s.team_id === homeTeamId) === home);
      return { shots: own.length, goals: own.filter((s) => s.outcome_name === "Goal").length, xg: own.reduce((n, s) => n + (s.xg ?? 0), 0) };
    };
    return { home: side(true), away: side(false) };
  }, [shots, homeTeamId]);

  const list = useMemo(() => {
    return (shots ?? [])
      .filter((s) => filter === "all" || (filter === "goals" ? s.outcome_name === "Goal" : (s.team_id === homeTeamId) === (filter === "home")))
      .sort((a, b) => (b.xg ?? 0) - (a.xg ?? 0));
  }, [shots, filter, homeTeamId]);
  const maxXg = Math.max(...(shots ?? []).map((s) => s.xg ?? 0), 0.01);

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
          role="dialog" aria-modal="true" aria-label="Shot map in 3D, expanded"
          data-lenis-prevent
        >
          <div className="absolute inset-0 bg-pitch-950/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            className="relative flex h-full max-h-[920px] w-full max-w-[1600px] flex-col overflow-hidden rounded-3xl border border-pitch-800 bg-pitch-900 shadow-2xl"
            initial={{ opacity: 0, scale: 0.94, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
          >
            <div className="flex items-center justify-between gap-4 border-b border-pitch-800 px-5 py-3">
              <div className="min-w-0">
                <h2 className="truncate font-display text-lg font-bold text-ink-0">{homeTeam} v {awayTeam}</h2>
                <p className="text-xs text-ink-2">Taller column = better chance. +/− or pinch to zoom, drag to turn, shift-drag to pan, double-click to reset.</p>
              </div>
              <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-pitch-800 text-ink-1 transition-colors hover:border-marker hover:text-ink-0">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)] lg:overflow-hidden">
              <div className="flex items-center justify-center bg-pitch-950/40 p-2 lg:min-h-0">
                {shots && <IsoPitch shots={shots} homeTeamId={homeTeamId} progress={progress} onSelect={onPick} interactive home={HOME} className="w-full max-w-[calc((100vh-11rem)*1.5625)]" />}
              </div>

              <div className="flex min-h-0 flex-col gap-4 border-t border-pitch-800 p-5 lg:overflow-y-auto lg:border-l lg:border-t-0">
                <div className="grid grid-cols-2 gap-3">
                  {([[homeTeam, stats.home, "bg-team-a"], [awayTeam, stats.away, "bg-team-b"]] as const).map(([name, st, dot]) => (
                    <div key={name} className="rounded-2xl border border-pitch-800 p-3">
                      <div className="flex items-center gap-1.5 text-xs text-ink-1"><i className={`h-2 w-2 rounded-full ${dot}`} />{name}</div>
                      <div className="mt-1 font-display text-2xl font-extrabold text-ink-0">{st.goals}<span className="ml-1 text-sm font-medium text-ink-2">{st.goals === 1 ? "goal" : "goals"}</span></div>
                      <div className="text-xs text-ink-2">{st.shots} shots · {st.xg.toFixed(2)} xG</div>
                    </div>
                  ))}
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-semibold text-ink-0">{selected ? "Where everyone stood" : "Pick a shot"}</h3>
                  {!selected && <p className="text-sm text-ink-2">Click a column, or a row below, to see where every visible player stood the moment the shot was taken.</p>}
                  {selected && loadingFrame && <div className="mx-auto aspect-[68/88] max-h-[340px] animate-pulse rounded-2xl bg-pitch-800/40" />}
                  {selected && frame && (
                    <Pitch half className="mx-auto block h-auto max-h-[380px] w-auto max-w-full rounded-2xl">
                      <FreezeFrameLayer frame={frame} ballLocation={selected.x != null ? [selected.x, selected.y] : undefined} />
                    </Pitch>
                  )}
                  {selected && !loadingFrame && !frame && <p className="text-sm text-clay">No freeze-frame for this shot.</p>}
                  {selected && frame && <WhyXg eventId={selected.id} />}
                  {selected && (
                    <p className="mt-2 text-sm text-ink-1">
                      <span className="text-ink-0">{selected.player_name}</span> ({selected.team_name}), {selected.minute}′: {selected.outcome_name}
                      {selected.xg != null && <>, <span className="text-marker-bright">{selected.xg.toFixed(2)} xG</span></>}
                    </p>
                  )}
                </div>

                <div>
                  <div className="mb-2 flex flex-wrap gap-2">
                    {([["all", "All"], ["goals", "Goals"], ["home", homeTeam], ["away", awayTeam]] as const).map(([k, label]) => (
                      <Chip key={k} on={filter === k} onClick={() => setFilter(k)}>{label}</Chip>
                    ))}
                  </div>
                  <ul className="divide-y divide-pitch-800 overflow-hidden rounded-2xl border border-pitch-800">
                    {list.map((s) => (
                      <li key={s.id}>
                        <button type="button" onClick={() => onPick(s)} aria-pressed={selected?.id === s.id}
                          className={`grid w-full grid-cols-[2.5rem_minmax(0,1fr)_3rem] items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-pitch-800/50 ${selected?.id === s.id ? "bg-marker/10" : ""}`}>
                          <span className="font-mono text-xs text-ink-2">{s.minute}′</span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 truncate text-ink-0"><i className={`h-2 w-2 shrink-0 rounded-full ${s.team_id === homeTeamId ? "bg-team-a" : "bg-team-b"}`} />{s.player_name ?? "Unknown"}</span>
                            <span className="block text-xs text-ink-2">{s.outcome_name}{s.has_freeze_frame ? " · 360" : ""}</span>
                            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-pitch-800"><span className="block h-full rounded-full bg-marker" style={{ width: `${((s.xg ?? 0) / maxXg) * 100}%` }} /></span>
                          </span>
                          <span className="text-right font-mono text-xs tabular-nums text-marker-bright">{(s.xg ?? 0).toFixed(2)}</span>
                        </button>
                      </li>
                    ))}
                    {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-2">No shots match.</li>}
                  </ul>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

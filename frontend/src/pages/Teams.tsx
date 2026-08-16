import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { api, type TeamProfile } from "../lib/api";
import { useCompetitionSelection } from "../lib/useCompetitionSelection";
import { CompetitionPicker } from "../components/CompetitionPicker";
import { listContainer, listItem } from "../components/PageTransition";

export function Teams() {
  const { competitions, competitionId, seasonId, select } = useCompetitionSelection();
  const [teams, setTeams] = useState<TeamProfile[] | null>(null);

  useEffect(() => {
    if (competitionId == null || seasonId == null) return;
    setTeams(null);
    api.seasonTeams(competitionId, seasonId).then((r) => setTeams(r.teams));
  }, [competitionId, seasonId]);

  const maxPpda = teams ? Math.max(...teams.map((t) => t.avg_ppda ?? 0)) : 1;

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold text-ink-0">Teams</h1>
        {competitions && (
          <CompetitionPicker competitions={competitions} competitionId={competitionId} seasonId={seasonId} onSelect={select} />
        )}
      </div>
      <p className="mt-1 text-xs text-ink-2">
        Ranked by PPDA — passes allowed per defensive action. Lower = more aggressive press. See Tactics → High press.
      </p>

      <motion.div variants={listContainer} initial="hidden" animate="show" className="mt-6 divide-y divide-pitch-800 border-y border-pitch-800">
        {teams?.map((t) => (
          <motion.div key={t.team_id} variants={listItem} className="flex items-center gap-4 px-2 py-3 transition hover:bg-pitch-900">
            <span className="w-40 shrink-0 text-ink-0">
              {t.team}
              {t.low_sample && <span className="ml-1.5 font-mono text-[10px] text-clay">low sample</span>}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-pitch-800">
              <motion.div
                className="h-full rounded-full bg-marker-bright"
                initial={{ width: 0 }}
                animate={{ width: `${((t.avg_ppda ?? 0) / maxPpda) * 100}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
            </div>
            <span className="w-14 text-right font-mono text-sm tabular-nums text-ink-1">{t.avg_ppda?.toFixed(2) ?? "—"}</span>
            <span className="w-20 text-right font-mono text-xs text-ink-2">{t.goals_per_match.toFixed(2)} G/m</span>
          </motion.div>
        ))}
        {!teams && <p className="py-8 text-center text-ink-2">Loading…</p>}
      </motion.div>
    </div>
  );
}

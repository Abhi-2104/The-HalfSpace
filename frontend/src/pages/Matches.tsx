import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { api, type MatchSummary } from "../lib/api";
import { useCompetitionSelection } from "../lib/useCompetitionSelection";
import { CompetitionPicker } from "../components/CompetitionPicker";
import { CoverageStrip } from "../components/CoverageStrip";
import { listContainer, listItem } from "../components/PageTransition";

export function Matches() {
  const { competitions, competitionId, seasonId, select } = useCompetitionSelection();
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);

  useEffect(() => {
    if (competitionId == null || seasonId == null) return;
    setMatches(null);
    api.matches(competitionId, seasonId).then((r) => setMatches(r.matches));
  }, [competitionId, seasonId]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold text-ink-0">Matches</h1>
        {competitions && (
          <CompetitionPicker competitions={competitions} competitionId={competitionId} seasonId={seasonId} onSelect={select} />
        )}
      </div>

      <motion.div variants={listContainer} initial="hidden" animate="show" className="mt-6 divide-y divide-pitch-800 border-y border-pitch-800">
        {matches?.map((m) => (
          <motion.div key={m.id} variants={listItem}>
            <Link
              to={`/matches/${m.id}`}
              className="flex items-center justify-between px-2 py-3.5 transition hover:translate-x-1 hover:bg-pitch-900"
            >
              <div className="flex items-center gap-4">
                <span className="w-24 font-mono text-xs text-ink-2">{m.match_date}</span>
                <span className="text-ink-0">
                  {m.home_team} <span className="font-mono text-ink-1">{m.home_score}–{m.away_score}</span> {m.away_team}
                </span>
              </div>
              <CoverageStrip hasEvents={!!m.has_events} hasTracking={!!m.has_tracking} />
            </Link>
          </motion.div>
        ))}
        {matches?.length === 0 && <p className="py-8 text-center text-ink-2">No matches in this competition/season.</p>}
        {!matches && <p className="py-8 text-center text-ink-2">Loading…</p>}
      </motion.div>
    </div>
  );
}

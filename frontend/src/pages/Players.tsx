import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { api, type PlayerProfile } from "../lib/api";
import { useCompetitionSelection } from "../lib/useCompetitionSelection";
import { CompetitionPicker } from "../components/CompetitionPicker";
import { listContainer, listItem } from "../components/PageTransition";

type SortKey = "goals_p90" | "prog_passes_p90" | "dribbles_completed_p90" | "pressures_p90";
const SORTS: [SortKey, string][] = [
  ["goals_p90", "Goals/90"],
  ["prog_passes_p90", "Progressive passes/90"],
  ["dribbles_completed_p90", "Dribbles/90"],
  ["pressures_p90", "Pressures/90"],
];

export function Players() {
  const { competitions, competitionId, seasonId, select } = useCompetitionSelection();
  const [players, setPlayers] = useState<PlayerProfile[] | null>(null);
  const [sort, setSort] = useState<SortKey>("goals_p90");

  useEffect(() => {
    if (competitionId == null || seasonId == null) return;
    setPlayers(null);
    api.seasonPlayers(competitionId, seasonId).then((r) => setPlayers(r.players));
  }, [competitionId, seasonId]);

  const sorted = players ? [...players].sort((a, b) => b[sort] - a[sort]) : null;

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold text-ink-0">Players</h1>
        {competitions && (
          <CompetitionPicker competitions={competitions} competitionId={competitionId} seasonId={seasonId} onSelect={select} />
        )}
      </div>
      <p className="mt-1 text-xs text-ink-2">Minimum 900 minutes played — a reliability floor, not an arbitrary cutoff.</p>

      <div className="mt-4 flex gap-2 font-mono text-xs uppercase tracking-wide">
        {SORTS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSort(key)}
            className={`rounded-sm px-2.5 py-1 transition ${sort === key ? "bg-marker text-ink-0" : "text-ink-1 hover:text-ink-0"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <motion.div variants={listContainer} initial="hidden" animate="show" key={sort} className="mt-4 divide-y divide-pitch-800 border-y border-pitch-800">
        {sorted?.map((p) => (
          <motion.div key={p.player_id} variants={listItem}>
            <Link
              to={`/players/${p.player_id}?competition_id=${competitionId}&season_id=${seasonId}`}
              className="flex items-center justify-between px-2 py-3 transition hover:translate-x-1 hover:bg-pitch-900"
            >
              <div>
                <span className="text-ink-0">{p.name}</span>
                <span className="ml-2 font-mono text-xs text-ink-2">{p.team} · {p.position}</span>
              </div>
              <span className="font-mono text-sm tabular-nums text-marker-bright">{p[sort].toFixed(2)}</span>
            </Link>
          </motion.div>
        ))}
        {!players && <p className="py-8 text-center text-ink-2">Loading…</p>}
      </motion.div>
    </div>
  );
}

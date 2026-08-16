import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { api, type TacticalConceptSummary } from "../lib/api";
import { ConfidenceBadge } from "../components/ConfidenceBadge";
import { listContainer, listItem } from "../components/PageTransition";

export function Tactics() {
  const [concepts, setConcepts] = useState<TacticalConceptSummary[] | null>(null);

  useEffect(() => {
    api.tacticalConcepts().then((r) => setConcepts(r.concepts));
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="font-display text-3xl font-bold text-ink-0">Tactics</h1>
      <p className="mt-2 text-ink-1">
        Not a glossary. Every concept is tagged with what we actually do about it — explain it, measure a proxy
        for it, detect it in code, or admit we don't attempt it yet.
      </p>

      <motion.ul variants={listContainer} initial="hidden" animate="show" className="mt-8 divide-y divide-pitch-800 border-y border-pitch-800">
        {concepts?.map((c) => (
          <motion.li key={c.slug} variants={listItem}>
            <Link to={`/tactics/${c.slug}`} className="flex items-center justify-between px-2 py-3.5 transition hover:translate-x-1 hover:bg-pitch-900">
              <span className="text-ink-0">{c.name}</span>
              <ConfidenceBadge tier={c.confidence} />
            </Link>
          </motion.li>
        ))}
        {!concepts && <p className="py-8 text-center text-ink-2">Loading…</p>}
      </motion.ul>
    </div>
  );
}

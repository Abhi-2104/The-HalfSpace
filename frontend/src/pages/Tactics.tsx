import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { api, type TacticalConcept } from "../lib/api";
import { ConfidenceBadge } from "../components/ConfidenceBadge";
import { Chip, Empty, SearchBox, Toolbar, matches } from "../components/list";
import { KINDS, PHASES, TIER_INFO, metaOf, type Kind, type Phase } from "../lib/tactics";
import { LoadError } from "../components/LoadError";

const ORDER = ["detectable", "analytical", "tracking_dependent", "educational", "unsupported"];

export function Tactics() {
  const [concepts, setConcepts] = useState<TacticalConcept[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [tier, setTier] = useState("");
  const [kind, setKind] = useState<Kind | "">("");
  const [phase, setPhase] = useState<Phase | "">("");

  useEffect(() => {
    api.tacticalConcepts()
      .then((r) => Promise.all(r.concepts.map((c) => api.tacticalConcept(c.slug))))
      .then(setConcepts)
      .catch((e) => setError(e.message));
  }, []);

  const counts = useMemo(() => {
    const n: Record<string, number> = {};
    for (const c of concepts ?? []) n[c.confidence] = (n[c.confidence] ?? 0) + 1;
    return n;
  }, [concepts]);
  const tiers = ORDER.filter((t) => counts[t]);
  const rows = useMemo(
    () => (concepts ?? []).filter((c) => (!tier || c.confidence === tier) && (!kind || metaOf(c.slug).kind === kind) && (!phase || metaOf(c.slug).phase === phase) && matches(q, c.name, c.beginner_explanation))
      .sort((a, b) => ORDER.indexOf(a.confidence) - ORDER.indexOf(b.confidence) || a.name.localeCompare(b.name)),
    [concepts, q, tier, kind, phase],
  );

  if (error) return <LoadError error={error} what="page" backTo="/" backLabel="Back home" />;

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-12 lg:px-10">
      <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] text-ink-0">Tactics</h1>
      <p className="mt-3 max-w-2xl text-lg leading-relaxed text-ink-1">
        The ideas coaches and commentators talk about. For each one: what it is, what it is used for, and how we get it from the data, or why we can't.
      </p>

      {/* how we get them */}
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiers.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTier(tier === t ? "" : t)}
            aria-pressed={tier === t}
            className={`rounded-2xl border p-4 text-left transition-colors ${tier === t ? "border-marker bg-marker/10" : "border-pitch-800 bg-pitch-900 hover:border-pitch-700"}`}
          >
            <div className="flex items-center justify-between">
              <ConfidenceBadge tier={t} />
              <span className="font-display text-2xl font-extrabold text-ink-0">{counts[t]}</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink-1">{TIER_INFO[t]?.how}</p>
          </button>
        ))}
      </div>

      <Toolbar count={rows.length} total={concepts?.length} noun="concepts">
        <SearchBox value={q} onChange={setQ} placeholder="Search a concept" />
        {tier && <Chip on onClick={() => setTier("")}>{TIER_INFO[tier]?.label} ✕</Chip>}
      </Toolbar>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Playing styles or tactics">
          <Chip on={!kind} onClick={() => setKind("")}>All</Chip>
          {(Object.keys(KINDS) as Kind[]).map((k) => <Chip key={k} on={kind === k} onClick={() => setKind(kind === k ? "" : k)}>{KINDS[k].label}</Chip>)}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Phase of play">
          {(Object.keys(PHASES) as Phase[]).map((p) => <Chip key={p} on={phase === p} onClick={() => setPhase(phase === p ? "" : p)}>{PHASES[p]}</Chip>)}
        </div>
      </div>

      {!concepts ? (
        <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-72 animate-pulse rounded-3xl bg-pitch-800/30" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-pitch-800 bg-pitch-900">
          <Empty onReset={() => { setQ(""); setTier(""); }}>No concepts match that search.</Empty>
        </div>
      ) : (
        (Object.keys(KINDS) as Kind[]).map((k) => {
          const list = rows.filter((c) => metaOf(c.slug).kind === k);
          if (!list.length) return null;
          return (
            <section key={k} className="mt-10">
              <h2 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-ink-0">{KINDS[k].label}</h2>
              <p className="mt-1 text-sm text-ink-1">{KINDS[k].blurb}</p>
              <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {list.map((c, i) => <Card key={c.slug} c={c} i={i} />)}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

function Card({ c, i }: { c: TacticalConcept; i: number }) {
  const phase = PHASES[metaOf(c.slug).phase];
  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(i, 8) * 0.04 }}
      className="group flex flex-col rounded-3xl border border-pitch-800 bg-pitch-900 p-6 transition duration-300 hover:-translate-y-1 hover:border-marker"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-xl font-bold tracking-tight text-ink-0">{c.name}</h3>
          <p className="mt-0.5 text-xs text-ink-2">{phase}</p>
        </div>
        <ConfidenceBadge tier={c.confidence} />
      </div>

      <p className="mt-4 line-clamp-3 text-sm leading-relaxed text-ink-1">{c.beginner_explanation}</p>

      <div className="mt-auto pt-5">
        <Link to={`/tactics/${c.slug}`} className="inline-flex items-center gap-1.5 rounded-full border border-pitch-700 px-4 py-2 text-sm font-semibold text-ink-0 transition-colors hover:border-marker hover:text-marker-bright">
          Know more <span className="transition-transform group-hover:translate-x-1" aria-hidden>→</span>
        </Link>
      </div>
    </motion.article>
  );
}

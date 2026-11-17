import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type TacticalConcept } from "../lib/api";
import { ConfidenceBadge } from "../components/ConfidenceBadge";
import { LoadError } from "../components/LoadError";
import { KINDS, PHASES, TIER_INFO, USES, metaOf } from "../lib/tactics";

export function TacticDetail() {
  const { slug } = useParams();
  const [concept, setConcept] = useState<TacticalConcept | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setConcept(null);
    setError(null);
    api.tacticalConcept(slug!).then(setConcept).catch((e) => setError(e.message));
    api.tacticalConcepts().then((r) => setNames(Object.fromEntries(r.concepts.map((c) => [c.slug, c.name])))).catch(() => {});
  }, [slug]);

  if (error) return <LoadError error={error} what="concept" backTo="/tactics" backLabel="Back to tactics" />;
  if (!concept) return <div className="mx-auto max-w-[1440px] px-6 py-12 text-ink-2 lg:px-10">Loading…</div>;
  const meta = metaOf(concept.slug);

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-12 lg:px-10">
      <Link to="/tactics" className="text-sm text-ink-2 transition-colors hover:text-ink-0">← All concepts</Link>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] text-ink-0 sm:text-5xl">{concept.name}</h1>
        <ConfidenceBadge tier={concept.confidence} />
      </div>
      <p className="mt-2 text-sm text-ink-2">{KINDS[meta.kind].label} · {PHASES[meta.phase]}</p>
      <p className="mt-5 max-w-3xl text-xl leading-relaxed text-ink-0">{concept.beginner_explanation}</p>

      <div className="mt-10 grid gap-5 lg:grid-cols-2">
        {USES[concept.slug] && (
          <Panel title="What it's used for" tone="accent">
            <p className="leading-relaxed text-ink-0">{USES[concept.slug]}</p>
          </Panel>
        )}
        <Panel title="How we get it">
          <p className="leading-relaxed text-ink-1">{TIER_INFO[concept.confidence]?.how}</p>
          <p className="mt-3 leading-relaxed text-ink-1"><span className="font-semibold text-ink-0">In data terms:</span> {concept.analytical_definition}</p>
        </Panel>
        <Panel title="Data it needs">
          <ul className="flex flex-wrap gap-2">
            {concept.required_data.map((d) => (
              <li key={d} className="rounded-full border border-pitch-700 px-3 py-1 text-sm text-ink-1">{d}</li>
            ))}
          </ul>
        </Panel>
        <Panel title="What to keep in mind">
          <p className="leading-relaxed text-ink-1">{concept.limitations}</p>
        </Panel>
      </div>

      {concept.related_concepts.length > 0 && (
        <div className="mt-10">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">Related concepts</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {concept.related_concepts.map((s) => (
              <Link key={s} to={`/tactics/${s}`} className="rounded-full border border-pitch-700 bg-pitch-900 px-4 py-2 text-sm font-medium text-ink-0 transition hover:-translate-y-0.5 hover:border-marker">
                {names[s] ?? s}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Panel({ title, children, tone }: { title: string; children: React.ReactNode; tone?: "accent" }) {
  return (
    <section className={`rounded-3xl border p-6 ${tone === "accent" ? "border-marker/40 bg-marker/10" : "border-pitch-800 bg-pitch-900"}`}>
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-2">{title}</h2>
      {children}
    </section>
  );
}

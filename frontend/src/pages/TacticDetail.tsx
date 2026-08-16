import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type TacticalConcept } from "../lib/api";
import { ConfidenceBadge } from "../components/ConfidenceBadge";

export function TacticDetail() {
  const { slug } = useParams();
  const [concept, setConcept] = useState<TacticalConcept | null>(null);

  useEffect(() => {
    setConcept(null);
    api.tacticalConcept(slug!).then(setConcept);
  }, [slug]);

  if (!concept) return <div className="mx-auto max-w-2xl px-6 py-12 text-ink-2">Loading…</div>;

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link to="/tactics" className="font-mono text-xs text-ink-2 hover:text-ink-0">← All concepts</Link>
      <div className="mt-3 flex items-center gap-3">
        <h1 className="font-display text-4xl font-bold text-ink-0">{concept.name}</h1>
        <ConfidenceBadge tier={concept.confidence} />
      </div>

      <p className="mt-6 text-lg leading-relaxed text-ink-0">{concept.beginner_explanation}</p>

      <Section title="Analytical definition">
        <p className="text-ink-1">{concept.analytical_definition}</p>
      </Section>

      {concept.detection_method && (
        <Section title="Detection method">
          <code className="rounded-sm bg-pitch-900 px-2 py-1 font-mono text-sm text-marker-bright">{concept.detection_method}</code>
        </Section>
      )}

      <Section title="Required data">
        <ul className="flex flex-wrap gap-2">
          {concept.required_data.map((d) => (
            <li key={d} className="rounded-sm border border-pitch-700 px-2 py-1 font-mono text-xs text-ink-1">{d}</li>
          ))}
        </ul>
      </Section>

      {concept.related_concepts.length > 0 && (
        <Section title="Related concepts">
          <div className="flex flex-wrap gap-2">
            {concept.related_concepts.map((slug) => (
              <Link key={slug} to={`/tactics/${slug}`} className="rounded-sm border border-pitch-700 px-2 py-1 font-mono text-xs text-marker-bright hover:border-marker-bright">
                {slug}
              </Link>
            ))}
          </div>
        </Section>
      )}

      <Section title="Limitations">
        <p className="text-sm text-ink-2">{concept.limitations}</p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-8 border-t border-pitch-800 pt-6">
      <h2 className="font-mono text-xs uppercase tracking-widest text-ink-2">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

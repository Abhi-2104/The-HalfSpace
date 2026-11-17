import { useState } from "react";
import type { MatchReport as Report } from "../../lib/api";

const SHOWN = 5;

/** The written summary of a match, built from its data. The first line is the headline. */
export function MatchReport({ report }: { report: Report }) {
  const [head, ...all] = report.text;
  const [open, setOpen] = useState(false);
  const rest = open ? all : all.slice(0, SHOWN);
  return (
    <section className="rounded-2xl border border-pitch-800 bg-pitch-900 p-5 sm:p-6">
      <h2 className="font-display text-lg font-bold text-ink-0">Match report</h2>
      <p className="mt-2 text-lg leading-relaxed text-ink-0">{head}</p>
      {rest.length > 0 && (
        <ul className="mt-3 space-y-2">
          {rest.map((l, i) => (
            <li key={i} className="flex gap-2.5 text-[15px] leading-relaxed text-ink-1">
              <span className="mt-[0.65em] h-1.5 w-1.5 shrink-0 rounded-full bg-marker" aria-hidden />
              <span>{l}</span>
            </li>
          ))}
        </ul>
      )}
      {all.length > SHOWN && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-4 text-sm font-semibold text-marker-bright hover:underline">
          {open ? "Show less" : `Show the full report (${all.length - SHOWN} more)`}
        </button>
      )}
    </section>
  );
}

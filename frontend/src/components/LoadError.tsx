import { Link } from "react-router-dom";

/**
 * What a page shows when it can't load its data. Plain language, no raw error
 * text: a missing record gets a "couldn't find it" message, anything else is
 * treated as the service being briefly unavailable, with a way to try again.
 */
export function LoadError({ error, what, backTo, backLabel }: { error: string; what: string; backTo: string; backLabel: string }) {
  const missing = /not (found|ingested)|\b404\b/i.test(error);
  return (
    <div className="mx-auto max-w-[1440px] px-6 py-24 text-center lg:px-10" role="alert">
      <h1 className="font-display text-3xl font-extrabold tracking-[-0.03em] text-ink-0 sm:text-4xl">
        {missing ? `We couldn't find that ${what}` : `We couldn't load this ${what}`}
      </h1>
      <p className="mx-auto mt-3 max-w-md leading-relaxed text-ink-1">
        {missing
          ? "It may have moved, or we may not have its data yet."
          : "Our data service may be briefly unavailable. Please try again in a moment."}
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {!missing && (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-full bg-marker px-5 py-2.5 font-semibold text-on-accent transition hover:-translate-y-0.5"
          >
            Try again
          </button>
        )}
        <Link to={backTo} className="rounded-full border border-pitch-700 px-5 py-2.5 font-semibold text-ink-0 transition hover:-translate-y-0.5 hover:border-marker">
          {backLabel}
        </Link>
      </div>
    </div>
  );
}

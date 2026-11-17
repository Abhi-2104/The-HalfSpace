/**
 * The coverage mark on every match: events / tracking / 360, each a plain check when
 * that data exists and a dimmed dash when it doesn't. Never implies richer data than
 * is really there (project principle: show exactly what backs a record).
 */
export function CoverageStrip({
  hasEvents,
  hasTracking,
  has360,
}: {
  hasEvents: boolean;
  hasTracking: boolean;
  has360?: boolean;
}) {
  const items: [string, boolean][] = [
    ["events", hasEvents],
    ["tracking", hasTracking],
    ["360", !!has360],
  ];
  return (
    <div className="flex items-center gap-3" title="Data coverage">
      {items.map(([label, on]) => (
        <span key={label} className={`flex items-center gap-1 font-mono text-xs ${on ? "text-ink-1" : "text-ink-2/60"}`}>
          {on ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-marker-bright)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-label="available"><path d="m4 12.5 5 5L20 6.5" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-label="not available"><path d="M7 12h10" /></svg>
          )}
          {label}
        </span>
      ))}
    </div>
  );
}

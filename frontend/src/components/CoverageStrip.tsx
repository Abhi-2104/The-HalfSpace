/**
 * The signature UI element, appearing on every match/player/team card:
 * three ticks (events / tracking / 360) showing exactly what depth of data
 * backs this record. Never implies richer data than what's actually there
 * (project principle - see project spec section 8).
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
    <div className="flex items-center gap-1.5" title="Data coverage">
      {items.map(([label, on]) => (
        <span key={label} className="flex items-center gap-1">
          <span className="coverage-tick" data-on={on} />
          <span className={`font-mono text-[10px] uppercase tracking-wide ${on ? "text-ink-1" : "text-pitch-700"}`}>
            {label}
          </span>
        </span>
      ))}
    </div>
  );
}

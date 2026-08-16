/** Plain HTML/CSS bar comparison (dataviz skill: build simple comparisons in
 * plain HTML rather than reaching for a charting library for two numbers). */
export function CompareBar({
  label,
  nameA,
  nameB,
  valueA,
  valueB,
  format = (v: number) => v.toFixed(2),
  lowerIsBetter = false,
}: {
  label: string;
  nameA: string;
  nameB: string;
  valueA: number;
  valueB: number;
  format?: (v: number) => string;
  lowerIsBetter?: boolean;
}) {
  const max = Math.max(valueA, valueB, 0.001);
  const pctA = (valueA / max) * 100;
  const pctB = (valueB / max) * 100;
  const aWins = lowerIsBetter ? valueA < valueB : valueA > valueB;
  const bWins = lowerIsBetter ? valueB < valueA : valueB > valueA;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between font-mono text-[11px] uppercase tracking-wide text-ink-2">
        <span>{label}</span>
      </div>
      <Row name={nameA} value={valueA} pct={pctA} format={format} highlight={aWins} color="var(--color-marker-bright)" />
      <Row name={nameB} value={valueB} pct={pctB} format={format} highlight={bWins} color="var(--color-info)" />
    </div>
  );
}

function Row({
  name,
  value,
  pct,
  format,
  highlight,
  color,
}: {
  name: string;
  value: number;
  pct: number;
  format: (v: number) => string;
  highlight: boolean;
  color: string;
}) {
  return (
    <div className="mb-1.5 flex items-center gap-3">
      <span className="w-36 shrink-0 truncate text-sm text-ink-1" title={name}>{name}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-pitch-800">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className={`w-14 shrink-0 text-right font-mono text-sm ${highlight ? "text-ink-0" : "text-ink-2"}`}>
        {format(value)}
      </span>
    </div>
  );
}

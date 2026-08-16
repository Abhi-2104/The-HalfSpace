export function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="border-l border-pitch-800 pl-4">
      <div className="font-display text-4xl font-bold tabular-nums text-ink-0">{value}</div>
      <div className="mt-1 font-mono text-[11px] uppercase tracking-wide text-ink-2">{label}</div>
    </div>
  );
}

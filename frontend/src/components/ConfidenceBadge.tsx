const STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  detectable: { bg: "bg-pitch-green/15", fg: "text-pitch-green", label: "Detectable" },
  analytical: { bg: "bg-info/15", fg: "text-info", label: "Analytical proxy" },
  tracking_dependent: { bg: "bg-marker/15", fg: "text-marker-bright", label: "Needs tracking" },
  educational: { bg: "bg-ink-2/15", fg: "text-ink-1", label: "Educational only" },
  unsupported: { bg: "bg-clay/15", fg: "text-clay", label: "Not attempted" },
};

/** Confidence is always shown as an icon + label, never color alone (dataviz status-color rule). */
export function ConfidenceBadge({ tier }: { tier: string }) {
  const s = STYLES[tier] ?? STYLES.educational;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide ${s.bg} ${s.fg}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}

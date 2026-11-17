import { useState, type ReactNode } from "react";

/** Shared pieces for every list and table: a search box, filter selects, toggle chips, sortable headers. */

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="relative block w-full sm:w-72">
      <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-2" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-xl border border-pitch-700 bg-pitch-900 py-2 pl-9 pr-8 text-sm text-ink-0 outline-none transition placeholder:text-ink-2 focus:border-marker-bright"
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-ink-2 hover:text-ink-0">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      )}
    </label>
  );
}

export function FilterSelect({ value, onChange, label, options }: { value: string; onChange: (v: string) => void; label: string; options: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="min-w-0 rounded-xl border border-pitch-700 bg-pitch-900 px-3 py-2 text-sm text-ink-0 outline-none focus:border-marker-bright"
    >
      <option value="">{label}: all</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${on ? "border-marker bg-marker/10 text-ink-0" : "border-pitch-800 text-ink-1 hover:border-pitch-700 hover:text-ink-0"}`}
    >
      {children}
    </button>
  );
}

/** Search and filters on the left, the live result count on the right. */
export function Toolbar({ children, count, total, noun }: { children: ReactNode; count?: number; total?: number; noun: string }) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-2.5">
      {children}
      {count != null && total != null && (
        <span className="ml-auto text-xs text-ink-2" aria-live="polite">
          {count === total ? `${total.toLocaleString()} ${noun}` : `${count.toLocaleString()} of ${total.toLocaleString()} ${noun}`}
        </span>
      )}
    </div>
  );
}

/** A rounded card that holds a header row and the rows beneath it. */
export function Table({ children }: { children: ReactNode }) {
  return <div className="mt-4 overflow-hidden rounded-2xl border border-pitch-800 bg-pitch-900">{children}</div>;
}

export function HeadRow({ cols, children }: { cols: string; children: ReactNode }) {
  return (
    <div className={`grid items-center gap-3 border-b border-pitch-800 bg-pitch-950/50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-2 ${cols}`}>
      {children}
    </div>
  );
}

export function SortHead<K extends string>({ k, sort, dir, onSort, children, align = "right" }: { k: K; sort: K; dir: 1 | -1; onSort: (k: K) => void; children: ReactNode; align?: "left" | "right" }) {
  const on = sort === k;
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      aria-sort={on ? (dir === -1 ? "descending" : "ascending") : "none"}
      className={`flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-ink-0 ${align === "right" ? "justify-end" : ""} ${on ? "text-marker-bright" : ""}`}
    >
      {children}
      <span aria-hidden className={`text-[9px] ${on ? "" : "opacity-0"}`}>{dir === -1 ? "▼" : "▲"}</span>
    </button>
  );
}

export function Empty({ children, onReset }: { children: ReactNode; onReset?: () => void }) {
  return (
    <div className="px-6 py-14 text-center text-sm text-ink-1">
      {children}
      {onReset && (
        <div className="mt-3">
          <button type="button" onClick={onReset} className="font-semibold text-marker-bright hover:underline">Clear filters</button>
        </div>
      )}
    </div>
  );
}

export function SkeletonRows({ n = 8 }: { n?: number }) {
  return (
    <div className="divide-y divide-pitch-800">
      {Array.from({ length: n }, (_, i) => <div key={i} className="h-12 animate-pulse bg-pitch-800/20" />)}
    </div>
  );
}

/** Sort state with click-to-toggle: a new column starts descending (or ascending for text). */
export function useSort<K extends string>(initial: K, initialDir: 1 | -1 = -1) {
  const [sort, setSort] = useState<K>(initial);
  const [dir, setDir] = useState<1 | -1>(initialDir);
  const onSort = (k: K, textual = false) => {
    if (k === sort) setDir((d) => (d === 1 ? -1 : 1));
    else { setSort(k); setDir(textual ? 1 : -1); }
  };
  return { sort, dir, onSort, setSort, setDir };
}

/** Case- and accent-insensitive "does this text contain every word of the query". */
export function matches(query: string, ...fields: (string | null | undefined)[]) {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const hay = norm(fields.filter(Boolean).join(" "));
  return norm(query).split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

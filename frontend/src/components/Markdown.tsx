import { Fragment, type ReactNode } from "react";

/**
 * A small renderer for the answer text: paragraphs, headings, bullet and numbered lists,
 * tables, **bold**, *italic* and `code`. No raw HTML is ever injected, so model output cannot
 * add markup. Written by hand to avoid pulling a dependency in for a handful of constructs.
 */

function inline(text: string): ReactNode[] {
  // models often put <br> inside table cells; honour it as a line break (still no HTML is injected)
  const parts = text.split(/<br\s*\/?>/i);
  if (parts.length > 1) return parts.flatMap((p, i) => [...(i ? [<br key={`b${i}`} />] : []), ...inline(p.trim())]);
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={k++} className="font-semibold text-ink-0">{inline(t.slice(2, -2))}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k++} className="rounded bg-pitch-800 px-1 py-0.5 font-mono text-[13px]">{t.slice(1, -1)}</code>);
    else out.push(<em key={k++}>{inline(t.slice(1, -1))}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isSep = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const isNum = (s: string) => /^[~≈+-]?\d[\d.,]*\s*[%a-z/° ]{0,12}$/i.test(s.replace(/\*/g, ""));

type Block =
  | { t: "p"; lines: string[] }
  | { t: "h"; text: string }
  | { t: "ul"; items: string[] }
  | { t: "ol"; items: string[] }
  | { t: "table"; head: string[]; rows: string[][] };

function parse(src: string): Block[] {
  const lines = src.replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.trim().startsWith("|") && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      blocks.push({ t: "table", head, rows });
      continue;
    }
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) { blocks.push({ t: "h", text: h[1] }); i++; continue; }
    // a line that is nothing but bold text acts as a heading
    const b = line.trim().match(/^\*\*([^*]+)\*\*:?$/);
    if (b) { blocks.push({ t: "h", text: b[1] }); i++; continue; }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*•]\s+/, ""));
      blocks.push({ t: "ul", items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      blocks.push({ t: "ol", items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].trim().startsWith("|") && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i])) para.push(lines[i++]);
    if (para.length) blocks.push({ t: "p", lines: para });
    else i++;
  }
  return blocks;
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-3.5 text-[15px] leading-relaxed text-ink-0">
      {parse(text).map((b, n) => {
        if (b.t === "h") return <h4 key={n} className="pt-1 font-display text-base font-bold tracking-tight text-ink-0">{inline(b.text)}</h4>;
        if (b.t === "p") return <p key={n} className="text-ink-1">{b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}</p>;
        if (b.t === "ul") return <ul key={n} className="space-y-1.5 pl-1">{b.items.map((it, j) => (
          <li key={j} className="flex gap-2.5 text-ink-1"><span className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-marker" aria-hidden /><span>{inline(it)}</span></li>
        ))}</ul>;
        if (b.t === "ol") return <ol key={n} className="space-y-1.5">{b.items.map((it, j) => (
          <li key={j} className="flex gap-2.5 text-ink-1"><span className="w-5 shrink-0 font-mono text-xs leading-[1.9] text-marker-bright">{j + 1}</span><span>{inline(it)}</span></li>
        ))}</ol>;
        // a column is numeric (right-aligned) only when every cell in it is a number
        const numeric = b.head.map((_, k) => k > 0 && b.rows.length > 0 && b.rows.every((r) => isNum(r[k] ?? "")));
        return (
          <div key={n} className="overflow-x-auto rounded-xl border border-pitch-800">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-pitch-950/50">
                  {b.head.map((c, j) => (
                    <th key={j} className={`px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-2 ${numeric[j] ? "text-right" : "text-left"}`}>{inline(c)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-pitch-800">
                {b.rows.map((r, j) => (
                  <tr key={j} className="transition-colors hover:bg-pitch-800/40">
                    {r.map((c, k) => (
                      <td key={k} className={`px-3.5 py-2.5 align-top ${k === 0 ? "font-medium text-ink-0" : numeric[k] ? "text-right font-mono text-[13px] tabular-nums text-ink-0" : "text-ink-1"}`}>{inline(c)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

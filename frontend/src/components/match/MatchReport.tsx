import type { Momentum, MatchReport as Report } from "../../lib/api";
import { displayName } from "../../lib/names";
import { BallIcon, ChanceIcon } from "../icons";

interface Facts {
  xg?: { home: number; away: number };
  moments?: Momentum["moments"];
  top_players?: { threat_creators?: { player: string; display_name?: string | null; team_id: number; xt: number }[]; shooters?: { player: string; display_name?: string | null; team_id: number; xg: number }[] };
  on_top_stretches?: [string, number, number][];
}

const dot = (home: boolean) => (home ? "bg-team-a" : "bg-team-b");

/** "Counters and corners - France: 5 corners (0.22 xG); ..." -> one row per team and kind. */
function setPieces(lines: string[]) {
  const line = lines.find((l) => /^Counters and corners/i.test(l));
  if (!line) return [];
  return [...line.matchAll(/([^;:]+?):\s*(\d+)\s+(corners?|counters?)\s*\(([\d.]+)\s*xG\)/gi)].map((m) => ({
    team: m[1].replace(/^Counters and corners\s*-\s*/i, "").trim(),
    n: Number(m[2]),
    kind: /corner/i.test(m[3]) ? "corners" : "counterattacks",
    xg: Number(m[4]),
  }));
}

/** The written summary of a match, laid out as a short story: verdict, key moments, who was on top, standouts. */
export function MatchReport({ report, home, away, homeTeamId }: { report: Report; home: string; away: string; homeTeamId: number }) {
  const f = (report.facts ?? {}) as Facts;
  const lines = report.text;
  const verdict = lines.find((l) => /created the better chances|evenly|level on chances|even on chances/i.test(l));
  const extra = lines.find((l) => /^Extra time/i.test(l));
  const sp = setPieces(lines);
  const xh = f.xg?.home ?? 0, xa = f.xg?.away ?? 0;
  const total = xh + xa || 1;
  const moments = (f.moments ?? []).filter((m) => m.kind === "goal" || m.kind === "big_chance");
  const stretches = f.on_top_stretches ?? [];
  const threat = f.top_players?.threat_creators ?? [];
  const shooters = f.top_players?.shooters ?? [];

  return (
    <section className="rounded-2xl border border-pitch-800 bg-pitch-900 p-5 sm:p-7">
      <h2 className="font-display text-lg font-bold text-ink-0">Match report</h2>
      {verdict && <p className="mt-2 max-w-3xl font-display text-xl font-bold leading-snug tracking-tight text-ink-0 sm:text-2xl">{verdict.replace(/\s*\(.*$/, "")}</p>}

      {f.xg && (
        <div className="mt-5 max-w-xl">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-ink-1"><span className="font-semibold text-ink-0">{home}</span> {xh.toFixed(2)}</span>
            <span className="text-xs uppercase tracking-wider text-ink-2">Chance quality (xG)</span>
            <span className="text-ink-1">{xa.toFixed(2)} <span className="font-semibold text-ink-0">{away}</span></span>
          </div>
          <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-pitch-800">
            <span className="bg-team-a" style={{ width: `${(xh / total) * 100}%` }} />
            <span className="ml-0.5 flex-1 bg-team-b" />
          </div>
        </div>
      )}
      {extra && <p className="mt-3 inline-block rounded-full bg-pitch-800 px-3 py-1 text-xs text-ink-1">Went to extra time, which is included here. The penalty shoot-out is not counted.</p>}

      <div className="mt-7 grid gap-8 lg:grid-cols-[1.3fr_1fr]">
        {moments.length > 0 && (
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">Key moments</h3>
            <ol className="mt-3 space-y-3">
              {moments.map((m, i) => (
                <li key={i} className="relative grid grid-cols-[2.5rem_1.25rem_minmax(0,1fr)_auto] items-center gap-2">
                  <span className="font-mono text-xs text-ink-2">{m.minute}′</span>
                  {m.kind === "goal" ? <BallIcon size={18} ring={m.team_id === homeTeamId ? "var(--color-team-a)" : "var(--color-team-b)"} /> : <ChanceIcon size={16} ring={m.team_id === homeTeamId ? "var(--color-team-a)" : "var(--color-team-b)"} />}
                  <span className="min-w-0 text-sm text-ink-0">
                    <span className="font-semibold">{m.kind === "goal" ? "Goal" : "Big chance"}</span>
                    <span className="text-ink-1"> · {displayName(m.player, m.display_name)}, {m.team_id === homeTeamId ? home : away}</span>
                  </span>
                  <span className="font-mono text-xs text-ink-2">{m.xg.toFixed(2)} xG</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="space-y-6">
          {stretches.length > 0 && (
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">Who was on top</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {stretches.map(([side, a, b], i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-pitch-800 px-3 py-1 text-xs text-ink-1">
                    <i className={`h-2 w-2 rounded-full ${dot(side === "home")}`} />
                    {side === "home" ? home : away} <span className="font-mono text-ink-0">{a}′–{b}′</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {threat.length > 0 && (
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">Most danger created</h3>
              <ul className="mt-3 space-y-1.5 text-sm">
                {threat.map((p, i) => (
                  <li key={i} className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-1.5 text-ink-0"><i className={`h-2 w-2 shrink-0 rounded-full ${dot(p.team_id === homeTeamId)}`} /><span className="truncate">{displayName(p.player, p.display_name)}</span></span>
                    <span className="font-mono text-xs text-ink-2">{p.xt.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {shooters.length > 0 && (
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">Best chances taken</h3>
              <ul className="mt-3 space-y-1.5 text-sm">
                {shooters.map((p, i) => (
                  <li key={i} className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-1.5 text-ink-0"><i className={`h-2 w-2 shrink-0 rounded-full ${dot(p.team_id === homeTeamId)}`} /><span className="truncate">{displayName(p.player, p.display_name)}</span></span>
                    <span className="font-mono text-xs text-ink-2">{p.xg.toFixed(2)} xG</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {sp.length > 0 && (
        <div className="mt-7 border-t border-pitch-800 pt-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">Corners and counterattacks</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {sp.map((s, i) => (
              <div key={i} className="rounded-xl border border-pitch-800 px-3 py-2.5 text-sm">
                <div className="flex items-center gap-1.5 text-ink-0"><i className={`h-2 w-2 rounded-full ${dot(s.team === home)}`} />{s.team}</div>
                <div className="mt-0.5 text-ink-1">{s.n} {s.kind} <span className="text-ink-2">· {s.xg.toFixed(2)} xG</span></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

import { useMemo, useState } from "react";
import { api, type Fixture } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { Chip, Empty, HeadRow, SearchBox, SkeletonRows, Table, matches } from "../components/list";
import { LoadError } from "../components/LoadError";

const fmtDate = (k: string) => {
  const d = new Date(k);
  return isNaN(+d) ? k : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
};
const fmtTime = (k: string) => (k.includes("T") ? k.split("T")[1].slice(0, 5) : "");

export function Fixtures() {
  const comps = useAsync(() => api.fixtureComps(), []);
  const [code, setCode] = useState("");
  const [tab, setTab] = useState<"table" | "results" | "upcoming">("table");
  const [q, setQ] = useState("");
  const list = comps.data?.competitions ?? [];
  const active = code || list.find((c) => c.competition_code === "PL")?.competition_code || list[0]?.competition_code || "";
  const info = list.find((c) => c.competition_code === active);
  const table = useAsync(() => api.standings(active), [active], !!active);
  const fx = useAsync(() => api.fixtures(active), [active], !!active);

  const rows = useMemo(() => (fx.data?.fixtures ?? []).filter((f) => matches(q, f.home, f.away)), [fx.data, q]);
  const results = rows.filter((f) => f.status === "FINISHED").sort((a, b) => b.kickoff.localeCompare(a.kickoff));
  const upcoming = rows.filter((f) => f.status !== "FINISHED").sort((a, b) => a.kickoff.localeCompare(b.kickoff));

  if (comps.failed) return <LoadError error="unavailable" what="page" backTo="/" backLabel="Back home" />;
  return (
    <div className="mx-auto max-w-[1440px] px-6 py-12 lg:px-10">
      <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] text-ink-0">Fixtures and standings</h1>
      <p className="mt-2 max-w-2xl text-ink-1">The current season in the major leagues: the table, recent results and what's next.</p>

      <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="League">
        {list.map((c) => <Chip key={c.competition_code} on={c.competition_code === active} onClick={() => setCode(c.competition_code)}>{c.competition}</Chip>)}
      </div>
      {info && (
        <p className="mt-3 text-xs text-ink-2">
          {info.season} · {info.finished} of {info.n} matches played · Data from {info.source}, updated {new Date(info.updated_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}. Kick-off times are local to the match.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2" role="tablist" aria-label="View">
        {([["table", "Table"], ["results", "Results"], ["upcoming", "Upcoming"]] as const).map(([k, label]) => <Chip key={k} on={tab === k} onClick={() => setTab(k)}>{label}</Chip>)}
        {tab !== "table" && <div className="ml-auto"><SearchBox value={q} onChange={setQ} placeholder="Search a team" /></div>}
      </div>

      {tab === "table" && (
        <Table>
          <HeadRow cols="grid-cols-[2rem_minmax(0,1fr)_2.5rem_3rem] sm:grid-cols-[2rem_minmax(0,1fr)_2.5rem_2.5rem_2.5rem_2.5rem_3.5rem_3rem]">
            <span className="text-right">#</span><span>Team</span><span className="text-right">P</span>
            <span className="hidden text-right sm:block">W</span><span className="hidden text-right sm:block">D</span><span className="hidden text-right sm:block">L</span>
            <span className="hidden text-right sm:block">GD</span><span className="text-right">Pts</span>
          </HeadRow>
          {!table.data && !table.failed && <SkeletonRows />}
          {table.failed && <Empty>The table isn't available for this league yet.</Empty>}
          {table.data && table.data.table.length === 0 && <Empty>No matches have been played yet this season.</Empty>}
          <div className="divide-y divide-pitch-800">
            {table.data?.table.map((r) => (
              <div key={r.team} className="grid grid-cols-[2rem_minmax(0,1fr)_2.5rem_3rem] items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-pitch-800/40 sm:grid-cols-[2rem_minmax(0,1fr)_2.5rem_2.5rem_2.5rem_2.5rem_3.5rem_3rem]">
                <span className="text-right text-xs tabular-nums text-ink-2">{r.position}</span>
                <span className="truncate font-medium text-ink-0">{r.team}</span>
                <span className="text-right font-mono text-xs tabular-nums text-ink-1">{r.played}</span>
                <span className="hidden text-right font-mono text-xs tabular-nums text-ink-1 sm:block">{r.won}</span>
                <span className="hidden text-right font-mono text-xs tabular-nums text-ink-1 sm:block">{r.drawn}</span>
                <span className="hidden text-right font-mono text-xs tabular-nums text-ink-1 sm:block">{r.lost}</span>
                <span className="hidden text-right font-mono text-xs tabular-nums text-ink-1 sm:block">{r.goal_diff > 0 ? "+" : ""}{r.goal_diff}</span>
                <span className="text-right font-mono text-sm font-semibold tabular-nums text-ink-0">{r.points}</span>
              </div>
            ))}
          </div>
        </Table>
      )}

      {tab !== "table" && (
        <>
          {fx.failed && <Empty>Fixtures aren't available for this league yet.</Empty>}
          {!fx.data && !fx.failed && <Table><SkeletonRows /></Table>}
          {fx.data && <FixtureList fixtures={tab === "results" ? results : upcoming} empty={tab === "results" ? "No results yet this season." : "No upcoming matches found."} />}
        </>
      )}
    </div>
  );
}

function FixtureList({ fixtures, empty }: { fixtures: Fixture[]; empty: string }) {
  const [shown, setShown] = useState(60);
  if (fixtures.length === 0) return <Table><Empty>{empty}</Empty></Table>;
  const groups: [string, Fixture[]][] = [];
  for (const f of fixtures.slice(0, shown)) {
    const k = f.matchday ?? "Fixtures";
    const g = groups[groups.length - 1];
    if (g && g[0] === k) g[1].push(f); else groups.push([k, [f]]);
  }
  return (
    <div className="mt-4 space-y-6">
      {groups.map(([day, fs]) => (
        <section key={day}>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-2">{day}</h2>
          <div className="overflow-hidden rounded-2xl border border-pitch-800 bg-pitch-900">
            <div className="divide-y divide-pitch-800">
              {fs.map((f) => {
                const played = f.status === "FINISHED" && f.home_score != null;
                return (
                  <div key={f.match_id} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-4 py-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)_auto_minmax(0,1fr)]">
                    <span className="text-xs text-ink-2">{fmtDate(f.kickoff)}<span className="hidden sm:inline">{fmtTime(f.kickoff) && ` · ${fmtTime(f.kickoff)}`}</span></span>
                    <span className="truncate text-right font-medium text-ink-0">{f.home}</span>
                    <span className={`min-w-[3.5rem] rounded-lg px-2.5 py-1 text-center font-semibold tabular-nums ${played ? "bg-pitch-800/70 text-ink-0" : "text-ink-2"}`}>{played ? `${f.home_score}–${f.away_score}` : "v"}</span>
                    <span className="truncate font-medium text-ink-0">{f.away}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ))}
      {fixtures.length > shown && <button type="button" onClick={() => setShown((n) => n + 60)} className="w-full rounded-2xl border border-pitch-800 py-3 text-sm font-semibold text-marker-bright hover:bg-pitch-900">Show more ({fixtures.length - shown} left)</button>}
    </div>
  );
}

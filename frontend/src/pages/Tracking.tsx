import { useMemo, useState } from "react";
import { api, type PhysicalRow } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { Pitch } from "../components/pitch/Pitch";
import { Chip, Empty, HeadRow, SkeletonRows, SortHead, Table, useSort } from "../components/list";
import { displayName } from "../lib/names";

const METRICS: [string, string][] = [["sprints", "Sprints"], ["hsr_m", "High-speed running (m)"], ["sprint_m", "Sprint distance (m)"], ["distance_per_tracked_min", "Distance per minute"], ["top_speed_kmh", "Top speed (km/h)"]];

/** A heat-map of who controls which part of the pitch; each team is shown attacking to the right. */
function ControlMap({ grid, color }: { grid: number[][]; color: string }) {
  const nx = grid.length, ny = grid[0]?.length ?? 0;
  const cw = 120 / nx, ch = 80 / ny;
  return (
    <Pitch>
      {grid.map((col, i) => col.map((v, j) => <rect key={`${i}-${j}`} x={i * cw} y={j * ch} width={cw + 0.05} height={ch + 0.05} fill={color} fillOpacity={Math.pow(v, 1.3) * 0.75} />))}
    </Pitch>
  );
}

export function Tracking() {
  const rows = useAsync(() => api.trackingRows(), []);
  const matchesList = useMemo(() => {
    const by = new Map<string, string[]>();
    for (const r of rows.data?.rows ?? []) {
      if (r.provider !== "skillcorner_open_data") continue;
      const t = by.get(r.provider_match_id) ?? [];
      t[r.is_home ? 0 : 1] = r.team_name;
      by.set(r.provider_match_id, t);
    }
    const short = (n?: string) => (n ?? "").replace(/ Football Club$| FC$/, "");
    return [...by.entries()].map(([id, t]) => ({ id, label: `${short(t[0])} v ${short(t[1])}` }));
  }, [rows.data]);
  const [sel, setSel] = useState("");
  const id = sel || matchesList[0]?.id || "";
  const pc = useAsync(() => api.pitchControl(id), [id], !!id);
  const ph = useAsync(() => api.physical(id), [id], !!id);
  const [metric, setMetric] = useState("sprints");
  const lead = useAsync(() => api.physicalLeaders(metric), [metric]);
  const { sort, dir, onSort } = useSort<keyof PhysicalRow>("sprints");
  const players = useMemo(() => [...(ph.data?.players ?? [])].sort((a, b) => {
    const x = a[sort], y = b[sort];
    return (typeof x === "string" ? String(x).localeCompare(String(y)) : Number(x) - Number(y)) * dir;
  }), [ph.data, sort, dir]);
  const cols = "grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_3.5rem] md:grid-cols-[minmax(0,1fr)_minmax(0,9rem)_4rem_5rem_4.5rem_4.5rem_4rem_4.5rem]";

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-12 lg:px-10">
      <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] text-ink-0">Tracking</h1>
      <p className="mt-2 max-w-2xl text-ink-1">Who controlled the space, and how hard each player worked, from broadcast tracking of A-League matches.</p>

      <div className="mt-6">
        {rows.data && matchesList.length === 0 && <p className="text-sm text-ink-2">No tracked matches are available yet.</p>}
        {matchesList.length > 0 && (
          <select value={id} onChange={(e) => setSel(e.target.value)} aria-label="Match" className="w-full max-w-xl rounded-xl border border-pitch-700 bg-pitch-900 px-3 py-2.5 text-sm text-ink-0 outline-none focus:border-marker-bright">
            {matchesList.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        )}
      </div>

      <section className="mt-8">
        <h2 className="font-display text-2xl font-bold text-ink-0">Pitch control</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-1">The brighter an area, the more likely that team could reach the ball there first. Each team is shown attacking to the right.</p>
        {pc.failed && <Empty>Pitch control isn't available for this match.</Empty>}
        {!pc.data && !pc.failed && <div className="mt-4 h-64 animate-pulse rounded-2xl bg-pitch-800/30" />}
        {pc.data && (
          <>
            <div className="mt-4 grid gap-5 lg:grid-cols-2">
              {pc.data.teams.map((t, i) => (
                <div key={t.team} className="rounded-2xl border border-pitch-800 bg-pitch-900 p-4">
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <h3 className="flex items-center gap-2 font-display text-lg font-bold text-ink-0"><i className={`h-2.5 w-2.5 rounded-full ${i === 0 ? "bg-team-a" : "bg-team-b"}`} />{t.team.replace(/ Football Club$| FC$/, "")}</h3>
                    <span className="text-xs text-ink-2">{Math.round(t.control_share * 100)}% overall · {Math.round(t.control_share_attacking_third * 100)}% in the attacking third</span>
                  </div>
                  <ControlMap grid={t.grid} color={i === 0 ? "var(--color-team-a)" : "var(--color-team-b)"} />
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-2">{pc.data.note}</p>
          </>
        )}
      </section>

      <section className="mt-12">
        <h2 className="font-display text-2xl font-bold text-ink-0">Physical output</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-1">Compare players per minute tracked, because broadcast cameras only follow part of the pitch at a time.</p>
        <Table>
          <HeadRow cols={cols}>
            <SortHead k="player" sort={sort} dir={dir} onSort={(k) => onSort(k, true)} align="left">Player</SortHead>
            <span className="hidden md:block">Team</span>
            <span className="hidden md:block"><SortHead k="tracked_min" sort={sort} dir={dir} onSort={onSort}>Tracked</SortHead></span>
            <SortHead k="distance_per_tracked_min" sort={sort} dir={dir} onSort={onSort}>m / min</SortHead>
            <SortHead k="hsr_m" sort={sort} dir={dir} onSort={onSort}>HSR m</SortHead>
            <span className="hidden md:block"><SortHead k="sprint_m" sort={sort} dir={dir} onSort={onSort}>Sprint m</SortHead></span>
            <SortHead k="sprints" sort={sort} dir={dir} onSort={onSort}>Sprints</SortHead>
            <span className="hidden md:block"><SortHead k="top_speed_kmh" sort={sort} dir={dir} onSort={onSort}>Top km/h</SortHead></span>
          </HeadRow>
          {!ph.data && !ph.failed && <SkeletonRows />}
          {ph.failed && <Empty>Physical data isn't available for this match.</Empty>}
          <div className="divide-y divide-pitch-800">
            {players.map((p, i) => (
              <div key={`${p.player}-${i}`} className={`grid items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-pitch-800/40 ${cols}`}>
                <span className="min-w-0"><span className="block truncate font-medium text-ink-0">{displayName(p.player, p.display_name)}</span><span className="block text-xs text-ink-2 md:hidden">{p.team.replace(/ Football Club$| FC$/, "")}</span></span>
                <span className="hidden truncate text-xs text-ink-1 md:block">{p.team.replace(/ Football Club$| FC$/, "")}</span>
                <span className="hidden text-right font-mono text-xs tabular-nums text-ink-2 md:block">{p.tracked_min.toFixed(0)}′</span>
                <span className="text-right font-mono text-xs tabular-nums text-ink-1">{p.distance_per_tracked_min.toFixed(0)}</span>
                <span className="text-right font-mono text-xs tabular-nums text-ink-1">{p.hsr_m.toFixed(0)}</span>
                <span className="hidden text-right font-mono text-xs tabular-nums text-ink-1 md:block">{p.sprint_m.toFixed(0)}</span>
                <span className="text-right font-mono text-sm font-semibold tabular-nums text-ink-0">{p.sprints}</span>
                <span className="hidden text-right font-mono text-xs tabular-nums text-ink-1 md:block">{p.top_speed_kmh.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </Table>
        {ph.data && <p className="mt-2 text-xs text-ink-2">{ph.data.note}</p>}
      </section>

      <section className="mt-12">
        <h2 className="font-display text-2xl font-bold text-ink-0">Leaders across all tracked matches</h2>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Leaderboard metric">
          {METRICS.map(([k, label]) => <Chip key={k} on={metric === k} onClick={() => setMetric(k)}>{label}</Chip>)}
        </div>
        <Table>
          {!lead.data && !lead.failed && <SkeletonRows n={6} />}
          {lead.failed && <Empty>The leaderboard isn't available right now.</Empty>}
          <ul className="divide-y divide-pitch-800">
            {lead.data?.players.map((p, i) => (
              <li key={`${p.player}-${i}`} className="grid grid-cols-[2rem_minmax(0,1fr)_4.5rem] items-center gap-3 px-4 py-3 text-sm">
                <span className="text-right text-xs tabular-nums text-ink-2">{i + 1}</span>
                <span className="min-w-0"><span className="block truncate font-medium text-ink-0">{displayName(p.player, p.display_name)}</span><span className="block truncate text-xs text-ink-2">{p.team.replace(/ Football Club$| FC$/, "")} · {p.tracked_min.toFixed(0)} min tracked</span></span>
                <span className="text-right font-mono text-sm font-semibold tabular-nums text-marker-bright">{Number(p[metric as keyof PhysicalRow]).toFixed(metric === "top_speed_kmh" ? 1 : 0)}</span>
              </li>
            ))}
          </ul>
        </Table>
        {lead.data && <p className="mt-2 text-xs text-ink-2">{lead.data.note}</p>}
      </section>
    </div>
  );
}

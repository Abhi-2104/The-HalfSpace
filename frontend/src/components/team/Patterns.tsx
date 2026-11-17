import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { Chip, Empty, HeadRow, SkeletonRows, SortHead, Table, useSort } from "../list";

const KINDS = [["corner", "Corners"], ["free_kick", "Free kicks"], ["counter", "Counterattacks"]] as const;
type Key = "team" | "n" | "per_match" | "xg" | "xg_each" | "goals";

/** How each team does from corners, free kicks or counterattacks, ranked by chance quality created each time. */
export function Patterns({ competitionId, seasonId }: { competitionId: number; seasonId: number }) {
  const [kind, setKind] = useState<(typeof KINDS)[number][0]>("corner");
  const { data, failed } = useAsync(() => api.patterns(competitionId, seasonId, kind), [competitionId, seasonId, kind]);
  const { sort, dir, onSort } = useSort<Key>("xg_each");
  const rows = useMemo(() => [...(data?.teams ?? [])].sort((a, b) => (sort === "team" ? a.team.localeCompare(b.team) * dir : (a[sort] - b[sort]) * dir)), [data, sort, dir]);
  const top = Math.max(...rows.map((r) => r.xg_each), 1e-9);
  const cols = "grid-cols-[2rem_minmax(0,1fr)_4rem_4.5rem] md:grid-cols-[2rem_minmax(0,1fr)_minmax(0,12rem)_4rem_5rem_5rem_4.5rem]";
  const noun = kind === "corner" ? "corner" : kind === "free_kick" ? "free kick" : "counterattack";
  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Type of possession">
        {KINDS.map(([k, label]) => <Chip key={k} on={kind === k} onClick={() => setKind(k)}>{label}</Chip>)}
      </div>
      <p className="mt-3 max-w-2xl text-sm text-ink-1">How much danger each team creates per {noun}. Higher means better chances from the same situation.</p>
      <Table>
        <HeadRow cols={cols}>
          <span className="text-right">#</span>
          <SortHead k="team" sort={sort} dir={dir} onSort={(k) => onSort(k, true)} align="left">Team</SortHead>
          <span className="hidden md:block" />
          <SortHead k="n" sort={sort} dir={dir} onSort={onSort}>Total</SortHead>
          <SortHead k="xg_each" sort={sort} dir={dir} onSort={onSort}>xG each</SortHead>
          <span className="hidden md:block"><SortHead k="per_match" sort={sort} dir={dir} onSort={onSort}>Per match</SortHead></span>
          <span className="hidden md:block"><SortHead k="goals" sort={sort} dir={dir} onSort={onSort}>Goals</SortHead></span>
        </HeadRow>
        {!data && !failed && <SkeletonRows />}
        {failed && <Empty>This is unavailable right now.</Empty>}
        {data && rows.length === 0 && <Empty>No data for this league season yet.</Empty>}
        <div className="divide-y divide-pitch-800">
          {rows.map((t, i) => (
            <div key={t.team_id} className={`grid items-center gap-3 px-4 py-3 transition-colors hover:bg-pitch-800/40 ${cols}`}>
              <span className="text-right text-xs tabular-nums text-ink-2">{i + 1}</span>
              <span className="truncate font-medium text-ink-0">{t.team}</span>
              <span className="hidden h-2 overflow-hidden rounded-full bg-pitch-800 md:block" aria-hidden><span className="block h-full rounded-full bg-marker" style={{ width: `${(t.xg_each / top) * 100}%` }} /></span>
              <span className="text-right font-mono text-xs tabular-nums text-ink-1">{t.n}</span>
              <span className="text-right font-mono text-sm font-semibold tabular-nums text-marker-bright">{t.xg_each.toFixed(3)}</span>
              <span className="hidden text-right font-mono text-xs tabular-nums text-ink-1 md:block">{t.per_match.toFixed(1)}</span>
              <span className="hidden text-right font-mono text-xs tabular-nums text-ink-1 md:block">{t.goals}</span>
            </div>
          ))}
        </div>
      </Table>
      {data && <p className="mt-2 text-xs text-ink-2">{data.note}</p>}
    </div>
  );
}

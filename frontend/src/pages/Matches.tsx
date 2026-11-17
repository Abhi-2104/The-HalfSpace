import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type MatchSummary } from "../lib/api";
import { useCompetitionSelection } from "../lib/useCompetitionSelection";
import { CompetitionPicker } from "../components/CompetitionPicker";
import { CoverageStrip } from "../components/CoverageStrip";
import { useAsync } from "../lib/useAsync";
import { Chip, Empty, SearchBox, SkeletonRows, Table, Toolbar, matches, useSort } from "../components/list";

const PAGE = 60;
const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const niceDate = (d: string) => (isNaN(Date.parse(d)) ? d : fmt.format(new Date(d)));

export function Matches() {
  const { competitions, competitionId, seasonId, select } = useCompetitionSelection();
  const [list, setList] = useState<MatchSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [tracking, setTracking] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [everywhere, setEverywhere] = useState(false);
  const [term, setTerm] = useState(""); // the search text, settled after typing stops
  const { dir, setDir } = useSort<"date">("date", -1); // newest first

  useEffect(() => {
    if (competitionId == null || seasonId == null) return;
    setList(null);
    setQ(""); setTracking(false);
    api.matches(competitionId, seasonId).then((r) => setList(r.matches));
  }, [competitionId, seasonId]);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  // "barcelona v real madrid" searches that fixture in every season
  const [teamQ, oppQ] = term.split(/\s+(?:v|vs|v\.)\s+/i);
  const remote = useAsync(() => api.searchMatches(teamQ, oppQ), [teamQ, oppQ], everywhere && term.length >= 3);
  useEffect(() => setShown(PAGE), [q, tracking, dir, competitionId, seasonId]);

  const searching = everywhere && term.length >= 3;
  const rows = useMemo(
    () => (searching ? ((remote.data?.matches ?? []) as unknown as MatchSummary[]) : list ?? []).filter((m) => searching || ((!tracking || m.has_tracking) && matches(q, m.home_team, m.away_team, m.match_date)))
      .sort((a, b) => a.match_date.localeCompare(b.match_date) * dir),
    [list, q, tracking, dir, searching, remote.data],
  );
  const anyTracking = !!list?.some((m) => m.has_tracking);
  const filtered = !!(q || tracking);

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-12 lg:px-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] text-ink-0">Matches</h1>
        {competitions && <CompetitionPicker competitions={competitions} competitionId={competitionId} seasonId={seasonId} onSelect={select} />}
      </div>

      <Toolbar count={rows.length} total={searching ? rows.length : list?.length} noun="matches">
        <SearchBox value={q} onChange={setQ} placeholder={everywhere ? "Team, or Team v Team" : "Search a team or date"} />
        <Chip on={everywhere} onClick={() => setEverywhere((v) => !v)}>All seasons</Chip>
        {anyTracking && <Chip on={tracking} onClick={() => setTracking((v) => !v)}>Has tracking data</Chip>}
        <Chip on={false} onClick={() => setDir((d) => (d === 1 ? -1 : 1))}>{dir === -1 ? "Newest first ▼" : "Oldest first ▲"}</Chip>
      </Toolbar>

      <Table>
        {(searching ? !remote.data && !remote.failed : !list) ? <SkeletonRows /> : rows.length === 0 ? (
          <Empty onReset={filtered ? () => { setQ(""); setTracking(false); } : undefined}>
            {filtered ? "No matches fit those filters." : "No matches in this competition and season yet."}
          </Empty>
        ) : (
          <div className="divide-y divide-pitch-800">
            {rows.slice(0, shown).map((m) => {
              const hw = m.home_score > m.away_score, aw = m.away_score > m.home_score;
              return (
                <Link key={m.id} to={`/matches/${m.id}`} className="flex flex-col gap-2 px-4 py-3.5 transition-colors hover:bg-pitch-800/40 sm:grid sm:grid-cols-[7.5rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                  <span className="text-xs text-ink-2">{niceDate(m.match_date)}</span>
                  <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 text-sm">
                    <span className={`truncate text-right ${hw ? "font-semibold text-ink-0" : "text-ink-1"}`}>{m.home_team}</span>
                    <span className="rounded-lg bg-pitch-800/70 px-2.5 py-1 font-semibold tabular-nums text-ink-0">{m.home_score}–{m.away_score}</span>
                    <span className={`truncate ${aw ? "font-semibold text-ink-0" : "text-ink-1"}`}>{m.away_team}</span>
                  </span>
                  {!searching && <CoverageStrip hasEvents={!!m.has_events} hasTracking={!!m.has_tracking} />}
                </Link>
              );
            })}
            {rows.length > shown && (
              <button type="button" onClick={() => setShown((n) => n + PAGE)} className="w-full py-3.5 text-sm font-semibold text-marker-bright transition-colors hover:bg-pitch-800/40">
                Show {Math.min(PAGE, rows.length - shown)} more ({rows.length - shown} left)
              </button>
            )}
          </div>
        )}
      </Table>
    </div>
  );
}

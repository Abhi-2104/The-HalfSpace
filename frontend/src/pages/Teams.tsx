import { useEffect, useMemo, useState } from "react";
import { api, type TeamProfile } from "../lib/api";
import { useCompetitionSelection } from "../lib/useCompetitionSelection";
import { CompetitionPicker } from "../components/CompetitionPicker";
import { useMode } from "../lib/mode";
import { StyleMap } from "../components/team/StyleMap";
import { Patterns } from "../components/team/Patterns";
import { Chip, Empty, HeadRow, SearchBox, SkeletonRows, SortHead, Table, Toolbar, matches, useSort } from "../components/list";

type SortKey = "team" | "matches" | "avg_ppda" | "goals_per_match" | "shots_per_match";

export function Teams() {
  const { mode } = useMode();
  const analyst = mode === "analyst";
  const { competitions, competitionId, seasonId, select } = useCompetitionSelection();
  const [teams, setTeams] = useState<TeamProfile[] | null>(null);
  const [q, setQ] = useState("");
  const [reliable, setReliable] = useState(false);
  const [tab, setTab] = useState<"press" | "style" | "setpieces">("press");
  const { sort, dir, onSort } = useSort<SortKey>("avg_ppda", 1); // most aggressive press first

  useEffect(() => {
    if (competitionId == null || seasonId == null) return;
    setTeams(null);
    setQ(""); setReliable(false);
    api.seasonTeams(competitionId, seasonId).then((r) => setTeams(r.teams));
  }, [competitionId, seasonId]);

  const rows = useMemo(() => {
    const list = (teams ?? []).filter((t) => (!reliable || !t.low_sample) && matches(q, t.team));
    return list.sort((a, b) => {
      if (sort === "team") return a.team.localeCompare(b.team) * dir;
      const x = a[sort] ?? Infinity, y = b[sort] ?? Infinity; // teams without PPDA sink to the bottom
      return (x - y) * dir;
    });
  }, [teams, q, reliable, sort, dir]);
  const maxPpda = Math.max(...(teams ?? []).map((t) => t.avg_ppda ?? 0), 1e-9);
  const hasLow = !!teams?.some((t) => t.low_sample);
  const cols = analyst
    ? "grid-cols-[2rem_minmax(0,1fr)_3.5rem_4rem_4rem_4.5rem] md:grid-cols-[2rem_minmax(0,1fr)_minmax(0,12rem)_4rem_5rem_5rem_5rem]"
    : "grid-cols-[2rem_minmax(0,1fr)_4rem] sm:grid-cols-[2rem_minmax(0,1fr)_minmax(0,16rem)_4rem_5rem]";
  const reset = () => { setQ(""); setReliable(false); };

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-12 lg:px-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] text-ink-0">Teams</h1>
        {competitions && <CompetitionPicker competitions={competitions} competitionId={competitionId} seasonId={seasonId} onSelect={select} />}
      </div>
      <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="Teams views">
        {([["press", "Pressing"], ["style", "Style map"], ["setpieces", "Set pieces and counters"]] as const).map(([k, label]) => (
          <Chip key={k} on={tab === k} onClick={() => setTab(k)}>{label}</Chip>
        ))}
      </div>
      {tab === "style" && competitionId != null && seasonId != null && <StyleMap competitionId={competitionId} seasonId={seasonId} />}
      {tab === "setpieces" && competitionId != null && seasonId != null && <Patterns competitionId={competitionId} seasonId={seasonId} />}
      {tab === "press" && <>
      <p className="mt-1 max-w-2xl text-xs text-ink-2">
        {analyst
          ? "PPDA: opposition passes allowed per defensive action. Lower = more aggressive press. See Tactics → High press."
          : "Teams ranked by how hard they press. A shorter bar means the team lets the opponent make fewer passes before stepping in."}
      </p>

      <Toolbar count={rows.length} total={teams?.length} noun="teams">
        <SearchBox value={q} onChange={setQ} placeholder="Search team" />
        {hasLow && <Chip on={reliable} onClick={() => setReliable((v) => !v)}>Hide low-sample teams</Chip>}
      </Toolbar>

      <Table>
        <HeadRow cols={cols}>
          <span className="text-right">#</span>
          <SortHead k="team" sort={sort} dir={dir} onSort={(k) => onSort(k, true)} align="left">Team</SortHead>
          <span className={analyst ? "hidden md:block" : "hidden sm:block"} />
          <SortHead k="avg_ppda" sort={sort} dir={dir} onSort={(k) => onSort(k, true)}>PPDA</SortHead>
          {analyst ? (
            <>
              <SortHead k="goals_per_match" sort={sort} dir={dir} onSort={onSort}>Goals/m</SortHead>
              <SortHead k="shots_per_match" sort={sort} dir={dir} onSort={onSort}>Shots/m</SortHead>
              <SortHead k="matches" sort={sort} dir={dir} onSort={onSort}>Matches</SortHead>
            </>
          ) : (
            <span className="hidden sm:block"><SortHead k="goals_per_match" sort={sort} dir={dir} onSort={onSort}>Goals/m</SortHead></span>
          )}
        </HeadRow>
        {!teams ? <SkeletonRows /> : rows.length === 0 ? (
          <Empty onReset={q || reliable ? reset : undefined}>{q || reliable ? "No teams match those filters." : "No team data for this competition yet."}</Empty>
        ) : (
          <div className="divide-y divide-pitch-800">
            {rows.map((t, i) => (
              <div key={t.team_id} className={`grid items-center gap-3 px-4 py-3 transition-colors hover:bg-pitch-800/40 ${cols}`}>
                <span className="text-right text-xs tabular-nums text-ink-2">{i + 1}</span>
                <div className="min-w-0">
                  <span className="truncate font-medium text-ink-0">{t.team}</span>
                  {t.low_sample && <span className="ml-2 rounded-md bg-clay/15 px-1.5 py-0.5 font-mono text-[10px] text-clay">low sample</span>}
                </div>
                <div className={`hidden h-2 overflow-hidden rounded-full bg-pitch-800 ${analyst ? "md:block" : "sm:block"}`} aria-hidden>
                  <div className="h-full rounded-full bg-marker-bright transition-[width] duration-500" style={{ width: `${((t.avg_ppda ?? 0) / maxPpda) * 100}%` }} />
                </div>
                <span className="text-right font-mono text-sm tabular-nums text-marker-bright">{t.avg_ppda?.toFixed(2) ?? "—"}</span>
                <span className={`text-right font-mono text-xs tabular-nums text-ink-1 ${analyst ? "" : "hidden sm:block"}`}>{t.goals_per_match.toFixed(2)}</span>
                {analyst && (
                  <>
                    <span className="text-right font-mono text-xs tabular-nums text-ink-1">{t.shots_per_match.toFixed(1)}</span>
                    <span className="text-right font-mono text-xs tabular-nums text-ink-2">{t.matches}</span>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </Table>
      </>}
    </div>
  );
}

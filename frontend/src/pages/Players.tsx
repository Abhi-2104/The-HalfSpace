import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type PlayerProfile } from "../lib/api";
import { useCompetitionSelection } from "../lib/useCompetitionSelection";
import { CompetitionPicker } from "../components/CompetitionPicker";
import { useMode } from "../lib/mode";
import { Leaders } from "../components/player/Leaders";
import { Goalkeepers } from "../components/player/Goalkeepers";
import { Chip, Empty, FilterSelect, HeadRow, SearchBox, SkeletonRows, SortHead, Table, Toolbar, matches, useSort } from "../components/list";

type SortKey = "name" | "minutes" | "goals_p90" | "prog_passes_p90" | "dribbles_completed_p90" | "pressures_p90";
const METRICS: [Exclude<SortKey, "name" | "minutes">, string][] = [
  ["goals_p90", "Goals/90"],
  ["prog_passes_p90", "Prog. passes/90"],
  ["dribbles_completed_p90", "Dribbles/90"],
  ["pressures_p90", "Pressures/90"],
];
const PLAIN: Record<string, string> = {
  goals_p90: "Goals per 90: how often a player scores, scaled to a full match so players with different minutes are comparable.",
  prog_passes_p90: "Progressive passes per 90: passes that move the ball well towards goal, a sign of who drives the team forward.",
  dribbles_completed_p90: "Dribbles per 90: how often a player beats an opponent on the ball.",
  pressures_p90: "Pressures per 90: how often a player closes down an opponent, a measure of work off the ball.",
};
const PAGE = 50;

export function Players() {
  const { mode } = useMode();
  const analyst = mode === "analyst";
  const { competitions, competitionId, seasonId, select } = useCompetitionSelection();
  const [players, setPlayers] = useState<PlayerProfile[] | null>(null);
  const [minMinutes, setMinMinutes] = useState<number | null>(null); // the API's own floor, not a number baked into the page
  const [q, setQ] = useState("");
  const [team, setTeam] = useState("");
  const [position, setPosition] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [tab, setTab] = useState<"table" | "leaders" | "keepers">("table");
  const { sort, dir, onSort } = useSort<SortKey>("goals_p90");
  const metric = METRICS.some(([k]) => k === sort) ? (sort as Exclude<SortKey, "name" | "minutes">) : "goals_p90";

  useEffect(() => {
    if (competitionId == null || seasonId == null) return;
    setPlayers(null);
    setTeam(""); setPosition(""); setQ("");
    api.seasonPlayers(competitionId, seasonId).then((r) => { setPlayers(r.players); setMinMinutes(r.min_minutes); });
  }, [competitionId, seasonId]);
  useEffect(() => setShown(PAGE), [q, team, position, sort, dir, competitionId, seasonId]);

  const teams = useMemo(() => [...new Set((players ?? []).map((p) => p.team))].sort(), [players]);
  const positions = useMemo(() => [...new Set((players ?? []).map((p) => p.position))].sort(), [players]);
  const rows = useMemo(() => {
    const list = (players ?? []).filter((p) => (!team || p.team === team) && (!position || p.position === position) && matches(q, p.name, p.team));
    return list.sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) * dir : ((a[sort] as number) - (b[sort] as number)) * dir));
  }, [players, q, team, position, sort, dir]);
  const top = Math.max(...rows.map((p) => p[metric]), 1e-9); // bars are relative to the leader of the current view
  const filtered = !!(q || team || position);
  const cols = analyst
    ? "grid-cols-[2rem_minmax(0,1fr)_4.5rem_4.5rem_4.5rem_4.5rem_4.5rem] md:grid-cols-[2rem_minmax(0,1fr)_5rem_5rem_5rem_5rem_5rem]"
    : "grid-cols-[2rem_minmax(0,1fr)_4.5rem] sm:grid-cols-[2rem_minmax(0,1fr)_minmax(0,14rem)_4.5rem]";

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-12 lg:px-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] text-ink-0">Players</h1>
        {competitions && <CompetitionPicker competitions={competitions} competitionId={competitionId} seasonId={seasonId} onSelect={select} />}
      </div>
      {minMinutes != null && <p className="mt-1 text-xs text-ink-2">Minimum {minMinutes.toLocaleString()} minutes played: a reliability floor, not an arbitrary cutoff.</p>}
      <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="Players views">
        {([["table", "Season table"], ["leaders", "Leaders"], ["keepers", "Goalkeepers"]] as const).map(([k, label]) => (
          <Chip key={k} on={tab === k} onClick={() => setTab(k)}>{label}</Chip>
        ))}
      </div>
      {tab === "leaders" && competitionId != null && seasonId != null && <Leaders competitionId={competitionId} seasonId={seasonId} />}
      {tab === "keepers" && competitionId != null && seasonId != null && <Goalkeepers competitionId={competitionId} seasonId={seasonId} />}
      {tab === "table" && <>
      {!analyst && <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-1">{PLAIN[metric]}</p>}

      <Toolbar count={rows.length} total={players?.length} noun="players">
        <SearchBox value={q} onChange={setQ} placeholder="Search player or team" />
        <FilterSelect value={team} onChange={setTeam} label="Team" options={teams} />
        <FilterSelect value={position} onChange={setPosition} label="Position" options={positions} />
      </Toolbar>
      {!analyst && (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Rank by">
          {METRICS.map(([k, label]) => <Chip key={k} on={metric === k} onClick={() => { if (metric !== k) onSort(k); }}>{label}</Chip>)}
        </div>
      )}

      <Table>
        <HeadRow cols={cols}>
          <span className="text-right">#</span>
          <SortHead k="name" sort={sort} dir={dir} onSort={(k) => onSort(k, true)} align="left">Player</SortHead>
          {analyst ? (
            <>
              <SortHead k="minutes" sort={sort} dir={dir} onSort={onSort}>Mins</SortHead>
              {METRICS.map(([k, label]) => <SortHead key={k} k={k} sort={sort} dir={dir} onSort={onSort}>{label.replace("/90", "")}</SortHead>)}
            </>
          ) : (
            <>
              <span className="hidden sm:block" />
              <SortHead k={metric} sort={sort} dir={dir} onSort={onSort}>{METRICS.find(([k]) => k === metric)![1]}</SortHead>
            </>
          )}
        </HeadRow>
        {!players ? <SkeletonRows /> : rows.length === 0 ? (
          <Empty onReset={filtered ? () => { setQ(""); setTeam(""); setPosition(""); } : undefined}>
            {filtered ? "No players match those filters." : "No players with enough minutes in this competition yet."}
          </Empty>
        ) : (
          <div className="divide-y divide-pitch-800">
            {rows.slice(0, shown).map((p, i) => (
              <Link
                key={p.player_id}
                to={`/players/${p.player_id}?competition_id=${competitionId}&season_id=${seasonId}`}
                className={`grid items-center gap-3 px-4 py-3 transition-colors hover:bg-pitch-800/40 ${cols}`}
              >
                <span className="text-right text-xs tabular-nums text-ink-2">{i + 1}</span>
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink-0">{p.name}</div>
                  <div className="truncate text-xs text-ink-2">{p.team} · {p.position}</div>
                </div>
                {analyst ? (
                  <>
                    <span className="text-right font-mono text-xs tabular-nums text-ink-2">{Math.round(p.minutes).toLocaleString()}</span>
                    {METRICS.map(([k]) => (
                      <span key={k} className={`text-right font-mono text-sm tabular-nums ${k === sort ? "font-semibold text-marker-bright" : "text-ink-1"}`}>{p[k].toFixed(2)}</span>
                    ))}
                  </>
                ) : (
                  <>
                    <div className="hidden h-2 overflow-hidden rounded-full bg-pitch-800 sm:block" aria-hidden>
                      <div className="h-full rounded-full bg-marker" style={{ width: `${(p[metric] / top) * 100}%` }} />
                    </div>
                    <span className="text-right text-sm font-semibold tabular-nums text-marker-bright">{p[metric].toFixed(2)}</span>
                  </>
                )}
              </Link>
            ))}
            {rows.length > shown && (
              <button type="button" onClick={() => setShown((n) => n + PAGE)} className="w-full py-3.5 text-sm font-semibold text-marker-bright transition-colors hover:bg-pitch-800/40">
                Show {Math.min(PAGE, rows.length - shown)} more ({rows.length - shown} left)
              </button>
            )}
          </div>
        )}
      </Table>
      </>}
    </div>
  );
}

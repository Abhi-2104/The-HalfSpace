import { useEffect, useState } from "react";
import { api, type PlayerProfile, type TeamProfile } from "../lib/api";
import { useCompetitionSelection } from "../lib/useCompetitionSelection";
import { CompetitionPicker } from "../components/CompetitionPicker";
import { CompareBar } from "../components/CompareBar";

const PLAYER_METRICS: [keyof PlayerProfile, string, boolean][] = [
  ["goals_p90", "Goals/90", false],
  ["shots_p90", "Shots/90", false],
  ["key_passes_p90", "Key passes/90", false],
  ["prog_passes_p90", "Progressive passes/90", false],
  ["prog_carries_p90", "Progressive carries/90", false],
  ["dribbles_completed_p90", "Dribbles completed/90", false],
];

export function Compare() {
  const [mode, setMode] = useState<"players" | "teams">("players");
  const { competitions, competitionId, seasonId, select } = useCompetitionSelection();
  const [players, setPlayers] = useState<PlayerProfile[] | null>(null);
  const [teams, setTeams] = useState<TeamProfile[] | null>(null);
  const [idA, setIdA] = useState<number | null>(null);
  const [idB, setIdB] = useState<number | null>(null);
  const [caveat, setCaveat] = useState<string | null>(null);
  const [pA, setPA] = useState<PlayerProfile | null>(null);
  const [pB, setPB] = useState<PlayerProfile | null>(null);
  const [tA, setTA] = useState<TeamProfile | null>(null);
  const [tB, setTB] = useState<TeamProfile | null>(null);

  useEffect(() => {
    if (competitionId == null || seasonId == null) return;
    setIdA(null);
    setIdB(null);
    if (mode === "players") {
      api.seasonPlayers(competitionId, seasonId).then((r) => {
        setPlayers(r.players);
        setIdA(r.players[0]?.player_id ?? null);
        setIdB(r.players[1]?.player_id ?? null);
      });
    } else {
      api.seasonTeams(competitionId, seasonId).then((r) => {
        setTeams(r.teams);
        setIdA(r.teams[0]?.team_id ?? null);
        setIdB(r.teams[1]?.team_id ?? null);
      });
    }
  }, [competitionId, seasonId, mode]);

  useEffect(() => {
    if (idA == null || idB == null || competitionId == null || seasonId == null) return;
    if (mode === "players") {
      api.comparePlayers(idA, idB, competitionId, seasonId).then((r) => {
        setPA(r.player_a);
        setPB(r.player_b);
        setCaveat(r.caveat);
      });
    } else {
      api.compareTeams(idA, idB, competitionId, seasonId).then((r) => {
        setTA(r.team_a);
        setTB(r.team_b);
        setCaveat(r.caveat);
      });
    }
  }, [idA, idB, mode, competitionId, seasonId]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold text-ink-0">Compare</h1>
        <div className="flex gap-2">
          <div className="flex rounded-sm border border-pitch-700 font-mono text-xs uppercase">
            {(["players", "teams"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-2 transition ${mode === m ? "bg-marker text-ink-0" : "text-ink-1 hover:text-ink-0"}`}
              >
                {m}
              </button>
            ))}
          </div>
          {competitions && (
            <CompetitionPicker competitions={competitions} competitionId={competitionId} seasonId={seasonId} onSelect={select} />
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4">
        <EntitySelect
          value={idA}
          onChange={setIdA}
          options={mode === "players" ? players?.map((p) => [p.player_id, p.name] as const) : teams?.map((t) => [t.team_id, t.team] as const)}
        />
        <EntitySelect
          value={idB}
          onChange={setIdB}
          options={mode === "players" ? players?.map((p) => [p.player_id, p.name] as const) : teams?.map((t) => [t.team_id, t.team] as const)}
        />
      </div>

      {caveat && (
        <p className="mt-6 rounded-sm border border-marker/40 bg-marker/10 px-3 py-2 text-sm text-marker-bright">{caveat}</p>
      )}

      {mode === "players" && pA && pB && (
        <div className="mt-8 space-y-5">
          {PLAYER_METRICS.map(([key, label, lowerIsBetter]) => (
            <CompareBar key={key} label={label} nameA={pA.name} nameB={pB.name} valueA={pA[key] as number} valueB={pB[key] as number} lowerIsBetter={lowerIsBetter} />
          ))}
        </div>
      )}

      {mode === "teams" && tA && tB && (
        <div className="mt-8 space-y-5">
          <CompareBar label="PPDA (pressing intensity)" nameA={tA.team} nameB={tB.team} valueA={tA.avg_ppda ?? 0} valueB={tB.avg_ppda ?? 0} lowerIsBetter />
          <CompareBar label="Goals per match" nameA={tA.team} nameB={tB.team} valueA={tA.goals_per_match} valueB={tB.goals_per_match} />
          <CompareBar label="Shots per match" nameA={tA.team} nameB={tB.team} valueA={tA.shots_per_match} valueB={tB.shots_per_match} />
        </div>
      )}
    </div>
  );
}

function EntitySelect({
  value,
  onChange,
  options,
}: {
  value: number | null;
  onChange: (id: number) => void;
  options?: readonly (readonly [number, string])[];
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(Number(e.target.value))}
      className="rounded-sm border border-pitch-700 bg-pitch-900 px-3 py-2 font-mono text-sm text-ink-0 outline-none focus:border-marker-bright"
    >
      {options?.map(([id, name]) => (
        <option key={id} value={id}>{name}</option>
      ))}
    </select>
  );
}

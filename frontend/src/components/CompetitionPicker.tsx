import type { Competition } from "../lib/api";

export function CompetitionPicker({
  competitions,
  competitionId,
  seasonId,
  onSelect,
}: {
  competitions: Competition[];
  competitionId: number | null;
  seasonId: number | null;
  onSelect: (competitionId: number, seasonId: number) => void;
}) {
  const value = competitionId != null && seasonId != null ? `${competitionId}:${seasonId}` : "";
  return (
    <select
      value={value}
      onChange={(e) => {
        const [c, s] = e.target.value.split(":").map(Number);
        onSelect(c, s);
      }}
      className="rounded-sm border border-pitch-700 bg-pitch-900 px-3 py-2 font-mono text-sm text-ink-0 outline-none focus:border-marker-bright"
    >
      {competitions.map((c) => (
        <option key={`${c.competition_id}:${c.season_id}`} value={`${c.competition_id}:${c.season_id}`}>
          {c.competition_name} {c.season_name} ({c.matches})
        </option>
      ))}
    </select>
  );
}

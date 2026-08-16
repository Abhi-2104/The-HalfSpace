import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type Competition } from "./api";

/** Shared across Matches/Players/Teams: pick a competition+season, kept in the URL so links are shareable. */
export function useCompetitionSelection() {
  const [competitions, setCompetitions] = useState<Competition[] | null>(null);
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    api.competitions().then((r) => {
      setCompetitions(r.competitions);
      if (!params.get("competition_id") && r.competitions[0]) {
        setParams({ competition_id: String(r.competitions[0].competition_id), season_id: String(r.competitions[0].season_id) }, { replace: true });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const competitionId = params.get("competition_id") ? Number(params.get("competition_id")) : null;
  const seasonId = params.get("season_id") ? Number(params.get("season_id")) : null;

  function select(competitionId: number, seasonId: number) {
    setParams({ competition_id: String(competitionId), season_id: String(seasonId) });
  }

  return { competitions, competitionId, seasonId, select };
}

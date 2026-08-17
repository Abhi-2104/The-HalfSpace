const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

async function get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const url = new URL(BASE + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export interface Overview {
  matches: number;
  events: number;
  players: number;
  teams: number;
  tracking_matches: number;
}

export interface Competition {
  competition_id: number;
  competition_name: string;
  season_id: number;
  season_name: string;
  matches: number;
}

export interface MatchSummary {
  id: number;
  match_date: string;
  home_score: number;
  away_score: number;
  home_team: string;
  away_team: string;
  has_events: number;
  has_tracking: number;
}

export interface DataCoverage {
  match_id: number;
  has_events: number;
  has_360: number;
  has_tracking: number;
  tracking_variant: string | null;
}

export interface Goal {
  minute: number;
  second: number;
  team_id: number;
  player_id: number;
}

export interface ShotSummaryEntry {
  shots: number;
  goals: number;
}

export interface MatchDetailInfo {
  id: number;
  match_date: string;
  home_score: number;
  away_score: number;
  home_team_id: number;
  away_team_id: number;
  home_team: string;
  away_team: string;
  competition_id: number;
  season_id: number;
  competition_name: string;
  season_name: string;
}

export interface MatchProfile {
  match_id: number;
  coverage: DataCoverage | null;
  shots: Record<string, ShotSummaryEntry>;
  goals: Goal[];
  ppda: Record<string, number>;
  progressive_passes_by_player: Record<string, number>;
}

export interface Shot {
  id: string;
  team_id: number;
  team_name: string;
  player_id: number | null;
  player_name: string | null;
  minute: number;
  second: number;
  x: number;
  y: number;
  outcome_name: string;
  body_part: string | null;
}

export interface Counterattack {
  team_id: number;
  start_minute: number;
  start_second: number;
  trigger_type: string;
  distance_m: number;
  time_to_shot_s: number;
  shooter_player_id: number;
  shot_outcome: string;
  confidence: string;
  method: string;
}

export interface PlayerProfile {
  player_id: number;
  name: string;
  team: string;
  position: string;
  minutes: number;
  goals_p90: number;
  shots_p90: number;
  key_passes_p90: number;
  prog_passes_p90: number;
  prog_carries_p90: number;
  dribbles_completed_p90: number;
  pressures_p90: number;
  touches_p90: number;
}

export interface SimilarPlayersResult {
  target: PlayerProfile;
  peer_group: string;
  peer_group_size: number;
  reliability_note: string | null;
  most_similar: { player_id: number; name: string; team: string; similarity: number; features: Record<string, number> }[];
}

export interface TeamProfile {
  team_id: number;
  team: string;
  matches: number;
  avg_ppda: number | null;
  goals_per_match: number;
  shots_per_match: number;
  low_sample: boolean;
}

export interface TrackingRow {
  provider: string;
  provider_match_id: string;
  team_name: string;
  is_home: number;
  frames_used: number;
  avg_players_tracked: number;
  width_std_y: number;
  length_std_x: number;
  tracking_variant: string;
}

export interface TacticalConceptSummary {
  slug: string;
  name: string;
  confidence: string;
}

export interface TacticalConcept extends TacticalConceptSummary {
  beginner_explanation: string;
  analytical_definition: string;
  detection_method: string | null;
  required_data: string[];
  related_concepts: string[];
  limitations: string;
}

export const api = {
  overview: () => get<Overview>("/overview"),
  competitions: () => get<{ competitions: Competition[] }>("/competitions"),
  matches: (competitionId: number, seasonId: number) =>
    get<{ matches: MatchSummary[] }>("/matches", { competition_id: competitionId, season_id: seasonId }),
  match: (matchId: number) => get<MatchDetailInfo>(`/matches/${matchId}`),
  matchProfile: (matchId: number) => get<MatchProfile>(`/matches/${matchId}/profile`),
  matchShots: (matchId: number) => get<{ match_id: number; shots: Shot[] }>(`/matches/${matchId}/shots`),
  matchSequences: (matchId: number) =>
    get<{ match_id: number; counterattacks: Counterattack[] }>(`/matches/${matchId}/sequences`),
  seasonPlayers: (competitionId: number, seasonId: number) =>
    get<{ players: PlayerProfile[]; min_minutes: number }>(`/competitions/${competitionId}/seasons/${seasonId}/players`),
  similarPlayers: (competitionId: number, seasonId: number, playerId: number) =>
    get<SimilarPlayersResult>(`/competitions/${competitionId}/seasons/${seasonId}/players/${playerId}/similar`),
  comparePlayers: (playerA: number, playerB: number, competitionId: number, seasonId: number) =>
    get<{ player_a: PlayerProfile; player_b: PlayerProfile; diff_a_minus_b: Record<string, number>; role_mismatch: boolean; caveat: string | null }>(
      "/players/compare",
      { player_a: playerA, player_b: playerB, competition_id: competitionId, season_id: seasonId }
    ),
  seasonTeams: (competitionId: number, seasonId: number) =>
    get<{ teams: TeamProfile[] }>(`/competitions/${competitionId}/seasons/${seasonId}/teams`),
  compareTeams: (teamA: number, teamB: number, competitionId: number, seasonId: number) =>
    get<{ team_a: TeamProfile; team_b: TeamProfile; diff_a_minus_b: Record<string, number>; caveat: string | null }>(
      "/teams/compare",
      { team_a: teamA, team_b: teamB, competition_id: competitionId, season_id: seasonId }
    ),
  tracking: (provider?: string) => get<{ rows: TrackingRow[] }>("/tracking", provider ? { provider } : undefined),
  tacticalConcepts: () => get<{ concepts: TacticalConceptSummary[] }>("/tactical-concepts"),
  tacticalConcept: (slug: string) => get<TacticalConcept>(`/tactical-concepts/${slug}`),

  shotsXg: (matchId: number) => get<{ match_id: number; shots: ShotXg[] }>(`/matches/${matchId}/shots-xg`),
  freezeFrame: (eventId: string) => get<FreezeFrame>(`/events/${eventId}/freeze-frame`),
  playerHeatmap: (matchId: number, playerId: number) => get<Heatmap>(`/matches/${matchId}/players/${playerId}/heatmap`),
  seasonPlayerHeatmap: (competitionId: number, seasonId: number, playerId: number) =>
    get<Heatmap>(`/competitions/${competitionId}/seasons/${seasonId}/players/${playerId}/heatmap`),
  teamHeatmap: (matchId: number, teamId: number) => get<Heatmap>(`/matches/${matchId}/teams/${teamId}/heatmap`),
  passNetwork: (matchId: number, teamId: number) => get<PassNetwork>(`/matches/${matchId}/teams/${teamId}/pass-network`),
};

export interface ShotXg extends Shot {
  xg: number | null;
  has_freeze_frame: boolean;
}

export interface FreezeFramePlayer {
  teammate: boolean;
  actor: boolean;
  keeper: boolean;
  location: [number, number];
}

export interface FreezeFrame {
  event_id: string;
  freeze_frame: FreezeFramePlayer[];
  visible_area: number[];
}

export interface Heatmap {
  bins_x: number;
  bins_y: number;
  grid: number[][];
  peak: number;
  touches?: number;
  actions?: number;
}

export interface PassNode {
  player_id: number;
  name: string | null;
  x: number;
  y: number;
  passes: number;
}

export interface PassNetwork {
  match_id: number;
  team_id: number;
  cutoff_minute: number | null;
  cutoff_note: string;
  nodes: PassNode[];
  edges: { a: number; b: number; passes: number }[];
  recipient_note: string;
}

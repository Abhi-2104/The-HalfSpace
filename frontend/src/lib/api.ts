export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";
const BASE = API_BASE;

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

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.detail ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export interface AskAnswer {
  text: string;
  provenance: { tool: string; arguments: Record<string, unknown> }[];
  unresolved_caveats: string[];
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
  display_name?: string | null;
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
  display_name?: string | null;
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
  most_similar: { player_id: number; name: string; display_name?: string | null; team: string; similarity: number; features: Record<string, number> }[];
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

export interface Momentum {
  match_id: number;
  window_minutes: number;
  minutes: number[];
  momentum: number[]; // -100..100, positive = home team on top
  home_threat: number[];
  away_threat: number[];
  xg_cumulative: { home: number[]; away: number[] };
  moments: { minute: number; kind: "goal" | "big_chance"; team_id: number; player: string | null; display_name?: string | null; xg: number; event_id: string; momentum_before: number }[];
  note: string;
  extra_time?: boolean;
  period_ends?: number[];
}
export interface MatchReport { match_id: number; text: string[]; note: string; facts?: Record<string, any> }
export interface PossessionList {
  kind: string;
  possessions: { team: string; team_id: number; minute: number; duration_s: number; passes: number; shots: number; xg: number; goals: number; zone: string | null }[];
  note: string;
}
export interface XgExplain {
  event_id: string;
  xg: number;
  factors: { feature: string; value: number | string; effect: number }[];
  method: string;
}
export interface ScoutMetric { metric: string; label: string; per90: number; per90_adjusted: number; percentile: number }
export interface ScoutingCard {
  player_id: number;
  name: string;
  role: string | null;
  position_group: string;
  minutes: number;
  confidence: number;
  pool_size: number;
  metrics: ScoutMetric[];
  passing: { passes: number; actual_pct: number; expected_pct: number; poe_per100: number; avg_difficulty: number; line_breaks_completed?: number; line_breaks_per_100_passes?: number } | null;
  on_ball_value: { per90: number; per90_adjusted: number; percentile: number; by_action_per90: Record<string, number> } | null;
  note?: string;
}
export interface PlaysLike {
  role: string;
  plays_like: { player_id: number; name: string; display_name?: string | null; competition: string | null; role: string; distance: number }[];
  note: string;
}
export interface Leaders {
  metric: string;
  label: string;
  ranked_by: string;
  players: { player_id: number; name: string; display_name?: string | null; position_group: string; minutes: number; per90: number; adjusted: number; percentile: number; confidence: number }[];
}
export interface Goalkeepers {
  ranked_by: string;
  note: string;
  goalkeepers: { player_id: number; name: string; display_name?: string | null; shots_faced: number; goals_conceded: number; expected_goals_conceded: number; goals_prevented: number; prevented_per_100: number; save_pct: number; expected_save_pct: number }[];
}
export interface TeamStyle { team_id: number; team: string; matches: number; x: number; y: number; archetype: string; cluster: number; z: Record<string, number> }
export interface TeamStyles { teams: TeamStyle[]; note: string }
export interface SimilarStyles { team_id: number; archetype: string; most_similar: { team: string; competition: string | null; distance: number; archetype: string }[] }
export interface PatternRanking {
  kind: string;
  ranked_by: string;
  note: string;
  teams: { team: string; team_id: number; matches: number; n: number; per_match: number; xg: number; xg_each: number; shot_rate: number; goals: number }[];
}
export interface ModelCard { id: string; name: string; limits: string; [k: string]: unknown }
export interface MatchHit { id: number; match_date: string; home_score: number; away_score: number; home_team: string; away_team: string; competition_id: number; season_id: number }

export const api = {
  momentum: (matchId: number) => get<Momentum>(`/matches/${matchId}/momentum`),
  matchReport: (matchId: number) => get<MatchReport>(`/matches/${matchId}/report`),
  possessions: (matchId: number, kind: "counter" | "corner" | "free_kick") => get<PossessionList>(`/matches/${matchId}/possessions/${kind}`),
  xgExplain: (eventId: string) => get<XgExplain>(`/events/${eventId}/xg-explain`),
  scoutingCard: (c: number, s: number, playerId: number) => get<ScoutingCard>(`/competitions/${c}/seasons/${s}/players/${playerId}/profile`),
  playsLike: (c: number, s: number, playerId: number, topN = 8) => get<PlaysLike>(`/competitions/${c}/seasons/${s}/players/${playerId}/plays-like`, { top_n: topN }),
  leaders: (c: number, s: number, metric: string, positionGroup: string, topN = 15) =>
    get<Leaders>(`/competitions/${c}/seasons/${s}/leaders`, { metric, ...(positionGroup ? { position_group: positionGroup } : {}), top_n: topN }),
  goalkeepers: (c: number, s: number, topN = 15) => get<Goalkeepers>(`/competitions/${c}/seasons/${s}/goalkeepers`, { top_n: topN }),
  teamStyles: (c: number, s: number) => get<TeamStyles>(`/competitions/${c}/seasons/${s}/team-styles`),
  similarStyles: (teamId: number, c: number, s: number) => get<SimilarStyles>(`/teams/${teamId}/similar-styles`, { competition_id: c, season_id: s }),
  patterns: (c: number, s: number, kind: "counter" | "corner" | "free_kick") => get<PatternRanking>(`/competitions/${c}/seasons/${s}/patterns/${kind}`),
  models: () => get<{ models: ModelCard[] }>("/models"),
  xtGrid: () => get<{ nx: number; ny: number; values: number[][] }>("/models/xt/grid"),
  searchMatches: (team: string, opponent?: string) => get<{ matches: MatchHit[] }>("/matches/search", { team, ...(opponent ? { opponent } : {}) }),
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
  ask: (question: string, history: { role: "user" | "assistant"; content: string }[]) =>
    post<AskAnswer>("/agent/ask", { question, history }),
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
  display_name?: string | null;
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

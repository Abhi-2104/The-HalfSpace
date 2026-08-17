/**
 * Plain-English explainers for the stats the UI shows. Frontend-static: this is
 * interface microcopy, not data - no reason to round-trip it through the API.
 * Each entry: a beginner sentence, and an optional deeper note for analyst mode.
 * `concept` links to a tactical-ontology slug where one applies.
 */
export interface MetricInfo {
  label: string;
  beginner: string;
  analyst?: string;
  concept?: string; // tactical-concept slug for "learn more"
}

export const GLOSSARY: Record<string, MetricInfo> = {
  xg: {
    label: "xG (expected goals)",
    beginner: "How likely a shot was to become a goal, from 0 to 1 — a tap-in might be 0.7, a long shot 0.03.",
    analyst: "Our own logistic model on shot distance, angle, and header/foot — trained on 12k real shots (AUC 0.79). Not a vendor number; the method is inspectable.",
  },
  ppda: {
    label: "PPDA",
    beginner: "How hard a team presses — passes they let the opponent make before trying to win the ball back. Lower = more aggressive.",
    analyst: "Passes allowed per defensive action in the opponent's build-up zone. A proxy for press intensity, not a direct measure — a team conceding possession high up can look similar.",
    concept: "high-press",
  },
  progressive_pass: {
    label: "Progressive pass",
    beginner: "A pass that moves the ball meaningfully closer to the opponent's goal — not a sideways or backward pass.",
    analyst: "A pass reducing distance-to-goal by ≥25%. Goalkeeper long punts are excluded (they trivially qualify and distort rankings).",
    concept: "progression",
  },
  pass_network: {
    label: "Pass network",
    beginner: "A map of who passed to whom — each player sits at their average position, thicker lines mean more passes between the pair.",
    analyst: "Completed passes up to the first substitution (after subs, average positions blur across two players filling one shirt).",
  },
  heatmap: {
    label: "Touch heatmap",
    beginner: "Where a player touched the ball most — brighter zones are where they spent their time on the ball.",
    analyst: "Binned touch counts across the pitch (24×16 grid), shaded by count. Touches, not off-ball position.",
  },
  freeze_frame: {
    label: "Freeze-frame",
    beginner: "A snapshot of exactly where every player stood the moment a shot was taken.",
    analyst: "StatsBomb 360 broadcast-derived positions. The faint outline is the camera's visible area — players outside it weren't captured.",
  },
  counterattack: {
    label: "Counterattack",
    beginner: "A fast attack right after winning the ball, before the opponent can get organised.",
    analyst: "Heuristic: a turnover followed by a shot from the same team within 15s, covering ≥30m upfield. Medium confidence — deliberately low-recall.",
    concept: "counterattack",
  },
  compactness: {
    label: "Team shape (width / length)",
    beginner: "How spread out or compact a team is — how wide they stretch and how much distance front-to-back.",
    analyst: "Standard deviation of player x (length) and y (width) positions from tracking data. Whole-match average, not split by phase.",
    concept: "defensive-compactness",
  },
};

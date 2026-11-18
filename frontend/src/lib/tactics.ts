
/** What each confidence tier means for a reader: how the concept is obtained, in plain words. */
export const TIER_INFO: Record<string, { label: string; how: string; short: string }> = {
  detectable: {
    label: "Detectable",
    short: "Measured directly",
    how: "We measure this straight from the match data and detect it automatically, so you can see it on real matches.",
  },
  analytical: {
    label: "Analytical proxy",
    short: "Approximated",
    how: "We compute a stand-in number that captures part of the idea. It is a useful signal, not the whole story.",
  },
  tracking_dependent: {
    label: "Needs tracking",
    short: "Needs tracking data",
    how: "Seeing this properly needs player-tracking data, which exists for only a small set of matches.",
  },
  educational: {
    label: "Educational only",
    short: "Explained only",
    how: "We explain the idea but do not measure it.",
  },
  unsupported: {
    label: "Not attempted",
    short: "Not measured yet",
    how: "We explain it, but the open data cannot show it reliably, so we do not pretend to detect it.",
  },
};

/** Why each idea matters: what a fan or analyst uses it for. Editorial copy, keyed by concept slug. */
export const USES: Record<string, string> = {
  "high-press": "Tells you how a team wins the ball back: early and aggressively, or by waiting. It shows up in turnovers near goal, and in how comfortable a team is playing out from the back.",
  "mid-block": "Shows teams that stay compact around the halfway line instead of chasing the ball. Useful for judging how hard a side is to play through without being reckless.",
  "low-block": "Describes a deep, defensive shape. It helps explain why a team concedes few good chances yet rarely threatens, and why it was a smart choice against stronger opponents.",
  counterattack: "Spots fast attacks launched just after winning the ball. It explains goals that come from a quick break, and which teams are built to hit on the break.",
  progression: "Separates passes that move the team towards goal from sideways and backwards ones. It points out who drives a team forward, not just who passes a lot.",
  "build-up": "Looks at how a team moves the ball from its own box into the attack. It reveals whether a side plays short and patiently or goes direct.",
  transition: "Covers the seconds right after the ball changes hands, when teams are most exposed. It explains why so many chances start from a turnover.",
  gegenpressing: "The instant, collective press after losing the ball. It is why some teams rarely let opponents settle, and why their wins start in midfield.",
  overload: "Creating more players than the opponent in one area of the pitch. It explains how teams open up a crowded zone and free a teammate.",
  overlap: "A teammate running outside the ball carrier to stretch the defence. It is a classic way full-backs create width and crossing chances.",
  underlap: "The inside version of an overlap: a run on the inner side that pulls defenders in. It helps explain how attackers get into central pockets of space.",
  "third-man-run": "A run by a player not involved in the first pass, who arrives to receive the next one. It is how teams break a compact defence with quick combinations.",
  "half-space-occupation": "Standing in the channel between the centre and the wide areas. These pockets are hard for defenders to mark, which is why this app is named for them.",
  "defensive-compactness": "How tightly a team's players are grouped. A compact team leaves fewer gaps between its lines, so it is hard to play through.",
  "false-nine": "A striker who drops deep to link play, dragging defenders out of position. It explains how some teams score without a traditional centre-forward.",
  "possession-style": "Separates teams that keep the ball from those that play without it. Useful for knowing what to expect before kick-off, and for fair comparisons between teams.",
  "offside-trap": "A defence stepping up together to catch attackers offside. It explains the flag-heavy matches and the high defensive line behind them.",
  "pressing-trap": "Inviting a pass into a spot where the press is waiting. It is the clever side of pressing: forcing the opponent to make the mistake.",
  verticality: "How directly a team goes towards goal. High verticality means fast, forward play; low means patient circulation.",
};

export type Kind = "style" | "tactic";
export type Phase = "attacking" | "defending" | "transition";

export const KINDS: Record<Kind, { label: string; blurb: string }> = {
  style: { label: "Playing styles", blurb: "How a team chooses to play over a whole match: its identity and approach." },
  tactic: { label: "Specific tactics", blurb: "Specific mechanisms and movements a team uses inside a match." },
};
export const PHASES: Record<Phase, string> = { attacking: "Attacking", defending: "Defending", transition: "Transitions" };

/** Where each concept sits: a team-wide playing style or a specific tactic, and which phase of play it belongs to. */
export const META: Record<string, { kind: Kind; phase: Phase }> = {
  "high-press": { kind: "style", phase: "defending" },
  "mid-block": { kind: "style", phase: "defending" },
  "low-block": { kind: "style", phase: "defending" },
  gegenpressing: { kind: "style", phase: "transition" },
  counterattack: { kind: "style", phase: "transition" },
  "possession-style": { kind: "style", phase: "attacking" },
  verticality: { kind: "style", phase: "attacking" },
  "build-up": { kind: "tactic", phase: "attacking" },
  progression: { kind: "tactic", phase: "attacking" },
  overload: { kind: "tactic", phase: "attacking" },
  overlap: { kind: "tactic", phase: "attacking" },
  underlap: { kind: "tactic", phase: "attacking" },
  "third-man-run": { kind: "tactic", phase: "attacking" },
  "half-space-occupation": { kind: "tactic", phase: "attacking" },
  "false-nine": { kind: "tactic", phase: "attacking" },
  transition: { kind: "tactic", phase: "transition" },
  "pressing-trap": { kind: "tactic", phase: "defending" },
  "offside-trap": { kind: "tactic", phase: "defending" },
  "defensive-compactness": { kind: "tactic", phase: "defending" },
};
export const metaOf = (slug: string) => META[slug] ?? { kind: "tactic" as Kind, phase: "attacking" as Phase };

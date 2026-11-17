import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { api, type ModelCard } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useMode } from "../lib/mode";
import { Pitch } from "../components/pitch/Pitch";
import { LoadError } from "../components/LoadError";

/** Plain-language account of each calculated number, in the order a reader meets them. The limits come straight from the data service. */
const COPY: Record<string, { title: string; what: string; use: string; where: string; to?: string }> = {
  xg_v2: {
    title: "Chance quality (xG)",
    what: "Every shot gets a score from 0 to 1: the chance a typical shot from that spot, with that many defenders around, becomes a goal.",
    use: "It shows who created the better chances, whatever the scoreline said.",
    where: "Shot maps, 3D columns, the match report and the 'Why this chance' panel.",
  },
  momentum: {
    title: "Who's on top",
    what: "For every minute, it compares the danger each team created over the previous ten minutes. Above the line means the home team is on top, below means the away team.",
    use: "It shows the shape of a match: when a team took over, and what came of it. It describes what happened, it does not predict anything.",
    where: "The match flow chart on every match page.",
  },
  xt: {
    title: "Threat from position (xT)",
    what: "Every patch of the pitch is given a value: how likely a team is to score soon after having the ball there. Moving the ball into a more valuable patch earns credit.",
    use: "It credits passes and carries that create danger, even when no shot follows.",
    where: "Scouting cards and the match report's threat creators.",
  },
  profiles: {
    title: "Player scouting cards",
    what: "A player's numbers per 90 minutes, ranked against others in the same league season and position. Players with few minutes are pulled towards the average so a short spell doesn't look like a star turn.",
    use: "It shows what a player is good at, fairly.",
    where: "The scouting card on each player page and the Leaders view.",
  },
  roles: {
    title: "Player roles",
    what: "Players are grouped by how they actually played in a season, not by the position on the team sheet.",
    use: "It tells you what a player really did, and finds players who play alike.",
    where: "The role tag on scouting cards and 'Plays like'.",
  },
  style: {
    title: "Team style map",
    what: "Each team is summarised by eleven traits, such as how much it keeps the ball, builds from the back, presses high or relies on set pieces. Teams with alike traits sit close together.",
    use: "It shows how teams play and which teams play alike across leagues.",
    where: "The Style map on the Teams page.",
  },
  possessions: {
    title: "Counterattacks and set pieces",
    what: "Counterattacks, corners and free kicks are picked out as they are tagged in the match data, then scored by the chances they produced.",
    use: "It shows which teams are dangerous from set pieces and on the break.",
    where: "The set pieces list on match pages and the Teams page.",
  },
  xpass: {
    title: "Pass difficulty",
    what: "Each pass gets the chance it would be completed, from where it starts, where it goes and what is around it.",
    use: "It credits a player who completes hard passes, not just easy ones.",
    where: "'Passing against difficulty' on scouting cards.",
  },
  passframes: {
    title: "Defenders bypassed",
    what: "In matches with 360 data, it counts the defenders a pass moves the ball past.",
    use: "It spots passes that break a defensive line.",
    where: "Scouting cards for players in 360 matches.",
  },
  vaep: {
    title: "Impact on the ball",
    what: "Every on-ball action is credited by how much it changed the chance of the team scoring and of conceding soon afterwards.",
    use: "It puts passing, carrying, shooting and defending on one scale.",
    where: "'Impact on the ball' on scouting cards.",
  },
  goalkeeper: {
    title: "Goalkeeper ratings",
    what: "Each shot on target is scored for how likely it was to be saved. A keeper is rated on how many goals they prevented compared with an average keeper.",
    use: "It separates keepers facing hard shots from those facing easy ones.",
    where: "The Goalkeepers view on the Players page.",
  },
};
const ORDER = Object.keys(COPY);

function Facts({ m }: { m: ModelCard }) {
  const rows: [string, string][] = [];
  const num = (k: string) => (typeof m[k] === "number" ? (m[k] as number) : null);
  for (const [k, label] of [["n_shots", "shots"], ["n_matches", "matches"], ["n_passes", "passes"], ["n_possessions", "possessions"], ["n_player_seasons", "player seasons"], ["n_team_seasons", "team seasons"], ["n_actions", "actions"], ["n_on_target_shots", "shots on target"], ["n_moves", "moves"]] as const) {
    const v = num(k);
    if (v != null) rows.push([label, v.toLocaleString()]);
  }
  const oof = m.oof_metrics as Record<string, { auc?: number }> | undefined;
  const auc = oof ? Object.values(oof).find((v) => v && typeof v === "object" && typeof v.auc === "number")?.auc : undefined;
  if (auc != null) rows.push(["accuracy score (AUC)", auc.toFixed(2)]);
  if (rows.length === 0) return null;
  return (
    <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-pitch-800 pt-3 text-xs text-ink-2">
      {rows.map(([k, v]) => <div key={k}><dt className="inline">{k}: </dt><dd className="inline font-mono text-ink-1">{v}</dd></div>)}
    </dl>
  );
}

/** The danger map: how valuable each patch of the pitch is, attacking left to right. */
function ThreatMap() {
  const { data } = useAsync(() => api.xtGrid(), []);
  const max = useMemo(() => (data ? Math.max(...data.values.flat()) : 1), [data]);
  if (!data) return <div className="aspect-[3/2] animate-pulse rounded-2xl bg-pitch-800/30" />;
  const cw = 120 / data.nx, ch = 80 / data.ny;
  return (
    <div>
      <Pitch>
        {data.values.map((col, i) => col.map((v, j) => (
          <rect key={`${i}-${j}`} x={i * cw} y={j * ch} width={cw + 0.05} height={ch + 0.05} fill="var(--color-warm)" fillOpacity={Math.pow(v / max, 0.7) * 0.85} />
        )))}
      </Pitch>
      <p className="mt-2 text-xs text-ink-2">Where danger comes from. The brighter the patch, the more likely a team is to score soon after having the ball there. The team attacks left to right.</p>
    </div>
  );
}

export function HowItWorks() {
  const { mode } = useMode();
  const { data, failed } = useAsync(() => api.models(), []);
  if (failed) return <LoadError error="unavailable" what="page" backTo="/" backLabel="Back home" />;
  useEffect(() => {
    if (data && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [data]);
  const by = new Map((data?.models ?? []).map((m) => [m.id, m]));
  return (
    <div className="mx-auto max-w-[1440px] px-6 py-12 lg:px-10">
      <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] text-ink-0">How this works</h1>
      <p className="mt-3 max-w-2xl text-lg leading-relaxed text-ink-1">
        Several numbers on this site are calculated from the raw match data. Here is what each one means, where you will see it, and, just as important, what it cannot tell you.
      </p>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <section id="xt" className="rounded-3xl border border-pitch-800 bg-pitch-900 p-6">
          <h2 className="font-display text-xl font-bold text-ink-0">Where danger comes from</h2>
          <div className="mt-4"><ThreatMap /></div>
        </section>
        <div className="rounded-3xl border border-marker/40 bg-marker/10 p-6">
          <h2 className="font-display text-xl font-bold text-ink-0">An honest note on all of it</h2>
          <p className="mt-3 leading-relaxed text-ink-1">These are estimates built from match data, not facts about a player's ability. They are most useful for comparing and for spotting patterns, and least useful for settling an argument from a single game.</p>
          <p className="mt-3 leading-relaxed text-ink-1">Every card below states what its number leaves out. Where a sample is small, the page tells you.</p>
          <Link to="/ask" className="mt-4 inline-block text-sm font-semibold text-marker-bright hover:underline">Ask the analyst about any of them →</Link>
        </div>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {ORDER.map((id) => {
          const c = COPY[id];
          const m = by.get(id);
          return (
            <article key={id} id={id} className="flex flex-col rounded-3xl border border-pitch-800 bg-pitch-900 p-6">
              <h2 className="font-display text-xl font-bold tracking-tight text-ink-0">{c.title}</h2>
              <Row label="What it is">{c.what}</Row>
              <Row label="What it's for">{c.use}</Row>
              <Row label="Where you'll see it">{c.where}</Row>
              <div className="mt-4 rounded-2xl bg-pitch-950/50 p-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-clay">What to keep in mind</h3>
                {m ? <p className="mt-1.5 text-sm leading-relaxed text-ink-1">{m.limits}</p> : <div className="mt-2 h-10 animate-pulse rounded bg-pitch-800/40" />}
              </div>
              {mode === "analyst" && m && <Facts m={m} />}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">{label}</h3>
      <p className="mt-1 text-sm leading-relaxed text-ink-1">{children}</p>
    </div>
  );
}

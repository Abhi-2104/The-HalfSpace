import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { animate, motion, useMotionValue, useScroll, useTransform, type MotionValue } from "framer-motion";
import { api, type DataCoverage, type FreezeFrame, type MatchDetailInfo, type Overview, type PassNetwork, type PlayerProfile, type ShotXg, type TeamProfile, type TacticalConceptSummary } from "../lib/api";
import { Pitch } from "../components/pitch/Pitch";
import { FreezeFrameLayer } from "../components/pitch/FreezeFrameLayer";
import { PassNetworkLayer } from "../components/pitch/PassNetworkLayer";
import { IsoPitch } from "../components/iso/IsoPitch";
import { Reveal } from "../components/Reveal";
import { CountUp } from "../components/CountUp";
import { CoverageStrip } from "../components/CoverageStrip";

/** A well-covered match to feature. If it isn't in the database, the page falls back to the first
 * ingested match with enough shots and 360 data, so every sentence below is built from real data. */
const PREFERRED_MATCH_ID = 3869685;
const EASE = [0.16, 1, 0.3, 1] as const;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Featured {
  match: MatchDetailInfo;
  shots: ShotXg[];
  freeze: FreezeFrame | null;
  focus: ShotXg | null; // the shot the story zooms into
  coverage: DataCoverage | null;
  networks: { home: PassNetwork; away: PassNetwork } | null;
}

const ord = (n: number) => `${n}${[11, 12, 13].includes(n % 100) ? "th" : ["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10]}`;
// caption by team, never by a guessed short name (StatsBomb full names put the surname anywhere)
const kind = (s: ShotXg) => (s.outcome_name === "Goal" ? "goal" : `shot (${s.outcome_name ?? "unknown"})`);
const describe = (s: ShotXg) => `${s.team_name}'s ${ord(s.minute)}-minute ${kind(s)}`;
const xgText = (s: ShotXg) => (s.xg ?? 0).toFixed(2);

async function shotsFor(id: number) {
  const [match, r] = await Promise.all([api.match(id), api.shotsXg(id)]);
  return { match, shots: r.shots };
}

async function loadFeatured(): Promise<Featured | null> {
  const ok = (c: { shots: ShotXg[] } | null, needFrame: boolean) =>
    !!c && c.shots.length >= 8 && (!needFrame || c.shots.some((s) => s.has_freeze_frame));
  let picked = await shotsFor(PREFERRED_MATCH_ID).catch(() => null);
  if (!ok(picked, true)) {
    picked = null;
    const comps = (await api.competitions().catch(() => ({ competitions: [] }))).competitions;
    for (const needFrame of [true, false]) {
      for (const c of comps) {
        const list = (await api.matches(c.competition_id, c.season_id).catch(() => ({ matches: [] }))).matches.slice(0, 6);
        for (const m of list) {
          const cand = await shotsFor(m.id).catch(() => null);
          if (cand && ok(cand, needFrame)) { picked = cand; break; }
        }
        if (picked) break;
      }
      if (picked) break;
    }
  }
  if (!picked) return null;

  // zoom into the lowest-xG goal that has a freeze-frame (the surprising one), else the best framed shot
  const framed = picked.shots.filter((s) => s.has_freeze_frame);
  const focus =
    framed.filter((s) => s.outcome_name === "Goal").sort((a, b) => (a.xg ?? 1) - (b.xg ?? 1))[0] ??
    [...framed].sort((a, b) => (b.xg ?? 0) - (a.xg ?? 0))[0] ??
    null;
  const [freeze, profile, home, away] = await Promise.all([
    focus ? api.freezeFrame(focus.id).catch(() => null) : Promise.resolve(null),
    api.matchProfile(picked.match.id).catch(() => null),
    api.passNetwork(picked.match.id, picked.match.home_team_id).catch(() => null),
    api.passNetwork(picked.match.id, picked.match.away_team_id).catch(() => null),
  ]);
  return { ...picked, freeze, focus, coverage: profile?.coverage ?? null, networks: home && away ? { home, away } : null };
}

interface Board {
  label: string;
  players: PlayerProfile[];
  teams: TeamProfile[];
}

/** Season leaderboards from whichever competition-season has the most matches in the database. */
async function loadBoard(): Promise<Board | null> {
  const comps = (await api.competitions()).competitions;
  const c = [...comps].sort((a, b) => b.matches - a.matches)[0];
  if (!c) return null;
  const [p, t] = await Promise.all([
    api.seasonPlayers(c.competition_id, c.season_id).catch(() => null),
    api.seasonTeams(c.competition_id, c.season_id).catch(() => null),
  ]);
  return { label: `${c.competition_name} ${c.season_name}`, players: p?.players ?? [], teams: t?.teams ?? [] };
}

function useHome() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [featured, setFeatured] = useState<Featured | null>(null);
  const [concepts, setConcepts] = useState<TacticalConceptSummary[] | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [settled, setSettled] = useState(false); // true once the featured-match lookup has finished, with or without a result
  useEffect(() => {
    api.overview().then(setOverview).catch(() => {});
    api.tacticalConcepts().then((r) => setConcepts(r.concepts)).catch(() => {});
    loadBoard().then(setBoard).catch(() => {});
    loadFeatured().then(setFeatured).catch(() => {}).finally(() => setSettled(true));
  }, []);
  return { overview, featured, concepts, board, settled };
}

/** A pulsing placeholder while loading. If loading finished with nothing to show, say why. */
function PitchPlaceholder({ settled }: { settled: boolean }) {
  if (!settled) return <div className="aspect-[1000/640] w-full animate-pulse rounded-3xl bg-pitch-800/40" aria-label="Loading the match" />;
  return (
    <div className="grid aspect-[1000/640] w-full place-items-center rounded-3xl border border-dashed border-pitch-700 p-8 text-center">
      <p className="max-w-xs text-sm leading-relaxed text-ink-1">
        Match data isn't available right now. Please check back in a moment.
      </p>
    </div>
  );
}

function Legend({ home, away }: { home: string; away: string }) {
  return (
    <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-1">
      <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-team-a" />{home}</span>
      <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-team-b" />{away}</span>
      <span>Taller column = better chance</span>
    </div>
  );
}

/* ---------- Hero ---------- */
function Hero({ overview, featured, settled }: { overview: Overview | null; featured: Featured | null; settled: boolean }) {
  const p = useMotionValue(0);
  useEffect(() => {
    if (!featured) return;
    if (reduced()) { p.set(0.42); return; }
    const c = animate(p, 0.42, { duration: 2.8, delay: 0.35, ease: EASE });
    return () => c.stop();
  }, [featured, p]);
  const m = featured?.match;

  return (
    <section className="relative mx-auto grid max-w-[1440px] items-center gap-10 px-6 lg:px-10 pb-10 pt-12 lg:min-h-[calc(100vh-72px)] lg:grid-cols-[0.95fr_1.25fr] lg:pt-6">
      <div>
        <motion.h1
          className="font-display text-[44px] font-extrabold leading-[1.02] tracking-[-0.04em] text-ink-0 sm:text-6xl lg:text-[68px]"
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE }}
        >
          Football, minus the guesswork
        </motion.h1>
        <motion.p
          className="mt-6 max-w-md text-lg leading-relaxed text-ink-1"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.12, ease: EASE }}
        >
          Open football data, drawn on the pitch where it happened, with plain-English explanations and the numbers one tap away.
        </motion.p>
        <motion.div
          className="mt-8 flex flex-wrap gap-3"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.22, ease: EASE }}
        >
          <Link to="/matches" className="rounded-full bg-marker px-6 py-3 font-semibold text-on-accent shadow-[0_6px_0_color-mix(in_oklab,var(--color-marker)_60%,black)] transition hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none">
            Explore matches
          </Link>
          <Link to={m ? `/matches/${m.id}/story` : "/matches"} className="rounded-full border border-pitch-700 bg-pitch-900/60 px-6 py-3 font-semibold text-ink-0 transition hover:-translate-y-0.5 hover:border-marker">
            Take a guided tour
          </Link>
        </motion.div>
        <motion.dl
          className="mt-12 grid max-w-md grid-cols-3 gap-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.9, delay: 0.5 }}
        >
          {[
            [overview?.matches ?? 0, 0, "", "real matches"],
            [overview ? overview.events / 1_000_000 : 0, 1, "M", "events"],
            [overview?.players ?? 0, 0, "", "players"],
          ].map(([v, d, s, label]) => (
            <div key={label as string}>
              <dt className="font-display text-3xl font-extrabold tracking-tight text-ink-0">
                {overview ? <CountUp to={v as number} decimals={d as number} suffix={s as string} /> : "–"}
              </dt>
              <dd className="mt-1 text-sm text-ink-2">{label as string}</dd>
            </div>
          ))}
        </motion.dl>
      </div>

      <div className="relative max-md:-mx-6">
        {featured && m ? (
          <>
            <IsoPitch shots={featured.shots} homeTeamId={m.home_team_id} progress={p} />
            <Legend home={m.home_team} away={m.away_team} />
            <p className="mt-1 px-6 text-xs text-ink-2 md:px-0">
              {m.competition_name} {m.season_name}: {m.home_team} {m.home_score}–{m.away_score} {m.away_team}. Every column is a real shot.
            </p>
          </>
        ) : (
          <PitchPlaceholder settled={settled} />
        )}
      </div>
    </section>
  );
}

/* ---------- Pinned scroll story ---------- */
/** A floating caption. It fades in at `from`, drifts across the screen while it is on, and fades out at `to`. */
function Caption({ progress, from, to, title, body, pos, drift, last = false }: {
  progress: MotionValue<number>; from: number; to: number; title: string; body: string; pos: string; drift: [number, number]; last?: boolean;
}) {
  const fade = 0.05;
  const opacity = useTransform(progress, [from, from + fade, to - fade, to], [0, 1, 1, last ? 1 : 0]);
  const y = useTransform(progress, [from, to], [drift[1] + 30, drift[1] - 30]);
  const x = useTransform(progress, [from, to], [-drift[0], drift[0]]);
  return (
    <motion.div style={{ opacity, x, y }} className={`pointer-events-none absolute z-10 max-w-[19rem] rounded-3xl border border-pitch-800 bg-pitch-900/80 p-5 shadow-xl backdrop-blur-md sm:max-w-sm sm:p-6 ${pos}`}>
      <h2 className="font-display text-2xl font-extrabold leading-[1.08] tracking-[-0.03em] text-ink-0 sm:text-3xl">{title}</h2>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-1">{body}</p>
    </motion.div>
  );
}

function Story({ featured, settled }: { featured: Featured | null; settled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const bar = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);
  // the stage slowly breathes: the backdrop glow slides as the camera moves
  const glowX = useTransform(scrollYProgress, [0, 1], ["20%", "85%"]);
  const glow = useTransform(glowX, (x) => `radial-gradient(60% 55% at ${x} 50%, color-mix(in oklab, var(--color-marker) 14%, transparent), transparent 70%)`);
  const m = featured?.match;

  const facts = useMemo(() => {
    if (!featured) return null;
    const best = [...featured.shots].filter((s) => s.xg != null).sort((a, b) => (b.xg ?? 0) - (a.xg ?? 0))[0] ?? null;
    return { best, total: featured.shots.length };
  }, [featured]);
  const focus = featured?.focus ?? null;

  return (
    <section ref={ref} className="relative h-[520vh]" aria-label="How to read a match">
      <div className="sticky top-0 h-screen overflow-hidden">
        <motion.div className="absolute inset-0" style={{ backgroundImage: glow }} aria-hidden />
        {/* the pitch fills the whole screen; the captions float over it */}
        <div className="absolute inset-0 flex items-center justify-center pt-10">
          <div className="w-[min(125vw,calc(100vh*1.9))] shrink-0">
            {featured && m ? <IsoPitch shots={featured.shots} homeTeamId={m.home_team_id} progress={scrollYProgress} freeze={featured.freeze} /> : <PitchPlaceholder settled={settled} />}
          </div>
        </div>

        <Caption progress={scrollYProgress} from={0} to={0.2} pos="left-4 top-24 sm:left-[6%] sm:top-[22%]" drift={[30, 0]}
          title="Every shot of a match, on one map"
          body={m && facts ? `${m.home_team} v ${m.away_team} had ${facts.total} shots. Each dot is a real one, placed where it was taken.` : "Each dot is a real shot, placed where it was taken."} />
        <Caption progress={scrollYProgress} from={0.2} to={0.44} pos="right-4 top-24 sm:right-[6%] sm:top-[16%]" drift={[-40, 10]}
          title="Height shows chance quality"
          body={m ? `Taller means a better chance, rated by our xG model. Blue is ${m.home_team}, orange is ${m.away_team}.` : "Taller means a better chance, rated by our xG model."} />
        <Caption progress={scrollYProgress} from={0.44} to={0.68} pos="left-4 bottom-24 sm:left-[6%] sm:bottom-[14%]" drift={[50, -10]}
          title={facts?.best ? `${describe(facts.best)} stands out` : "One chance stands out"}
          body={facts?.best ? `Rated ${xgText(facts.best)} xG, the best chance of the match. The tall column is easy to spot.` : "The tallest column was the best chance."} />
        <Caption progress={scrollYProgress} from={0.68} to={1} last pos="right-4 top-24 sm:right-[6%] sm:top-[20%]" drift={[-30, 0]}
          title="See where every player stood"
          body={focus ? `${describe(focus)}, rated ${xgText(focus)} xG. These are the players the cameras could see at that instant.` : "Every shot with 360 data shows where each visible player stood."} />

        <div className="absolute bottom-6 left-1/2 hidden w-56 -translate-x-1/2 sm:block" aria-hidden>
          <div className="h-1 overflow-hidden rounded-full bg-pitch-800">
            <motion.div className="h-full rounded-full bg-marker" style={{ width: bar }} />
          </div>
          <p className="mt-2 text-center text-xs text-ink-2">Keep scrolling</p>
        </div>
      </div>
    </section>
  );
}

/* ---------- Everything in one place ---------- */
function Tile({ to, title, blurb, children, className = "" }: { to: string; title: string; blurb: string; children: React.ReactNode; className?: string }) {
  return (
    <Link to={to} className={`group flex flex-col overflow-hidden rounded-3xl border border-pitch-800 bg-pitch-900 p-6 transition duration-300 hover:-translate-y-1 hover:border-marker hover:shadow-[0_18px_40px_-18px_color-mix(in_oklab,var(--color-marker)_55%,transparent)] ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-xl font-bold tracking-tight text-ink-0">{title}</h3>
        <span className="text-sm font-semibold text-marker-bright transition-transform duration-300 group-hover:translate-x-1">Open</span>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-ink-1">{blurb}</p>
      <div className="mt-5 flex-1">{children}</div>
    </Link>
  );
}

function Bars({ rows }: { rows: Array<{ key: string | number; name: string; sub?: string; value: number; shown: string }> }) {
  const top = Math.max(...rows.map((r) => r.value), 1e-9);
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-ink-0">{r.name}{r.sub && <span className="ml-1.5 text-xs text-ink-2">{r.sub}</span>}</span>
            <span className="font-mono text-xs tabular-nums text-marker-bright">{r.shown}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-pitch-800">
            <div className="h-full rounded-full bg-marker" style={{ width: `${(r.value / top) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Showcase({ featured, board, concepts }: { featured: Featured | null; board: Board | null; concepts: TacticalConceptSummary[] | null }) {
  const m = featured?.match;
  const players = board?.players.slice(0, 5) ?? [];
  const teams = board ? [...board.teams].filter((t) => t.avg_ppda != null).sort((a, b) => (a.avg_ppda ?? 0) - (b.avg_ppda ?? 0)).slice(0, 5) : [];
  const shotPoint = featured?.focus && featured.focus.x != null ? ([featured.focus.x, featured.focus.y] as [number, number]) : undefined;
  return (
    <section className="mx-auto max-w-[1440px] px-6 py-24 lg:px-10">
      <Reveal>
        <h2 className="max-w-2xl font-display text-4xl font-extrabold leading-[1.05] tracking-[-0.035em] text-ink-0">Everything you can do, in one place</h2>
        <p className="mt-4 max-w-xl text-ink-1">Matches, players, teams, tactics and an analyst you can question, all drawn from the same open data.</p>
      </Reveal>
      <div className="mt-12 grid gap-5 lg:grid-cols-6">
        <Reveal className="lg:col-span-3">
          <Tile to={m ? `/matches/${m.id}` : "/matches"} title="Matches" className="h-full" blurb="Click any shot to see where every player stood the instant it was taken. Spin the pitch in 3D.">
            {featured?.freeze ? (
              <Pitch half className="mx-auto block h-auto max-h-[340px] w-auto max-w-full rounded-2xl">
                <FreezeFrameLayer frame={featured.freeze} ballLocation={shotPoint} />
              </Pitch>
            ) : <div className="aspect-[68/50] animate-pulse rounded-2xl bg-pitch-800/40" />}
          </Tile>
        </Reveal>
        <Reveal delay={0.07} className="lg:col-span-3">
          <Tile to={m ? `/matches/${m.id}` : "/matches"} title="Pass networks" className="h-full" blurb="Both teams' passing shape on one pitch. Pick a side to bring it into focus.">
            {featured?.networks && m ? (
              <Pitch>
                <PassNetworkLayer selected={0} sides={[
                  { network: featured.networks.home, color: "var(--color-team-a)", mirror: false },
                  { network: featured.networks.away, color: "var(--color-team-b)", mirror: true },
                ]} />
              </Pitch>
            ) : <div className="aspect-[3/2] animate-pulse rounded-2xl bg-pitch-800/40" />}
          </Tile>
        </Reveal>
        <Reveal delay={0.05} className="lg:col-span-2">
          <Tile to="/players" title="Players" className="h-full" blurb={board ? `Top scorers per 90 minutes, ${board.label}. Compare any two, or find players like them.` : "Per-90 profiles and look-alikes."}>
            <Bars rows={players.map((p) => ({ key: p.player_id, name: p.name, sub: p.team, value: p.goals_p90, shown: `${p.goals_p90.toFixed(2)} /90` }))} />
          </Tile>
        </Reveal>
        <Reveal delay={0.1} className="lg:col-span-2">
          <Tile to="/teams" title="Teams" className="h-full" blurb="Who presses hardest? Fewer passes allowed per defensive action means a more aggressive press.">
            <Bars rows={teams.map((t) => ({ key: t.team_id, name: t.team, value: 1 / (t.avg_ppda ?? 1), shown: `${(t.avg_ppda ?? 0).toFixed(1)} PPDA` }))} />
          </Tile>
        </Reveal>
        <Reveal delay={0.15} className="lg:col-span-2">
          <Tile to="/tactics" title="Tactics" className="h-full" blurb="Guides to the ideas behind the game, each marked with how much the data can really show.">
            <div className="flex flex-wrap gap-2">
              {(concepts ?? []).slice(0, 8).map((c) => (
                <span key={c.slug} className="rounded-full border border-pitch-700 px-3 py-1 text-xs text-ink-1">{c.name}</span>
              ))}
            </div>
          </Tile>
        </Reveal>
        <Reveal className="lg:col-span-6">
          <Link to="/ask" className="group flex flex-col items-start gap-4 rounded-3xl border border-marker/40 bg-marker/10 p-6 transition hover:-translate-y-1 hover:bg-marker/15 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-display text-xl font-bold tracking-tight text-ink-0">Ask the analyst</h3>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-1">Ask any football question. Every answer is built from the match and player data.</p>
            </div>
            <span className="rounded-full bg-marker px-5 py-2.5 text-sm font-semibold text-on-accent transition-transform group-hover:translate-x-1">Ask a question</span>
          </Link>
        </Reveal>
      </div>
      <p className="mt-6 text-sm text-ink-2">Choose "I'm a beginner" or "I'm a nerd" in the top bar to change how much detail each page shows, without changing the data.</p>
    </section>
  );
}

/* ---------- Honest data ---------- */
function Honest({ overview, featured }: { overview: Overview | null; featured: Featured | null }) {
  const c = featured?.coverage;
  const m = featured?.match;
  const flags: Array<[string, number]> = c ? [["event data", c.has_events], ["360 freeze-frames", c.has_360], ["tracking", c.has_tracking]] : [];
  return (
    <section className="mx-auto max-w-[1440px] px-6 lg:px-10 pb-24">
      <Reveal>
        <div className="grid gap-10 rounded-[2rem] border border-pitch-800 bg-pitch-900 p-8 sm:p-12 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div>
            <h2 className="font-display text-3xl font-extrabold leading-[1.08] tracking-[-0.03em] text-ink-0 sm:text-4xl">Clear about what the data covers</h2>
            <p className="mt-4 max-w-md leading-relaxed text-ink-1">
              Every match shows the depth of data behind it: event data, player tracking and 360 freeze-frames. Anything missing is marked as missing and never estimated, so the basis of every figure is always clear.
            </p>
            {c && m && (
              <div className="mt-6 flex items-center gap-4 rounded-2xl bg-pitch-950/60 px-4 py-3">
                <CoverageStrip hasEvents={!!c.has_events} hasTracking={!!c.has_tracking} has360={!!c.has_360} />
                <span className="text-sm text-ink-1">{m.home_team} v {m.away_team}: {flags.map(([n, on]) => (on ? n : `no ${n}`)).join(", ")}</span>
              </div>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-6">
            {[
              [overview?.matches ?? 0, 0, "", "matches"],
              [overview ? overview.events / 1_000_000 : 0, 1, "M", "events"],
              [overview?.teams ?? 0, 0, "", "teams"],
              [overview?.tracking_matches ?? 0, 0, "", "tracking matches"],
            ].map(([v, d, s, label]) => (
              <div key={label as string} className="rounded-2xl border border-pitch-800 p-5">
                <dt className="font-display text-4xl font-extrabold tracking-tight text-ink-0">
                  {overview ? <CountUp to={v as number} decimals={d as number} suffix={s as string} /> : "–"}
                </dt>
                <dd className="mt-1 text-sm text-ink-2">{label as string}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Reveal>
    </section>
  );
}

function Closing() {
  return (
    <section className="mx-auto max-w-[1440px] px-6 lg:px-10 pb-8">
      <Reveal>
        <div className="relative overflow-hidden rounded-[2rem] bg-marker px-8 py-16 text-center text-on-accent sm:px-16">
          <div className="pointer-events-none absolute inset-0 opacity-25" aria-hidden style={{ backgroundImage: "radial-gradient(circle at 20% 0%, #fff, transparent 45%), radial-gradient(circle at 90% 100%, var(--color-warm), transparent 50%)" }} />
          <h2 className="relative font-display text-4xl font-extrabold tracking-[-0.035em] sm:text-5xl">Pick a match and look closer</h2>
          <p className="relative mx-auto mt-4 max-w-lg text-lg opacity-90">Every shot, every pass and every player position, on the pitch where it happened.</p>
          <Link to="/matches" className="relative mt-8 inline-block rounded-full bg-pitch-900 px-7 py-3.5 font-semibold text-ink-0 shadow-lg transition hover:-translate-y-0.5">
            Browse matches
          </Link>
        </div>
      </Reveal>
    </section>
  );
}

export function Explore() {
  const { overview, featured, concepts, board, settled } = useHome();
  return (
    <>
      <Hero overview={overview} featured={featured} settled={settled} />
      <Showcase featured={featured} board={board} concepts={concepts} />
      <Story featured={featured} settled={settled} />
      <Honest overview={overview} featured={featured} />
      <Closing />
    </>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { animate, motion, useMotionValue, useScroll, useTransform, type MotionValue } from "framer-motion";
import { api, type DataCoverage, type FreezeFrame, type MatchDetailInfo, type Overview, type ShotXg } from "../lib/api";
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
  const [freeze, profile] = await Promise.all([
    focus ? api.freezeFrame(focus.id).catch(() => null) : Promise.resolve(null),
    api.matchProfile(picked.match.id).catch(() => null),
  ]);
  return { ...picked, freeze, focus, coverage: profile?.coverage ?? null };
}

function useHome() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [featured, setFeatured] = useState<Featured | null>(null);
  const [conceptCount, setConceptCount] = useState<number | null>(null);
  useEffect(() => {
    api.overview().then(setOverview).catch(() => {});
    api.tacticalConcepts().then((r) => setConceptCount(r.concepts.length)).catch(() => {});
    loadFeatured().then(setFeatured).catch(() => {});
  }, []);
  return { overview, featured, conceptCount };
}

function PitchSkeleton() {
  return <div className="aspect-[1000/640] w-full animate-pulse rounded-3xl bg-pitch-800/40" aria-label="Loading the match" />;
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
function Hero({ overview, featured }: { overview: Overview | null; featured: Featured | null }) {
  const p = useMotionValue(0);
  useEffect(() => {
    if (!featured) return;
    if (reduced()) { p.set(0.42); return; }
    const c = animate(p, 0.42, { duration: 2.8, delay: 0.35, ease: EASE });
    return () => c.stop();
  }, [featured, p]);
  const m = featured?.match;

  return (
    <section className="relative mx-auto grid max-w-6xl items-center gap-10 px-6 pb-10 pt-12 lg:min-h-[calc(100vh-72px)] lg:grid-cols-[0.95fr_1.25fr] lg:pt-6">
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
            Walk me through a match
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
          <PitchSkeleton />
        )}
      </div>
    </section>
  );
}

/* ---------- Pinned scroll story ---------- */
function Caption({ progress, from, to, title, body, last = false }: { progress: MotionValue<number>; from: number; to: number; title: string; body: string; last?: boolean }) {
  // ranges must stay inside 0..1; the final caption holds instead of fading out
  const opacity = useTransform(progress, [from, from + 0.05, to - 0.05, to], [0, 1, 1, last ? 1 : 0]);
  const y = useTransform(progress, [from, from + 0.05, to - 0.05, to], [28, 0, 0, last ? 0 : -28]);
  return (
    <motion.div style={{ opacity, y }} className="absolute inset-0 flex flex-col justify-center">
      <h2 className="font-display text-3xl font-extrabold leading-[1.08] tracking-[-0.03em] text-ink-0 sm:text-4xl">{title}</h2>
      <p className="mt-4 max-w-sm text-base leading-relaxed text-ink-1">{body}</p>
    </motion.div>
  );
}

function Story({ featured }: { featured: Featured | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const bar = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);
  const m = featured?.match;

  const facts = useMemo(() => {
    if (!featured) return null;
    const best = [...featured.shots].filter((s) => s.xg != null).sort((a, b) => (b.xg ?? 0) - (a.xg ?? 0))[0] ?? null;
    return { best, total: featured.shots.length };
  }, [featured]);
  const focus = featured?.focus ?? null;

  return (
    <section ref={ref} className="relative h-[480vh]" aria-label="How to read a match">
      <div className="sticky top-0 flex h-screen items-center overflow-hidden">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-6 px-6 lg:grid-cols-[0.8fr_1.5fr]">
          <div className="relative order-2 h-52 lg:order-1 lg:h-80">
            <Caption progress={scrollYProgress} from={0} to={0.16} title="Every shot of a match, on one map"
              body={m && facts ? `${m.home_team} v ${m.away_team} had ${facts.total} shots. Each dot is a real one, placed where it was taken.` : "Each dot is a real shot, placed where it was taken."} />
            <Caption progress={scrollYProgress} from={0.16} to={0.44} title="Now stand them up"
              body={m ? `Taller means a better chance, rated by our xG model. Blue is ${m.home_team}, orange is ${m.away_team}.` : "Taller means a better chance, rated by our xG model."} />
            <Caption progress={scrollYProgress} from={0.44} to={0.66}
              title={facts?.best ? `${describe(facts.best)} stands out` : "One chance stands out"}
              body={facts?.best ? `Rated ${xgText(facts.best)} xG, the best chance of the match. The tall column is easy to spot.` : "The tallest column was the best chance."} />
            <Caption progress={scrollYProgress} from={0.66} to={1} last title="Zoom in and see everyone"
              body={focus ? `${describe(focus)}, rated ${xgText(focus)} xG. These are the players the cameras could see at that instant.` : "Every shot with 360 data shows where each visible player stood."} />
          </div>
          <div className="relative order-1 overflow-hidden border border-pitch-800 bg-pitch-900/50 max-md:-mx-6 max-md:border-x-0 md:rounded-[2rem] lg:order-2">
            {featured && m ? <IsoPitch shots={featured.shots} homeTeamId={m.home_team_id} progress={scrollYProgress} freeze={featured.freeze} /> : <PitchSkeleton />}
          </div>
        </div>
        <div className="absolute bottom-8 left-1/2 hidden w-56 -translate-x-1/2 sm:block" aria-hidden>
          <div className="h-1 overflow-hidden rounded-full bg-pitch-800">
            <motion.div className="h-full rounded-full bg-marker" style={{ width: bar }} />
          </div>
          <p className="mt-2 text-center text-xs text-ink-2">Keep scrolling</p>
        </div>
      </div>
    </section>
  );
}

/* ---------- What you can do ---------- */
function Features({ matchId, conceptCount }: { matchId: number | null; conceptCount: number | null }) {
  const features = [
    { to: matchId ? `/matches/${matchId}` : "/matches", title: "Click a shot, see everyone", body: "Pick any shot with 360 data and see where every visible player stood the instant it was taken.", icon: "M12 3v4M12 17v4M3 12h4M17 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" },
    { to: matchId ? `/matches/${matchId}/story` : "/matches", title: "Get walked through a match", body: "A scrolling story of every goal and big chance, in plain language. No stats degree needed.", icon: "M4 6h16M4 12h10M4 18h16" },
    { to: "/players", title: "Compare players and teams", body: "Per-90 profiles, players like this one, and head-to-head comparisons that warn you when they are not like for like.", icon: "M7 4v16M17 4v16M3 9h8M13 15h8" },
    { to: "/tactics", title: "Learn the tactics", body: `${conceptCount ?? "Many"} tactical concepts, each marked with how much the data can really show.`, icon: "M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5" },
  ];
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <Reveal>
        <h2 className="max-w-xl font-display text-4xl font-extrabold leading-[1.05] tracking-[-0.035em] text-ink-0">Start anywhere. Go as deep as you like.</h2>
        <p className="mt-4 max-w-lg text-ink-1">The Beginner and Analyst switch in the top bar changes how much detail every page shows, without changing the data.</p>
      </Reveal>
      <div className="mt-12 grid gap-5 sm:grid-cols-2">
        {features.map((f, i) => (
          <Reveal key={f.title} delay={i * 0.07}>
            <Link to={f.to} className="group flex h-full flex-col rounded-3xl border border-pitch-800 bg-pitch-900 p-7 transition duration-300 hover:-translate-y-1 hover:border-marker hover:shadow-[0_18px_40px_-18px_color-mix(in_oklab,var(--color-marker)_55%,transparent)]">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-marker/12 text-marker-bright">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={f.icon} /></svg>
              </span>
              <h3 className="mt-5 font-display text-xl font-bold tracking-tight text-ink-0">{f.title}</h3>
              <p className="mt-2 flex-1 leading-relaxed text-ink-1">{f.body}</p>
              <span className="mt-5 text-sm font-semibold text-marker-bright transition-transform duration-300 group-hover:translate-x-1">Open</span>
            </Link>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ---------- Honest data ---------- */
function Honest({ overview, featured }: { overview: Overview | null; featured: Featured | null }) {
  const c = featured?.coverage;
  const m = featured?.match;
  const flags: Array<[string, number]> = c ? [["event data", c.has_events], ["360 freeze-frames", c.has_360], ["tracking", c.has_tracking]] : [];
  return (
    <section className="mx-auto max-w-6xl px-6 pb-24">
      <Reveal>
        <div className="grid gap-10 rounded-[2rem] border border-pitch-800 bg-pitch-900 p-8 sm:p-12 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div>
            <h2 className="font-display text-3xl font-extrabold leading-[1.08] tracking-[-0.03em] text-ink-0 sm:text-4xl">It never shows more than the data can back up</h2>
            <p className="mt-4 max-w-md leading-relaxed text-ink-1">
              Every match carries a coverage mark. Three ticks show whether it has event data, tracking data and 360 freeze-frames, so you always know what you are looking at.
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

function Closing({ featured }: { featured: Featured | null }) {
  const m = featured?.match;
  const goals = featured?.shots.filter((s) => s.outcome_name === "Goal").length ?? 0;
  const best = featured ? [...featured.shots].filter((s) => s.xg != null).sort((a, b) => (b.xg ?? 0) - (a.xg ?? 0))[0] : null;
  return (
    <section className="mx-auto max-w-6xl px-6 pb-8">
      <Reveal>
        <div className="relative overflow-hidden rounded-[2rem] bg-marker px-8 py-16 text-center text-on-accent sm:px-16">
          <div className="pointer-events-none absolute inset-0 opacity-25" aria-hidden style={{ backgroundImage: "radial-gradient(circle at 20% 0%, #fff, transparent 45%), radial-gradient(circle at 90% 100%, var(--color-warm), transparent 50%)" }} />
          <h2 className="relative font-display text-4xl font-extrabold tracking-[-0.035em] sm:text-5xl">Start with a real match</h2>
          {featured && m && (
            <p className="relative mx-auto mt-4 max-w-lg text-lg opacity-90">
              {m.home_team} {m.home_score}–{m.away_score} {m.away_team} ({m.competition_name} {m.season_name}): {featured.shots.length} shots, {goals} {goals === 1 ? "goal" : "goals"}.
              {best ? ` The tallest column is a ${ord(best.minute)}-minute ${kind(best)} rated ${xgText(best)} xG.` : ""}
            </p>
          )}
          <Link to={m ? `/matches/${m.id}` : "/matches"} className="relative mt-8 inline-block rounded-full bg-pitch-900 px-7 py-3.5 font-semibold text-ink-0 shadow-lg transition hover:-translate-y-0.5">
            {m ? "Open the match" : "Browse matches"}
          </Link>
        </div>
      </Reveal>
    </section>
  );
}

export function Explore() {
  const { overview, featured, conceptCount } = useHome();
  return (
    <>
      <Hero overview={overview} featured={featured} />
      <Story featured={featured} />
      <Features matchId={featured?.match.id ?? null} conceptCount={conceptCount} />
      <Honest overview={overview} featured={featured} />
      <Closing featured={featured} />
    </>
  );
}

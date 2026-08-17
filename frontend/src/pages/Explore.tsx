import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { api, type Overview, type ShotXg } from "../lib/api";
import { StatTile } from "../components/StatTile";
import { Pitch } from "../components/pitch/Pitch";
import { ShotMapLayer } from "../components/pitch/ShotMapLayer";
import { CoverageStrip } from "../components/CoverageStrip";

const WC2022_FINAL_ID = 3869685;
const ARGENTINA_TEAM_ID = 779;

export function Explore() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [shots, setShots] = useState<ShotXg[] | null>(null);

  useEffect(() => {
    api.overview().then(setOverview).catch(() => {});
    api.shotsXg(WC2022_FINAL_ID).then((r) => setShots(r.shots)).catch(() => {});
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <p className="font-mono text-xs uppercase tracking-widest text-marker-bright">Football intelligence, evidenced</p>
        <h1 className="mt-3 max-w-3xl font-display text-5xl font-bold leading-[1.05] tracking-tight text-ink-0 sm:text-6xl">
          {overview ? overview.matches.toLocaleString() : "—"} matches.{" "}
          {overview ? (overview.events / 1_000_000).toFixed(1) : "—"}M events.
          <br />
          Every number traces back to source.
        </h1>
        <p className="mt-5 max-w-xl text-ink-1">
          Real open football data — StatsBomb events, SkillCorner and IDSSE tracking — not a demo over
          fabricated numbers. Nothing here implies richer data than what actually backs it.
        </p>
        <div className="mt-8 flex gap-3">
          <Link to="/matches" className="rounded-sm bg-marker px-5 py-2.5 font-medium text-ink-0 transition hover:bg-marker-bright hover:text-pitch-950">
            Explore matches
          </Link>
          <Link to="/tactics" className="rounded-sm border border-pitch-700 px-5 py-2.5 font-medium text-ink-0 transition hover:border-marker-bright">
            Learn the tactics
          </Link>
        </div>
      </motion.div>

      {overview && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mt-16 grid grid-cols-2 gap-8 sm:grid-cols-5"
        >
          <StatTile value={overview.matches.toLocaleString()} label="Matches" />
          <StatTile value={`${(overview.events / 1_000_000).toFixed(1)}M`} label="Events" />
          <StatTile value={overview.players.toLocaleString()} label="Players" />
          <StatTile value={overview.teams.toLocaleString()} label="Teams" />
          <StatTile value={overview.tracking_matches.toLocaleString()} label="Tracking matches" />
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.35 }}
        className="mt-20 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_1.3fr] lg:items-center"
      >
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-ink-2">Case file</p>
          <h2 className="mt-2 font-display text-3xl font-bold text-ink-0">Argentina 3–3 France</h2>
          <p className="mt-1 text-sm text-ink-1">FIFA World Cup 2022 Final — every shot on this pitch actually happened.</p>
          <div className="mt-4">
            <CoverageStrip hasEvents hasTracking={false} />
          </div>
          <Link to={`/matches/${WC2022_FINAL_ID}`} className="mt-6 inline-block font-mono text-sm text-marker-bright hover:underline">
            Open the full match dossier →
          </Link>
        </div>
        <div className="rounded-sm border border-pitch-800 bg-pitch-900 p-4">
          {shots ? (
            <Pitch>
              <ShotMapLayer shots={shots} homeTeamId={ARGENTINA_TEAM_ID} />
            </Pitch>
          ) : (
            <div className="aspect-[3/2]" />
          )}
        </div>
      </motion.div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const STAGES = ["Reading your question", "Finding the right matches", "Working through the numbers", "Putting the answer together"];

/** The loader sits straight on the page, with no card, and uses only the site's own colours. */
function Card({ children, label }: { children: React.ReactNode; label: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-1" role="status" aria-live="polite">
      <svg viewBox="0 0 320 90" className="h-[70px] w-[250px] shrink-0 overflow-visible" aria-hidden>{children}</svg>
      <div className="min-w-0 text-sm text-ink-1">{label}</div>
    </div>
  );
}

const NODES = [40, 120, 200];
const Y = 45;

function Nodes({ pulse }: { pulse: boolean }) {
  // keyframe times of the pass: node 0 receives at 0 and 1, node 1 at .25 and .75, node 2 at .5
  const hits = [[0, 1], [0.25, 0.75], [0.5]];
  return (
    <>
      <path d={`M${NODES[0]} ${Y}H${NODES[2]}`} stroke="var(--color-pitch-700)" strokeWidth="1.5" strokeDasharray="3 5" strokeLinecap="round" />
      {NODES.map((x, i) => (
        <g key={x}>
          {pulse && (
            <motion.circle cx={x} cy={Y} fill="none" stroke="var(--color-marker)" strokeWidth="1.5"
              animate={{ r: [10, 10, 20, 10], opacity: [0, 0, 0.5, 0] }}
              transition={{ duration: 3.2, repeat: Infinity, times: hits[i].length === 2 ? [0, 0.01, 0.1, 0.2] : [0, 0.01, 0.1, 0.2], delay: hits[i][0] * 3.2, ease: "easeOut", repeatDelay: 0 }} />
          )}
          <circle cx={x} cy={Y} r="10" fill="var(--color-marker)" stroke="var(--color-pitch-900)" strokeWidth="3" />
        </g>
      ))}
    </>
  );
}

export function Thinking() {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStage((s) => (s + 1) % STAGES.length), 2600);
    return () => clearInterval(t);
  }, []);
  return (
    <Card
      label={
        <AnimatePresence mode="wait">
          <motion.span key={stage} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.25 }} className="inline-block">
            {STAGES[stage]}…
          </motion.span>
        </AnimatePresence>
      }
    >
      <Nodes pulse />
      {/* the ball: passed along the line and back, with a small lift on each pass */}
      <motion.circle r="5.5" fill="var(--color-warm)" stroke="#fff" strokeWidth="1.5"
        animate={{ cx: [40, 120, 200, 120, 40], cy: [Y - 11, Y - 22, Y - 11, Y - 22, Y - 11] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }} />
    </Card>
  );
}

/** The last pass finds the net: the goal outline lights up and a ring bursts. Shown briefly before the answer. */
export function GoalCelebration() {
  return (
    <Card label={<span className="font-medium text-ink-0">Done. Here is what the data says.</span>}>
      <Nodes pulse={false} />
      {/* goal */}
      <motion.g initial={{ opacity: 0.6 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }}>
        <rect x="262" y="22" width="34" height="46" rx="3" fill="none" stroke="var(--color-ink-1)" strokeWidth="2.5" />
        {[32, 42, 52, 62].map((y) => <path key={y} d={`M264 ${y}H294`} stroke="var(--color-pitch-700)" strokeWidth="1" />)}
        {[272, 282, 292].map((x) => <path key={x} d={`M${x} 24V66`} stroke="var(--color-pitch-700)" strokeWidth="1" />)}
      </motion.g>
      <motion.circle cx="280" cy="45" fill="none" stroke="var(--color-warm)" strokeWidth="2.5"
        initial={{ r: 6, opacity: 0 }} animate={{ r: [6, 34], opacity: [0.9, 0] }} transition={{ delay: 0.5, duration: 0.9, ease: "easeOut" }} />
      <motion.circle r="5.5" fill="var(--color-warm)" stroke="#fff" strokeWidth="1.5"
        initial={{ cx: 200, cy: Y }} animate={{ cx: [200, 252, 280], cy: [Y, Y - 20, Y] }} transition={{ duration: 0.55, ease: "easeIn" }} />
    </Card>
  );
}

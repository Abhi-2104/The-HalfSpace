import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "react-router-dom";
import { GLOSSARY } from "../lib/glossary";
import { useMode } from "../lib/mode";

/**
 * Inline "?" beside any metric label. Click reveals the plain-English
 * explainer; in analyst mode it also shows the deeper note. This is the
 * beginner on-ramp - jargon is always one tap from a real explanation,
 * and links through to the tactical concept where one exists.
 */
export function MetricInfo({ metric }: { metric: keyof typeof GLOSSARY }) {
  const [open, setOpen] = useState(false);
  const { mode } = useMode();
  const info = GLOSSARY[metric];
  if (!info) return null;

  return (
    <span className="relative inline-flex">
      <button
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        aria-label={`What is ${info.label}?`}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-pitch-700 font-mono text-[9px] text-ink-2 transition hover:border-marker-bright hover:text-marker-bright"
      >
        ?
      </button>
      <AnimatePresence>
        {open && (
          <motion.span
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 top-6 z-20 w-64 rounded-sm border border-pitch-700 bg-pitch-800 p-3 text-left shadow-lg"
          >
            <span className="block font-display text-sm font-bold text-ink-0">{info.label}</span>
            <span className="mt-1 block text-xs leading-relaxed text-ink-1">{info.beginner}</span>
            {mode === "analyst" && info.analyst && (
              <span className="mt-2 block border-t border-pitch-700 pt-2 text-xs leading-relaxed text-ink-2">
                {info.analyst}
              </span>
            )}
            {info.concept && (
              <Link
                to={`/tactics/${info.concept}`}
                className="mt-2 block font-mono text-[11px] text-marker-bright hover:underline"
                onMouseDown={(e) => e.preventDefault()}
              >
                Learn more →
              </Link>
            )}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { API_BASE } from "../lib/api";

/**
 * Says so, in plain language, when the data service can't be reached, instead of
 * leaving pages on a loading placeholder. It checks /health, retries every few
 * seconds, and reloads the page by itself once the service is back. The technical
 * detail goes to the console for whoever runs the site, not onto the page.
 */
export function ApiBanner() {
  const [down, setDown] = useState(false);
  const wasDown = useRef(false);

  useEffect(() => {
    let stop = false;
    let timer: number | undefined;
    const check = async () => {
      let ok = false;
      try {
        ok = (await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(4000) })).ok;
      } catch {
        ok = false;
      }
      if (stop) return;
      if (ok && wasDown.current) {
        window.location.reload();
        return;
      }
      if (!ok && !wasDown.current) console.warn(`The Halfspace: the data API at ${API_BASE} is not reachable. Check that the backend is running and that VITE_API_BASE points to it.`);
      wasDown.current = !ok;
      setDown(!ok);
      timer = window.setTimeout(check, ok ? 30000 : 4000);
    };
    check();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <AnimatePresence>
      {down && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="overflow-hidden border-b border-warm/30 bg-warm/10"
        >
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-3 lg:px-10">
            <p className="text-sm text-ink-0">
              <span className="font-semibold">We're having trouble reaching our data service.</span>{" "}
              <span className="text-ink-1">Some pages may be empty for now. We'll keep trying and refresh automatically.</span>
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-full border border-pitch-700 bg-pitch-900 px-4 py-1.5 text-sm font-semibold text-ink-0 transition-colors hover:border-marker"
            >
              Try again
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

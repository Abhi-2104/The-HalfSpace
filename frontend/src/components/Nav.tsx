import { useState } from "react";
import { NavLink } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useMode } from "../lib/mode";
import { Brand } from "./Brand";
import { ThemeToggle } from "./ThemeToggle";

const LINKS = [
  ["/matches", "Matches"],
  ["/players", "Players"],
  ["/teams", "Teams"],
  ["/tactics", "Tactics"],
  ["/compare", "Compare"],
] as const;

function ModeSwitch() {
  const { mode, setMode } = useMode();
  return (
    <div
      className="relative flex rounded-full border border-pitch-800 bg-pitch-900/60 p-0.5 text-xs font-medium"
      title="Beginner leads with plain-language explainers. Analyst shows the raw stats and methods."
    >
      {(["beginner", "analyst"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setMode(m)}
          className={`relative z-10 rounded-full px-3 py-1.5 capitalize transition-colors ${
            mode === m ? "text-on-accent" : "text-ink-1 hover:text-ink-0"
          }`}
        >
          {mode === m && (
            <motion.span
              layoutId="mode-thumb"
              className="absolute inset-0 -z-10 rounded-full bg-marker"
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
            />
          )}
          {m}
        </button>
      ))}
    </div>
  );
}

export function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b border-pitch-800/80 bg-pitch-950/75 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <NavLink to="/" aria-label="The Halfspace by Abhijith Varma, home" onClick={() => setOpen(false)}>
          <Brand />
        </NavLink>

        <nav className="hidden items-center gap-1 text-sm font-medium md:flex" aria-label="Main">
          {LINKS.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `relative rounded-full px-3.5 py-2 transition-colors ${isActive ? "text-ink-0" : "text-ink-1 hover:text-ink-0"}`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 -z-10 rounded-full bg-pitch-900 shadow-[0_1px_0_var(--color-pitch-800)]"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    />
                  )}
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2.5">
          <ModeSwitch />
          <ThemeToggle />
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-full border border-pitch-800 text-ink-1 md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t border-pitch-800 md:hidden"
            aria-label="Main"
          >
            <div className="mx-auto flex max-w-6xl flex-col px-6 py-3">
              {LINKS.map(([to, label]) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) => `rounded-lg px-2 py-3 text-base font-medium ${isActive ? "text-marker-bright" : "text-ink-0"}`}
                >
                  {label}
                </NavLink>
              ))}
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}

import { NavLink } from "react-router-dom";
import { useMode } from "../lib/mode";

const LINKS = [
  ["/matches", "Matches"],
  ["/players", "Players"],
  ["/teams", "Teams"],
  ["/tactics", "Tactics"],
  ["/compare", "Compare"],
] as const;

export function Nav() {
  const { mode, setMode } = useMode();
  return (
    <header className="sticky top-0 z-10 border-b border-pitch-800 bg-pitch-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <NavLink to="/" className="group flex items-baseline gap-0.5 font-display text-2xl font-bold tracking-tight">
          <span>Half</span>
          <span className="text-marker-bright">Space</span>
          <span className="ml-2 h-[3px] w-6 -translate-y-1 bg-marker-bright transition-all group-hover:w-9" />
        </NavLink>
        <div className="flex items-center gap-6">
          <nav className="hidden gap-6 font-mono text-xs uppercase tracking-wide sm:flex">
            {LINKS.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  isActive ? "text-marker-bright" : "text-ink-1 transition-colors hover:text-ink-0"
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div
            className="flex rounded-full border border-pitch-700 p-0.5 font-mono text-[10px] uppercase tracking-wide"
            title="Beginner leads with plain-language explainers; Analyst surfaces the raw stats and methods."
          >
            {(["beginner", "analyst"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-full px-2.5 py-1 transition ${
                  mode === m ? "bg-marker-bright text-pitch-950" : "text-ink-2 hover:text-ink-0"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}

import { NavLink } from "react-router-dom";

const LINKS = [
  ["/matches", "Matches"],
  ["/players", "Players"],
  ["/teams", "Teams"],
  ["/tactics", "Tactics"],
  ["/compare", "Compare"],
] as const;

export function Nav() {
  return (
    <header className="sticky top-0 z-10 border-b border-pitch-800 bg-pitch-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <NavLink to="/" className="group flex items-baseline gap-0.5 font-display text-2xl font-bold tracking-tight">
          <span>Half</span>
          <span className="text-marker-bright">Space</span>
          <span className="ml-2 h-[3px] w-6 -translate-y-1 bg-marker-bright transition-all group-hover:w-9" />
        </NavLink>
        <nav className="flex gap-6 font-mono text-xs uppercase tracking-wide">
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
      </div>
    </header>
  );
}

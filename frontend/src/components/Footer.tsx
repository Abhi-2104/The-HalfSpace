import { Link } from "react-router-dom";
import { Brand } from "./Brand";

export function Footer() {
  return (
    <footer className="mt-24 border-t border-pitch-800">
      <div className="mx-auto grid max-w-[1440px] gap-10 px-6 lg:px-10 py-12 md:grid-cols-[1.2fr_1fr_1fr]">
        <div>
          <Brand size="lg" />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-ink-1">
            Real open football data, drawn on the pitch where it happened. Designed and built by Abhijith Varma.
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink-0">Explore</p>
          <ul className="mt-3 space-y-2 text-sm text-ink-1">
            {[
              ["/matches", "Matches"],
              ["/players", "Players"],
              ["/teams", "Teams"],
              ["/tactics", "Tactics"],
              ["/compare", "Compare"],
            ].map(([to, label]) => (
              <li key={to}>
                <Link to={to} className="transition-colors hover:text-ink-0">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink-0">Where the data comes from</p>
          <ul className="mt-3 space-y-2 text-sm text-ink-1">
            <li>StatsBomb Open Data: match events and 360 freeze-frames</li>
            <li>SkillCorner Open Data and IDSSE: tracking</li>
          </ul>
          <p className="mt-4 text-xs text-ink-2">Match data is the property of its providers and is used under their open-data terms.</p>
        </div>
      </div>
      <div className="border-t border-pitch-800 py-5 text-center text-xs text-ink-2">
        The Halfspace <span aria-hidden>·</span> by <span className="font-semibold">Abhijith Varma</span>
      </div>
    </footer>
  );
}

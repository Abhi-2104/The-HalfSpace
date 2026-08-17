import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Beginner vs Analyst mode. Same data, two depths (project spec: normal
 * exploration works without jargon; depth is opt-in). Beginner leads with
 * plain-language explainers and hides confidence-tier / raw-stat noise;
 * Analyst surfaces it. Persisted so a returning user keeps their choice.
 */
export type Mode = "beginner" | "analyst";

const ModeContext = createContext<{ mode: Mode; setMode: (m: Mode) => void }>({
  mode: "beginner",
  setMode: () => {},
});

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem("halfspace-mode") as Mode) || "beginner");
  useEffect(() => {
    localStorage.setItem("halfspace-mode", mode);
  }, [mode]);
  return <ModeContext.Provider value={{ mode, setMode }}>{children}</ModeContext.Provider>;
}

export function useMode() {
  return useContext(ModeContext);
}

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

/**
 * Light/dark theme. The initial value is set by an inline script in index.html
 * before first paint (saved choice, otherwise light), so there is no
 * flash. Here we only read it, flip it, and remember the choice.
 */
export type Theme = "light" | "dark";

const read = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({ theme: "light", toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(read);

  const toggle = useCallback(() => {
    const next: Theme = read() === "dark" ? "light" : "dark";
    const root = document.documentElement;
    root.classList.add("theme-anim"); // brief colour fade, removed right after
    root.dataset.theme = next;
    try {
      localStorage.setItem("halfspace-theme", next);
    } catch {
      /* private mode: the theme still works for this visit */
    }
    setTheme(next);
    window.setTimeout(() => root.classList.remove("theme-anim"), 450);
  }, []);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@iep/ui";

/**
 * Light / dark / system, persisted per browser.
 *
 * The tokens have carried a full dark palette since P0 and nothing could reach it —
 * you got dark mode only if your operating system happened to ask for it. Three states
 * rather than two, because "follow my system" is what most people actually want and a
 * two-way toggle silently overrides it forever after one click.
 */

type Theme = "light" | "dark" | "system";
const STORAGE_KEY = "iep-theme";

function apply(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") {
    // Remove the attribute entirely: the token file's `prefers-color-scheme` media query
    // is what should decide, and an explicit attribute would win over it.
    root.removeAttribute("data-theme");
    return;
  }
  root.setAttribute("data-theme", theme);
}

function read(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    // Private windows and blocked site data both throw here. Falling back to system is
    // correct and silent — a theme preference is not worth an error boundary.
    return "system";
  }
}

const ThemeContext = React.createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
}>({ theme: "system", setTheme: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(read);

  React.useEffect(() => apply(theme), [theme]);

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference not persisted; the session still honours it.
    }
  }, []);

  const value = React.useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Theme, string> = {
  system: "Theme: follow my system",
  light: "Theme: light",
  dark: "Theme: dark",
};

export function ThemeToggle() {
  const { theme, setTheme } = React.useContext(ThemeContext);
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setTheme(NEXT[theme])}
      // The label says the CURRENT state, not the next one. "Switch to dark" on a button
      // showing a sun is ambiguous about which it is describing.
      aria-label={LABEL[theme]}
      title={LABEL[theme]}
    >
      <Icon aria-hidden className="size-4" />
    </Button>
  );
}

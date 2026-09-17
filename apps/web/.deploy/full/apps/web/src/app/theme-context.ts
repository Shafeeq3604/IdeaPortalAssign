import * as React from "react";

/**
 * Split out of theme.tsx: that file exports components (`ThemeProvider`, `ThemeToggle`),
 * and `react-refresh/only-export-components` refuses a non-component export — a context
 * object, a hook — sitting alongside them, since Fast Refresh cannot preserve state across
 * a reload for a module boundary that isn't purely components. `Theme`, `ThemeContext` and
 * `useThemeValue` all live here instead so theme.tsx can stay component-only.
 */

export type Theme = "light" | "dark" | "system";

export const ThemeContext = React.createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
}>({ theme: "system", setTheme: () => {} });

/** The current choice ("system" included) — for anything that needs to render
 * differently per theme, such as the toast layer picking a palette to match. */
export function useThemeValue(): Theme {
  return React.useContext(ThemeContext).theme;
}

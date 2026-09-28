import * as React from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@iep/ui";
import { ThemeContext, type Theme } from "./theme-context";

/**
 * Light / dark / system, persisted per browser.
 *
 * The tokens have carried a full dark palette since P0 and nothing could reach it —
 * you got dark mode only if your operating system happened to ask for it. Three states
 * rather than two, because "follow my system" is what most people actually want and a
 * two-way toggle silently overrides it forever after one click.
 */

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

/**
 * Enterprise-audit pass: dark is now the product's own default, not "follow my system" —
 * "that should be the first thing people see when they open the application" — so a
 * first-time visitor with no stored preference gets the enterprise dark palette regardless
 * of their OS setting. The three-state toggle (system/light/dark) is unchanged: anyone can
 * still opt into light or explicit system-following, and that choice is still what's
 * remembered on their next visit — only the FALLBACK, for someone who has never touched
 * the toggle, changed from "system" to "dark".
 */
function read(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "dark";
  } catch {
    // Private windows and blocked site data both throw here. Falling back to the product's
    // own default (dark) is correct and silent — a theme preference is not worth an error
    // boundary.
    return "dark";
  }
}

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

/**
 * The three choices, in the order a person reads them. "Auto" is the word people know for
 * "follow my device"; the stored value stays `system`.
 */
const OPTIONS: readonly { value: Theme; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Auto", icon: Monitor },
];

const LABEL: Record<Theme, string> = {
  system: "Theme: auto (follows your device)",
  light: "Theme: light",
  dark: "Theme: dark",
};

/**
 * The theme picker: a small menu with Light, Dark and Auto, and a tick on the current one.
 *
 * P9 tester feedback: this used to be a button that CYCLED system → light → dark, so
 * getting to dark from the default took up to three clicks, with no way to see what the
 * next click would do. A menu is one click to open and one to choose, and shows all three.
 *
 * @param className Styling from the surface this sits on. It exists because the header is
 * a dark gradient and this button has to be white there and not elsewhere — a `[&_button]`
 * descendant rule is what once made the sign-out item white-on-white inside a popover.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = React.useContext(ThemeContext);
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`${className ?? ""} h-11 w-11 gap-1.5 px-2 sm:h-8 sm:w-8 lg:w-auto lg:px-2.5`}
          // Names the CURRENT state; the menu itself shows the choices.
          aria-label={LABEL[theme]}
          title={LABEL[theme]}
        >
          <Icon aria-hidden className="size-4 shrink-0" />
          <span className="hidden text-200 font-medium lg:inline">Theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          {OPTIONS.map((o) => (
            <DropdownMenuRadioItem
              key={o.value}
              value={o.value}
              // The primitive's own dot indicator is hidden: a tick at the right edge is
              // the convention people recognise for "this one is selected".
              className="gap-2.5 py-2 pl-2.5 text-200 [&>span:first-child]:hidden"
            >
              <o.icon aria-hidden className="size-4 text-muted-foreground" />
              <span className="flex-1">{o.label}</span>
              {theme === o.value ? <Check aria-hidden className="size-4 text-accent-700" /> : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

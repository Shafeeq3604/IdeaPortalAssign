import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@iep/ui";
import { createQueryClient } from "./query-client";
import { ThemeProvider } from "./theme";
import { useThemeValue } from "./theme-context";

/** App-wide providers. The client factory and its defaults live in ./query-client. */

/**
 * `ThemeProvider` existed and was fully wired to `ThemeToggle`, but nothing in the tree
 * ever rendered it — so the button in the header called a `setTheme` that updated a
 * context value nobody was listening to. Every click silently did nothing; the label
 * ("Theme: follow my system") never changed no matter how many times it was pressed.
 * Mounting it here is the fix — one line, but the theme toggle has never worked without it.
 */
function ToasterOnBrand() {
  // The toast layer picks its own palette from THIS app's theme, not the reverse — a
  // toast in light mode while the page is in dark mode (or vice-versa) would be the one
  // element on screen fighting its surroundings.
  const theme = useThemeValue();
  return <Toaster theme={theme} position="bottom-right" richColors />;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        {children}
        <ToasterOnBrand />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

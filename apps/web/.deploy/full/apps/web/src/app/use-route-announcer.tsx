import * as React from "react";
import { useLocation } from "react-router-dom";
import { matchRouteId } from "@iep/contracts";

/**
 * Announces the destination to screen readers and resets focus on every route change.
 *
 * A client-side route change fires no browser "page load" event, so a screen reader user
 * gets neither of the two things a real navigation gives a sighted user: an announcement
 * of where they landed, and focus back at the top of the new page instead of wherever it
 * happened to sit on the old one (still on a nav link, mid-scroll on a list, etc). This is
 * the standard SPA fix for both: an `aria-live` region that speaks the destination's own
 * nav-map title (`useDocumentTitle`'s title, reused rather than duplicated), given focus so
 * the announcement fires reliably and the next Tab starts from the top of the page.
 *
 * Visually hidden, not `display:none` — an element has to be focusable to receive focus,
 * and hiding it with `sr-only` (clipped off-screen, not removed from the layout) is what
 * makes that possible without a visible focus ring landing on empty space.
 */
export function RouteAnnouncer() {
  const { pathname } = useLocation();
  const ref = React.useRef<HTMLDivElement>(null);

  // Derived straight from the route, not stored state — there is nothing here an effect
  // needs to "synchronize," and setting it in one only invites the same cascading-render
  // problem `react-hooks/set-state-in-effect` already caught elsewhere in this app
  // (AppShell.tsx's mobile-nav-close-on-navigate fix uses the same reasoning).
  const route = matchRouteId(pathname);
  const message = route ? route.title : "Page not found";

  React.useEffect(() => {
    ref.current?.focus();
  }, [pathname]);

  return (
    <div ref={ref} tabIndex={-1} role="status" aria-live="polite" className="sr-only">
      {message}
    </div>
  );
}

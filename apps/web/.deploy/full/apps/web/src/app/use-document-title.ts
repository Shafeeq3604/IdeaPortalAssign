import * as React from "react";
import { useLocation } from "react-router-dom";
import { matchRouteId } from "@iep/contracts";
import { PRODUCT_SHORT } from "./product";

/**
 * The browser tab title, kept in sync with the route.
 *
 * Every route in `navigation.map.ts` already carries a human `title` — "Dashboard",
 * "Rankings", "Audit log" — written for exactly this (`PRODUCT_SHORT`'s own doc comment:
 * "For a browser tab... where the full name would crowd everything else"). Neither was
 * ever wired to `document.title`, so every tab read the Vite scaffold default, "web",
 * regardless of page — the single most visible, most permanent "this wasn't finished"
 * signal in the product (production readiness audit). This is the fix: one hook, run
 * once at the shell's root, reusing the nav map's own title rather than inventing a
 * second, parallel copy of it.
 *
 * A route with no match (an unknown URL, still rendered by the catch-all) keeps the
 * product name alone rather than announcing "Not found" in the tab — a typo in the
 * address bar is not something the tab itself needs to editorialise about.
 */
export function useDocumentTitle(): void {
  const { pathname } = useLocation();

  React.useEffect(() => {
    const route = matchRouteId(pathname);
    document.title = route ? `${route.title} · ${PRODUCT_SHORT}` : PRODUCT_SHORT;
  }, [pathname]);
}

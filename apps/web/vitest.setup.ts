import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * Vitest setup for component tests (jsdom environment). Extends `expect` with
 * @testing-library/jest-dom's DOM matchers (toBeInTheDocument, toHaveAttribute, …).
 * Only pure-logic tests existed before this — see src/app/api-client.test.ts,
 * query-keys.test.ts, use-session.test.ts — which never needed a DOM at all.
 *
 * `cleanup()` unmounts whatever the previous test rendered. Testing Library normally
 * registers this itself by detecting a GLOBAL `afterEach` — this project's config does
 * not set `test.globals: true` (every other test file explicitly imports `afterEach`
 * from "vitest" instead, and that convention is worth keeping), so the auto-detection
 * never fires and one test's rendered tree was still in the DOM for the next.
 */
afterEach(() => {
  cleanup();
});

/**
 * jsdom has never implemented `matchMedia` (https://github.com/jsdom/jsdom/issues/1076).
 * That was never missed until `Toaster` (packages/ui/src/components/ui/sonner.tsx, via
 * `sonner`) started rendering in every test that mounts `AppProviders` — it calls
 * `window.matchMedia` to track the OS colour scheme, and a plain `undefined` there is a
 * TypeError, not a graceful no-op. This is the standard jsdom shim for it: a
 * `MediaQueryList`-shaped stub whose listener methods are no-ops, since no test here
 * asserts on live OS theme changes — only the call to `matchMedia` itself needs to exist.
 */
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}

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

import { describe, expect, it } from "vitest";
import { canSee } from "./use-session";

/**
 * Characterization tests for `canSee` — the role-gate every nav item, route guard and
 * conditional CTA in the app calls before deciding whether to render (see AppShell.tsx,
 * AppRouter.tsx, DashboardHero.tsx). This file was previously untested; these tests pin
 * its CURRENT behavior so a future change to the gate is a deliberate decision, not a
 * silent one.
 */
describe("canSee", () => {
  it("allows anyone when the route declares no required roles, regardless of the actor's own roles", () => {
    expect(canSee([], [])).toBe(true);
    expect(canSee(["EMPLOYEE"], [])).toBe(true);
    expect(canSee(["ADMIN", "REVIEWER"], [])).toBe(true);
  });

  it("allows an actor holding at least one of the required roles", () => {
    expect(canSee(["EMPLOYEE", "REVIEWER"], ["REVIEWER", "ADMIN"])).toBe(true);
    expect(canSee(["ADMIN"], ["REVIEWER", "ADMIN"])).toBe(true);
  });

  it("refuses an actor holding none of the required roles", () => {
    expect(canSee(["EMPLOYEE"], ["REVIEWER", "ADMIN"])).toBe(false);
    expect(canSee(["EMPLOYEE", "MANAGEMENT"], ["REVIEWER", "ADMIN"])).toBe(false);
  });

  it("refuses an actor with no roles at all once the route requires any", () => {
    expect(canSee([], ["ADMIN"])).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "../../packages/contracts/src/api.js";
import { ROUTES } from "../../packages/contracts/src/navigation.map.js";
import { ROLE_PERMISSIONS, hasAllPermissions } from "../../packages/contracts/src/permissions.js";
import type { Role } from "../../packages/contracts/src/enums.js";

/**
 * The navigation map and the permission model must agree.
 *
 * Two separate declarations describe who can reach what: `navigation.map.ts` says which
 * roles a route is shown to, and each endpoint's `access.requires` says which permissions
 * the API demands. Nothing connected them, so they drifted — the review queue was offered
 * to administrators and refused to them, a 403 on a link the product itself put there.
 *
 * The existing contract test checks every declared permission is grantable to SOMEBODY.
 * That is a weaker claim, and it passed throughout: `review:write` was perfectly
 * grantable, just not granted to the role being shown the door it opened.
 *
 * A user hits this the moment they click. Nothing else in the suite did.
 */

const ALL_ROLES: readonly Role[] = ["EMPLOYEE", "REVIEWER", "MANAGEMENT", "ADMIN"];

/**
 * Which endpoints a route needs, matched by path.
 *
 * The nav map records `renders` as entity names rather than operation ids, so there is no
 * declared link to follow. Path prefix is the honest approximation: `/review` needs
 * `/review/queue`, `/config/criteria` needs `/config/criteria`. Parameter segments are
 * normalised so `/ideas/:ideaId/review` lines up with `/ideas/{ideaId}/reviews`.
 */
function endpointsFor(routePath: string) {
  const normalise = (p: string) =>
    p.replace(/[:{]\w+\}?/g, "*").replace(/\/+$/, "");
  const route = normalise(routePath);

  return ENDPOINTS.filter((ep) => {
    if (ep.method !== "GET") return false; // opening a page only ever reads
    const path = normalise(ep.path);
    return path === route || path.startsWith(`${route}/`);
  });
}

describe("navigation map ↔ permission model", () => {
  it("every role a route is shown to can actually read that route's endpoints", () => {
    const broken: string[] = [];

    for (const route of ROUTES) {
      if (["login", "home"].includes(route.id)) continue;

      const needed = endpointsFor(route.path);
      if (needed.length === 0) continue; // a page with no GET of its own, e.g. a form

      // An empty `roles` list means every signed-in user, which is the widest audience
      // and therefore the strictest check.
      const audience = route.roles.length > 0 ? route.roles : ALL_ROLES;

      for (const role of audience) {
        for (const ep of needed) {
          if (ep.access === "public") continue;
          if (!hasAllPermissions([role], ep.access.requires)) {
            broken.push(
              `${route.id} (${route.path}) is shown to ${role}, but ${ep.operationId} ` +
                `requires [${ep.access.requires.join(", ")}] which ${role} does not have`,
            );
          }
        }
      }
    }

    expect(
      broken,
      `The navigation map offers a page the API will refuse:\n${broken.join("\n")}`,
    ).toEqual([]);
  });

  it("no role is granted a permission that no endpoint uses", () => {
    /**
     * The other direction. A permission granted but never required is dead weight — it
     * looks like access somebody has and is not, which is exactly as misleading as the
     * reverse.
     */
    const required = new Set(
      ENDPOINTS.flatMap((ep) => (ep.access === "public" ? [] : [...ep.access.requires])),
    );
    const granted = new Set(Object.values(ROLE_PERMISSIONS).flat());

    const unused = [...granted].filter((p) => !required.has(p));

    /**
     * One known exception. `score:override` is a RESOURCE-level decision made by `can()`
     * after the row is loaded, not a route gate: whether you may adjust a score depends on
     * whose idea it is, which no endpoint declaration can express. The override route
     * gates on `review:write` and then asks `can()` the question that actually matters.
     *
     * `config:read` used to be a third. It was granted to every role and required by
     * nothing — the config endpoints declared `requires: []` — so it read as access
     * somebody had and did not. They now declare it, which changes no behaviour and makes
     * the grant mean what it says.
     *
     * Named explicitly so a fourth has to be argued for in a diff rather than absorbed.
     */
    const expected = ["score:override"];
    expect(unused.sort(), `granted but required by no endpoint: ${unused.join(", ")}`)
      .toEqual(expected);
  });
});

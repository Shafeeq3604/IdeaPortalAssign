// k6 — full recompute of 3,000 ideas <= 30s (SPEC §8.5, §11.6, ADR-008).
//
// One VU, one call: a cohort-wide recompute is arithmetic over rows already in the
// database (packages/scoring), not a concurrency scenario — the thing being budgeted is
// how long ONE recompute takes against a 3,000-idea cohort, not how it behaves under
// concurrent load. Run `pnpm --filter @iep/load seed` first, or this recomputes whatever
// evaluated cohort happens to already exist and passes on a budget it never actually paid.
import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.API_BASE_URL || "http://localhost:3001";

function sessionCookieFrom(res) {
  const raw = res.headers["Set-Cookie"];
  const match = raw && raw.match(/iep\.sid=[^;,\s]+/);
  return match ? match[0] : null;
}

export function setup() {
  // The seeded ADMIN account (RUNNING.md) — recompute is an ADMIN action (SPEC §12.3).
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: "admin@example.invalid", password: "innovation-2026" }),
    { headers: { "Content-Type": "application/json" } },
  );
  const cookie = sessionCookieFrom(res);
  if (!cookie) throw new Error("setup could not sign in as the seeded admin account");
  return { cookie };
}

export const options = {
  scenarios: {
    recompute_once: { executor: "shared-iterations", vus: 1, iterations: 1, maxDuration: "60s" },
  },
  thresholds: {
    http_req_duration: ["max<30000"],
  },
};

export default function (data) {
  const res = http.post(
    `${BASE_URL}/rankings/recompute`,
    JSON.stringify({ profileKey: "balanced", reason: "k6 load test — SPEC §11.6 recompute budget" }),
    { headers: { Cookie: data.cookie, "Content-Type": "application/json" }, timeout: "60s" },
  );

  check(res, {
    "recompute accepted (202)": (r) => r.status === 202,
    "cohort is at least 3000": (r) => {
      try {
        return JSON.parse(r.body).cohortSize >= 3000;
      } catch {
        return false;
      }
    },
  });
}

// k6 — concurrent voting on a single idea: how often does SERIALIZABLE cost a 409?
// (apps/api/src/modules/account/routes.ts setIdeaFeedback, SPEC §11.6, FR-18)
//
// setIdeaFeedback wraps its delete-then-create in a
// Prisma.TransactionIsolationLevel.Serializable transaction and maps Postgres's P2034
// (serialization failure) onto a CONCURRENT_MODIFICATION (409) the client is expected to
// retry. That replaced a silent lost-update race, but nobody has measured what it now
// costs: how often a genuine double-click (or a flaky client retrying fast) actually
// collides under SERIALIZABLE, and what that does to p95/p99 latency.
//
// The collision this exists to catch is per-PERSON, not per-idea: the unique constraint
// is scoped to (ideaId, userId, type), so two different users voting on the same idea
// never contend with each other through it. To produce it for real, each of the four
// seeded demo accounts drives several VUs of its own, all hammering the *same* vote
// endpoint for the *same* idea at once — a burst of the exact "same user, two requests in
// flight" scenario the SPEC comment describes as a double-click. Spreading the burst over
// 4 sessions (not 1) also keeps every session under the 300 req/min limiter
// (apps/api/src/server.ts) instead of measuring rate-limit noise alongside serialization
// conflicts.
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

// 409 CONCURRENT_MODIFICATION is an expected, correct outcome under SERIALIZABLE
// contention (see header comment) — without this, k6 counts every non-2xx response as a
// failure and http_req_failed conflates "the server is broken" with "the isolation level
// did its job," which is exactly the distinction this script exists to keep separate.
http.setResponseCallback(http.expectedStatuses(200, 409));

const BASE_URL = __ENV.API_BASE_URL || "http://localhost:3001";
const DEMO_PASSWORD = "innovation-2026";
const DEMO_EMAILS = [
  "employee@example.invalid",
  "reviewer@example.invalid",
  "admin@example.invalid",
  "manager@example.invalid",
];
// VUs per demo account. 5 x 4 = 20 concurrent voters, all on the same idea — enough
// same-user overlap to produce genuine Postgres serialization failures, per the task's
// own guidance that <10 VUs rarely does.
const VUS_PER_USER = 5;
const VUS = VUS_PER_USER * DEMO_EMAILS.length;

// Informational only (per the task: some 409s under real contention are correct
// behaviour, not a bug to gate on) — these just make the number visible in the summary
// instead of buried in raw tags.
const conflictRate = new Rate("vote_conflict_rate");
const voteDuration = new Trend("vote_duration", true);

function sessionCookieFrom(res) {
  const raw = res.headers["Set-Cookie"];
  const match = raw && raw.match(/iep\.sid=[^;,\s]+/);
  return match ? match[0] : null;
}

export function setup() {
  const cookies = [];
  for (const email of DEMO_EMAILS) {
    const res = http.post(
      `${BASE_URL}/auth/login`,
      JSON.stringify({ email, password: DEMO_PASSWORD }),
      { headers: { "Content-Type": "application/json" } },
    );
    const cookie = sessionCookieFrom(res);
    if (!cookie) {
      throw new Error(
        `setup could not sign in as ${email} — run \`pnpm db:seed\` first (RUNNING.md)`,
      );
    }
    cookies.push(cookie);
  }

  // One target idea, shared by every VU, from whichever seeded ideas the first demo
  // account can see (`pnpm db:seed` ships 8; `pnpm demo:data` adds more).
  const listRes = http.get(`${BASE_URL}/ideas?pageSize=1`, {
    headers: { Cookie: cookies[0] },
  });
  let ideaId;
  try {
    ideaId = JSON.parse(listRes.body).items[0].id;
  } catch {
    ideaId = undefined;
  }
  if (!ideaId) {
    throw new Error(
      "setup could not find an idea to vote on — seed some first (`pnpm db:seed`)",
    );
  }

  console.log(`voting on idea ${ideaId} with ${VUS} VUs across ${cookies.length} sessions`);
  return { cookies, ideaId };
}

export const options = {
  scenarios: {
    vote_race: { executor: "constant-vus", vus: VUS, duration: "25s" },
  },
  thresholds: {
    // Every response is either a 200 (vote recorded) or an expected 409 — never a real
    // failure (5xx, timeout, unexpected 4xx). http_req_failed only counts the latter
    // because 409 is marked expectedStatuses below the check, not returned as an HTTP
    // error to k6.
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1000", "p(99)<2000"],
    // Deliberately no threshold on vote_conflict_rate — see the header comment. It is
    // reported in the summary as the actual cost number, not gated on.
  },
};

export default function (data) {
  // VUs are 1-indexed in k6; group them onto the demo accounts round-robin so each
  // account gets VUS_PER_USER VUs voting on the same idea at once.
  const cookie = data.cookies[(__VU - 1) % data.cookies.length];
  const vote = __ITER % 2 === 0 ? "UP" : "DOWN";

  const res = http.post(
    `${BASE_URL}/ideas/${data.ideaId}/feedback`,
    JSON.stringify({ vote }),
    {
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      tags: { name: "setIdeaFeedback" },
    },
  );

  const isConflict = res.status === 409;
  conflictRate.add(isConflict);
  voteDuration.add(res.timings.duration);

  check(res, {
    "status is 200 or 409": (r) => r.status === 200 || r.status === 409,
  });

  // A short, randomised pause between votes: enough overlap across the 5 VUs sharing a
  // session to produce real read-write overlap, but not so tight that every request in
  // the burst trips the 300 req/min-per-session limiter instead of SERIALIZABLE.
  sleep(0.3 + Math.random() * 0.4);
}

// No handleSummary override: `vote_conflict_rate` is a Rate metric, so k6's own default
// end-of-run summary already prints it as a percentage (the actual 409-under-SERIALIZABLE
// cost this script exists to measure) alongside http_req_duration and http_req_failed,
// without suppressing or reimplementing the rest of that summary.

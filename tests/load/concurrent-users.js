// k6 — 200 concurrent users, API p95 <= 400ms, non-AI reads (SPEC §8.5, §11.6).
//
// Sessions are authenticated once in setup(), not per iteration: Argon2id hashing is
// deliberately slow (ADR-023), and 200 VUs each hashing a password on every iteration
// would measure login cost, not the read path this test exists to budget. A pool of 100
// throwaway accounts spreads the 200 VUs across 100 rate-limit buckets (300 req/min each,
// apps/api/src/server.ts) — sharing one session across all 200 VUs would trip the limiter
// almost immediately and fail the test for a reason that has nothing to do with the app.
import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.API_BASE_URL || "http://localhost:3001";
const EMAIL_DOMAIN = __ENV.SIGNUP_EMAIL_DOMAIN || "sageitinc.com";
const POOL_SIZE = 100;
const PASSWORD = "k6-load-test-password-not-real";
const ENDPOINTS = ["/ideas", "/rankings"];

function sessionCookieFrom(res) {
  const raw = res.headers["Set-Cookie"];
  const match = raw && raw.match(/iep\.sid=[^;,\s]+/);
  return match ? match[0] : null;
}

export function setup() {
  const cookies = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const email = `k6-load-${i}-${__ENV.RUN_ID || "local"}@${EMAIL_DOMAIN}`;
    const signupRes = http.post(
      `${BASE_URL}/auth/signup`,
      JSON.stringify({ displayName: `k6 load user ${i}`, email, password: PASSWORD }),
      { headers: { "Content-Type": "application/json" } },
    );

    let cookie = sessionCookieFrom(signupRes);
    if (!cookie) {
      // Already exists from a prior run, or signup didn't sign in for some other reason —
      // an explicit login still gets this bucket a session rather than losing it.
      const loginRes = http.post(
        `${BASE_URL}/auth/login`,
        JSON.stringify({ email, password: PASSWORD }),
        { headers: { "Content-Type": "application/json" } },
      );
      cookie = sessionCookieFrom(loginRes);
    }
    if (cookie) cookies.push(cookie);
  }

  if (cookies.length === 0) {
    throw new Error(
      "setup could not authenticate a single session — check API_BASE_URL and that " +
        "SIGNUP_ALLOWED_EMAIL_DOMAINS (if set) covers SIGNUP_EMAIL_DOMAIN",
    );
  }
  console.log(`authenticated ${cookies.length}/${POOL_SIZE} load-test session(s)`);
  return { cookies };
}

export const options = {
  scenarios: {
    read_heavy: { executor: "constant-vus", vus: 200, duration: "30s" },
  },
  thresholds: {
    http_req_duration: ["p(95)<400"],
    http_req_failed: ["rate<0.01"],
  },
};

export default function (data) {
  const cookie = data.cookies[__VU % data.cookies.length];
  const path = ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)];

  const res = http.get(`${BASE_URL}${path}`, {
    headers: { Cookie: cookie },
    tags: { name: path },
  });

  check(res, { "status is 200": (r) => r.status === 200 });
  sleep(1);
}

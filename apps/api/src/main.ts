import Redis from "ioredis";
import { disconnectPrisma, getPrisma } from "@iep/db";
import { ApiEnv, loadEnv } from "@iep/contracts/env";
import { initErrorTracking } from "./lib/error-tracking.js";
import { buildServer } from "./server.js";
import { registerDevLogin } from "./modules/auth.routes.js";
import {
  DevAuthProvider, OidcAuthProvider, PasswordAuthProvider, type AuthProvider,
} from "./auth/provider.js";
import { MemorySessionStore, RedisSessionStore, type SessionStore } from "./auth/session.js";
import {
  makeAnalysisEnqueuer, makeRankingEnqueuer, noopEnqueuer, noopRankingEnqueuer,
} from "./lib/analysis-queue.js";
import { makeDiscoveryEnqueuer, noopDiscoveryEnqueuer } from "./lib/discovery-queue.js";
import { makeIdeaCreationEnqueuer, noopIdeaCreationEnqueuer } from "./lib/idea-creation-queue.js";
import type { AppContext } from "./context.js";
import { makeAttachmentBackend } from "./modules/idea/attachments.js";

/**
 * Entry point. Composition happens here and only here, so `buildServer` stays injectable
 * and tests never touch Redis, the IdP, or process.env.
 */

const env = loadEnv(ApiEnv, process.env);
const isProd = env.NODE_ENV === "production";

// Before anything else can throw (ADR-025) — an error during session-store or route
// setup below is exactly the kind this exists to catch.
initErrorTracking(env);

/**
 * Which mechanism establishes identity (ADR-023).
 *
 * PASSWORD is the default now, in development and production alike. It used to default to
 * the dev user-picker outside production, which meant the thing everyone ran locally and
 * demonstrated had no authentication at all — anyone could click "Ash Admin".
 *
 * `dev` is still available for tests and local work, but you have to ask for it, and it
 * still refuses to construct in production.
 */
function makeAuthProvider(): AuthProvider {
  const configured = process.env["AUTH_PROVIDER"] ?? "password";
  if (configured === "password") return new PasswordAuthProvider();
  if (configured === "dev") return new DevAuthProvider(env.NODE_ENV);
  return new OidcAuthProvider({
    issuer: env.OIDC_ISSUER,
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
    redirectUri: env.OIDC_REDIRECT_URI,
  });
}

async function makeSessionStore(): Promise<{ store: SessionStore; redis: Redis | null }> {
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
  });
  try {
    await redis.connect();
    return { store: new RedisSessionStore(redis), redis };
  } catch {
    redis.disconnect();
    if (isProd) {
      // In production a missing session store is a hard failure: falling back to memory
      // would silently break logout-revocation and any second instance.
      throw new Error("Redis is required in production for server-side sessions (SPEC §4.1)");
    }
    return { store: new MemorySessionStore(), redis: null };
  }
}

const { store, redis } = await makeSessionStore();

const ctx: AppContext = {
  env,
  db: getPrisma(),
  sessions: store,
  auth: makeAuthProvider(),
  // No Redis in dev means no analysis runs — but submissions still save (P3).
  // Replaced just below with a logger-aware instance once Fastify exists.
  analysis: noopEnqueuer,
  ranking: noopRankingEnqueuer,
  discovery: noopDiscoveryEnqueuer,
  ideaCreation: noopIdeaCreationEnqueuer,
  attachments: makeAttachmentBackend(env),
};

const app = buildServer(ctx);
// The enqueuer logs through Fastify, so a queue failure is visible rather than silent.
// Each enqueuer opens its own Redis connection alongside `redis` above (the session
// store's), so all three are tracked here to be closed on shutdown, not just left open.
const queueEnqueuers: { close(): Promise<void> }[] = [];
if (redis) {
  const analysis = makeAnalysisEnqueuer(env.REDIS_URL, app.log);
  const ranking = makeRankingEnqueuer(env.REDIS_URL, app.log);
  const discovery = makeDiscoveryEnqueuer(env.REDIS_URL, app.log);
  const ideaCreation = makeIdeaCreationEnqueuer(env.REDIS_URL, app.log);
  Object.assign(ctx, { analysis, ranking, discovery, ideaCreation });
  queueEnqueuers.push(analysis, ranking, discovery, ideaCreation);
}
registerDevLogin(app, ctx);

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  app.log.info(
    { auth: ctx.auth.kind, sessions: redis ? "redis" : "memory" },
    `iep-api listening on :${env.PORT}`,
  );
  if (!redis) {
    app.log.warn("Redis unavailable — using in-memory sessions. Run `pnpm deps:up`.");
  }
} catch (error) {
  app.log.error(error, "failed to start");
  process.exit(1);
}

// Guards against a second SIGINT/SIGTERM re-entering the shutdown sequence (impatient
// double Ctrl-C, or a process manager sending both) — without it, a second signal starts
// a second `app.close()` against an already-closing server.
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`${signal} received, closing`);
    void (async () => {
      try {
        await app.close();
        await Promise.allSettled(queueEnqueuers.map((q) => q.close()));
        redis?.disconnect();
        await disconnectPrisma();
      } catch (error) {
        // A rejection here used to be unhandled — the exact scenario shutdown code hits
        // most often (Redis already half-gone) meant `process.exit(0)` below was never
        // reached and the process hung until SIGKILL. Log it and exit anyway.
        app.log.error(error, "error during shutdown — exiting anyway");
      } finally {
        process.exit(0);
      }
    })();
  });
}

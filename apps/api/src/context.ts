import type { PrismaClient } from "@iep/db";
import type { ApiEnv } from "@iep/contracts/env";
import type { AuthProvider } from "./auth/provider.js";
import type { SessionStore } from "./auth/session.js";

/**
 * Everything a handler may touch, passed explicitly.
 *
 * Injected rather than imported so tests can build a server with a stub provider and an
 * in-memory session store without touching Redis, the IdP, or process.env.
 */
export interface AppContext {
  readonly env: ApiEnv;
  readonly db: PrismaClient;
  readonly sessions: SessionStore;
  readonly auth: AuthProvider;
}

import type { PrismaClient } from "@iep/db";
import type { ApiEnv } from "@iep/contracts/env";
import type { AuthProvider } from "./auth/provider.js";
import type { SessionStore } from "./auth/session.js";
import type { AttachmentBackend } from "./modules/idea/attachments.js";

/**
 * Everything a handler may touch, passed explicitly.
 *
 * Injected rather than imported so tests can build a server with a stub provider and an
 * in-memory session store without touching Redis, the IdP, or process.env.
 */
export interface AnalysisEnqueuer {
  /** Returns false when the queue is unavailable — the caller degrades, never throws. */
  enqueue(job: { ideaId: string; ideaVersionId: string; contentHash: string }): Promise<boolean>;
}

/**
 * Recompute is cohort-wide and belongs on the queue (ADR-008), so the API asks rather
 * than computes. Same degrade-never-throw contract as the analysis enqueuer: a write
 * that succeeded must not be rolled back because Redis was down.
 */
export interface RankingEnqueuer {
  enqueue(job: {
    profileKey?: string | undefined;
    triggeredById?: string | null;
    triggerReason: string;
  }): Promise<boolean>;
}

export interface AppContext {
  readonly env: ApiEnv;
  readonly db: PrismaClient;
  readonly sessions: SessionStore;
  readonly auth: AuthProvider;
  readonly analysis: AnalysisEnqueuer;
  readonly ranking: RankingEnqueuer;
  readonly attachments: AttachmentBackend;
}

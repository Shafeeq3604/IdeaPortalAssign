import type { PrismaClient } from "@iep/db";
import { redact, DISCOVERY_SYSTEM_PROMPT, type DiscoveryChatProvider } from "@iep/ai";
import type { ObservabilityClient } from "./observability.js";

/**
 * SPC-001 — AI Discovery Agent job runner.
 *
 * One query, one model call (SPC-10). No idea/evaluation/ranking table is ever touched
 * here (SPC-13) — this file imports nothing from `@iep/evaluation` or `@iep/scoring`,
 * which is also enforced structurally by an architecture test, the same way
 * `packages/ai` is barred from `packages/scoring`.
 */

export interface DiscoveryDeps {
  readonly db: PrismaClient;
  readonly provider: DiscoveryChatProvider;
  readonly redactionEnabled: boolean;
  readonly observability: ObservabilityClient;
}

export async function runDiscoveryQuery(
  deps: DiscoveryDeps,
  input: { readonly discoveryQueryId: string },
): Promise<void> {
  const { db, provider } = deps;

  const row = await db.discoveryQuery.findUnique({
    where: { id: input.discoveryQueryId },
    include: { user: { select: { id: true, email: true, displayName: true } } },
  });
  if (!row) throw new Error(`discovery query ${input.discoveryQueryId} no longer exists`);

  await db.discoveryQuery.update({
    where: { id: row.id },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  // SPC-3: the same redaction pass idea submissions get, applied here before the query
  // ever reaches the model — and, for this feature, before it would reach any external
  // service at all.
  const redacted = redact(row.query, deps.redactionEnabled);

  const started = Date.now();
  const outcome = await provider.run(redacted.text);

  // iManner observability — one event per query. Discovery is a single model call
  // (SPC-10), so there is exactly one event to report here, unlike the analysis
  // pipeline's per-step loop. Runs against the stub provider still call `provider.run`
  // but never reach Anthropic; they're reported too (provider: "stub"), same as the
  // pipeline reports its stub outcomes — the dashboard's Provider filter is how those
  // get told apart from real spend, not an omission at the source.
  deps.observability.record({
    agentId: "discovery.agent",
    agentName: "Discovery Agent",
    userId: row.userId,
    userName: row.user.displayName,
    interactionType: "discovery-query",
    businessTransactionType: "discovery_query",
    businessTransactionId: row.id,
    businessTransactionName: outcome.ok ? outcome.discoveryType : null,
    provider: provider.name,
    modelId: outcome.ok ? outcome.model : "unknown",
    inputTokens: outcome.ok ? outcome.usage.inputTokens : null,
    outputTokens: outcome.ok ? outcome.usage.outputTokens : null,
    latencyMs: Date.now() - started,
    inputPayload: { systemPrompt: DISCOVERY_SYSTEM_PROMPT, query: redacted.text },
    outputPayload: outcome.ok
      ? { discoveryType: outcome.discoveryType, summary: outcome.summary, items: outcome.items }
      : null,
    status: outcome.ok ? "success" : "error",
    error: outcome.ok ? null : outcome.errorCode,
    errorType: outcome.ok ? null : outcome.errorCode,
  });

  if (outcome.ok) {
    await db.discoveryQuery.update({
      where: { id: row.id },
      data: {
        status: "SUCCEEDED",
        discoveryType: outcome.discoveryType,
        summary: outcome.summary,
        items: outcome.items as never,
        provider: provider.name,
        model: outcome.model,
        finishedAt: new Date(),
      },
    });
  } else {
    await db.discoveryQuery.update({
      where: { id: row.id },
      data: {
        status: "FAILED",
        errorCode: outcome.errorCode,
        provider: provider.name,
        finishedAt: new Date(),
      },
    });
  }

  // SPC-16: one audit entry per query, success or failure, outside the `if` above so
  // neither branch can forget it.
  await db.auditLog.create({
    data: {
      actorId: row.userId,
      action: "discovery.query",
      entityType: "DiscoveryQuery",
      entityId: row.id,
      after: {
        status: outcome.ok ? "SUCCEEDED" : "FAILED",
        discoveryType: outcome.ok ? outcome.discoveryType : null,
        errorCode: outcome.ok ? null : outcome.errorCode,
      },
    },
  });
}

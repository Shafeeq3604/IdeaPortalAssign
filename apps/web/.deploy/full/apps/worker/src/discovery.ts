import type { PrismaClient } from "@iep/db";
import { redact, type DiscoveryChatProvider } from "@iep/ai";

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
}

export async function runDiscoveryQuery(
  deps: DiscoveryDeps,
  input: { readonly discoveryQueryId: string },
): Promise<void> {
  const { db, provider } = deps;

  const row = await db.discoveryQuery.findUnique({ where: { id: input.discoveryQueryId } });
  if (!row) throw new Error(`discovery query ${input.discoveryQueryId} no longer exists`);

  await db.discoveryQuery.update({
    where: { id: row.id },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  // SPC-3: the same redaction pass idea submissions get, applied here before the query
  // ever reaches the model — and, for this feature, before it would reach any external
  // service at all.
  const redacted = redact(row.query, deps.redactionEnabled);

  const outcome = await provider.run(redacted.text);

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

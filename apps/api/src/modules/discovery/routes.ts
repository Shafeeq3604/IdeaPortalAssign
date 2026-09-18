import { CreateDiscoveryQueryRequest, type DiscoveryResultItem } from "@iep/contracts";
import type { Handler } from "../../server.js";
import { requireActor, sendError } from "../../server.js";

/**
 * SPC-001 — AI Discovery Agent routes.
 *
 * Standalone by design (SPC-13): nothing here reads or writes `ideas`, `idea_versions`,
 * `evaluations`, `criterion_scores`, or `ranking_entries`, and nothing here is reachable
 * from any of those modules' routes either.
 */

const NOT_FOUND = "No discovery query with that id";

export function registerDiscoveryRoutes(handlers: Map<string, Handler>): void {
  handlers.set("createDiscoveryQuery", async (request, reply, ctx) => {
    const actor = requireActor(request);
    const parsed = CreateDiscoveryQueryRequest.safeParse(request.body);
    if (!parsed.success) return sendError(reply, "VALIDATION_FAILED", "A query is required");

    const row = await ctx.db.discoveryQuery.create({
      data: { userId: actor.userId, query: parsed.data.query, status: "PENDING" },
    });

    // Same degrade-never-throw contract as idea analysis (P3) — a queue outage never
    // fails the request, the row is already saved. But "degrade" used to mean the row
    // sat at PENDING forever with nothing to distinguish it from a job that was simply
    // still queued: the client has no timeout, so `enqueue()` failing was indistinguishable
    // from Redis being merely slow, and "Thinking…" never resolved (found live — two rows
    // from this exact gap, orphaned with no job ever created for them). `discoverQuery`
    // already has a FAILED status and the page already renders it with a
    // try-again message; this just uses that existing path instead of staying silent.
    const enqueued = await ctx.discovery.enqueue({ discoveryQueryId: row.id });
    const finalRow = enqueued
      ? row
      : await ctx.db.discoveryQuery.update({
          where: { id: row.id },
          data: { status: "FAILED", errorCode: "QUEUE_UNAVAILABLE", finishedAt: new Date() },
        });

    return {
      id: finalRow.id,
      query: finalRow.query,
      status: finalRow.status,
      discoveryType: finalRow.discoveryType,
      summary: finalRow.summary,
      items: [],
      errorCode: finalRow.errorCode,
      createdAt: finalRow.createdAt.toISOString(),
      finishedAt: finalRow.finishedAt?.toISOString() ?? null,
    };
  });

  handlers.set("getDiscoveryQuery", async (request, reply, ctx) => {
    const actor = requireActor(request);
    const { discoveryQueryId } = request.params as { discoveryQueryId: string };

    const row = await ctx.db.discoveryQuery.findUnique({ where: { id: discoveryQueryId } });
    // SPC-15: not found and not-yours answer identically — existence of another user's
    // query is not disclosed, the same rule idea reads already follow (SPEC §9.1).
    if (!row || row.userId !== actor.userId) return sendError(reply, "NOT_FOUND", NOT_FOUND);

    return {
      id: row.id,
      query: row.query,
      status: row.status,
      discoveryType: row.discoveryType,
      summary: row.summary,
      items: (row.items as DiscoveryResultItem[] | null) ?? [],
      errorCode: row.errorCode,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
    };
  });

  handlers.set("listDiscoveryQueries", async (request, _reply, ctx) => {
    const actor = requireActor(request);
    const rows = await ctx.db.discoveryQuery.findMany({
      where: { userId: actor.userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return {
      items: rows.map((row) => ({
        id: row.id,
        query: row.query,
        status: row.status,
        discoveryType: row.discoveryType,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  });
}

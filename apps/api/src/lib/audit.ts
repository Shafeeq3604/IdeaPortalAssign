import type { Prisma } from "@iep/db";

/**
 * The audit trail (FR-29, SPEC §9.8).
 *
 * `/admin/audit` has been readable since P1 and, until now, always empty: the read
 * surface shipped without a single writer. A trail nothing writes to is worse than no
 * trail, because it reads as "nothing has happened" rather than "nothing is recorded".
 *
 * Two rules make it trustworthy:
 *
 *  - **Same transaction as the change.** An audit row written afterwards can be lost
 *    while the change survives, which is the one failure mode an audit trail must not
 *    have. Every call here takes the transaction client, not the root client.
 *  - **Append only, enforced by the database.** A trigger installed at P0 rejects any
 *    UPDATE or DELETE on `audit_log` (SPEC §4.7). Not a convention — even a test
 *    teardown cannot remove a row, which is how it should be.
 */

/** A Prisma transaction client — the same surface as PrismaClient minus the tx methods. */
export type Tx = Prisma.TransactionClient;

export type AuditAction =
  | "idea.transition"
  | "idea.review"
  | "score.override"
  | "ranking.recompute";

export interface AuditInput {
  readonly actorId: string | null;
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId: string;
  /** Snapshots, not diffs. A diff cannot be re-read once the schema moves on. */
  readonly before?: unknown;
  readonly after?: unknown;
  readonly reason?: string | null;
  readonly requestId?: string | null;
}

export async function writeAudit(tx: Tx, input: AuditInput): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: (input.before ?? null) as Prisma.InputJsonValue,
      after: (input.after ?? null) as Prisma.InputJsonValue,
      reason: input.reason ?? null,
      requestId: input.requestId ?? null,
    },
  });
}

/**
 * Where an audit row's subject lives, so every row on `/admin/audit` links out
 * (SPEC §6.2 row 44).
 *
 * Returns null rather than guessing for an entity type with no canonical route — a link
 * to a 404 is worse than no link, and the nav contract counts a dead link as an orphan.
 */
export function entityHrefFor(entityType: string, entityId: string): string | null {
  switch (entityType) {
    case "idea":
      return `/ideas/${entityId}/overview`;
    case "evaluation":
      return `/ideas/${entityId}/evaluation`;
    case "ranking_run":
      return `/rankings/${entityId}`;
    default:
      return null;
  }
}

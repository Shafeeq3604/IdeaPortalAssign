import type { Handler } from "../server.js";
import { entityHrefFor } from "../lib/audit.js";
import { sendError } from "../server.js";
import type { Role } from "@iep/contracts";

/** Admin identity surfaces (FR-01). Read-only in M1. */
export function registerIdentityRoutes(handlers: Map<string, Handler>): void {
  handlers.set("listUsers", async (request, _reply, ctx) => {
    const q = request.query as { page?: string; perPage?: string; q?: string; role?: Role };
    const page = Math.max(1, Number(q.page ?? 1));
    const perPage = Math.min(100, Math.max(1, Number(q.perPage ?? 25)));

    const where = {
      ...(q.q ? { OR: [{ displayName: { contains: q.q, mode: "insensitive" as const } },
                      { email: { contains: q.q, mode: "insensitive" as const } }] } : {}),
      ...(q.role ? { roles: { some: { role: q.role } } } : {}),
    };

    const [rows, total] = await Promise.all([
      ctx.db.user.findMany({
        where, include: { department: true, roles: true, _count: { select: { ideas: true } } },
        orderBy: { displayName: "asc" }, skip: (page - 1) * perPage, take: perPage,
      }),
      ctx.db.user.count({ where }),
    ]);

    return {
      items: rows.map((u) => ({
        id: u.id, displayName: u.displayName, email: u.email,
        roles: u.roles.map((r) => r.role),
        department: u.department ? { id: u.department.id, name: u.department.name } : null,
        isActive: u.isActive, ideaCount: u._count.ideas,
      })),
      meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    };
  });

  handlers.set("listAuditEntries", async (request, _reply, ctx) => {
    const q = request.query as { page?: string; perPage?: string; entityType?: string };
    const page = Math.max(1, Number(q.page ?? 1));
    const perPage = Math.min(100, Math.max(1, Number(q.perPage ?? 25)));
    const where = q.entityType ? { entityType: q.entityType } : {};

    const [rows, total] = await Promise.all([
      ctx.db.auditLog.findMany({
        where,
        // Never load the password hash to render an audit row (see repo.ts).
        include: {
          actor: { select: { id: true, displayName: true, department: { select: { name: true } } } },
        },
        orderBy: { at: "desc" }, skip: (page - 1) * perPage, take: perPage,
      }),
      ctx.db.auditLog.count({ where }),
    ]);

    /*
     * Names for the subjects on this page, two batched reads rather than one per row.
     * `evaluation` rows are keyed by the idea (see `entityHrefFor`), so they share the
     * idea lookup. A subject that no longer exists gets no name AND no link — the log is
     * append-only and outlives what it describes, and a link to a 404 is a dead end.
     */
    // `audit_log.entity_id` is text; the tables looked up are uuid-keyed, and one
    // malformed id in an `in` list would fail the whole page rather than one row.
    const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const idsOf = (...types: string[]) =>
      [...new Set(rows.filter((a) => types.includes(a.entityType) && isUuid(a.entityId)).map((a) => a.entityId))];
    const ideaIds = idsOf("idea", "evaluation");
    const userIds = idsOf("user");
    const [ideas, users] = await Promise.all([
      ideaIds.length
        ? ctx.db.idea.findMany({ where: { id: { in: ideaIds } }, select: { id: true, currentVersion: { select: { title: true } } } })
        : [],
      userIds.length ? ctx.db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } }) : [],
    ]);
    const names = new Map<string, string>([
      ...ideas.map((i) => [i.id, i.currentVersion?.title ?? "(untitled idea)"] as const),
      ...users.map((u) => [u.id, u.displayName] as const),
    ]);
    const named = (entityType: string) => entityType === "idea" || entityType === "evaluation" || entityType === "user";

    return {
      items: rows.map((a) => ({
        id: a.id,
        actor: a.actor ? {
          id: a.actor.id, displayName: a.actor.displayName,
          departmentName: a.actor.department?.name ?? null,
        } : null,
        action: a.action, entityType: a.entityType, entityId: a.entityId,
        before: a.before ?? null, after: a.after ?? null,
        reason: a.reason, requestId: a.requestId, at: a.at.toISOString(),
        // Was a literal "Idea" comparison against a writer that emits "idea", so every
        // href came back null and every audit row was a dead end (SPEC §6.2 row 44).
        // One helper now owns the mapping, and both sides import it.
        entityHref: named(a.entityType) && !names.has(a.entityId) ? null : entityHrefFor(a.entityType, a.entityId),
        // Only for kinds that have a name; others omit it rather than claim "no longer exists".
        ...(named(a.entityType) ? { entityLabel: names.get(a.entityId) ?? null } : {}),
      })),
      meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    };
  });

  void sendError;
}

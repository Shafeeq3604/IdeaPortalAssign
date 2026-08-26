import type { Handler } from "../server.js";
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
        where, include: { actor: { include: { department: true } } },
        orderBy: { at: "desc" }, skip: (page - 1) * perPage, take: perPage,
      }),
      ctx.db.auditLog.count({ where }),
    ]);

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
        entityHref: a.entityType === "Idea" ? `/ideas/${a.entityId}/overview` : null,
      })),
      meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    };
  });

  void sendError;
}

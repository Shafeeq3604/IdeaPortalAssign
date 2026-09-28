import {
  ListNotificationsQuery, MarkNotificationsReadRequest, NotificationEvent,
  UpdateNotificationPreferencesRequest,
} from "@iep/contracts";
import type { NotificationItem, NotificationPreferencesResponse } from "@iep/contracts";
import {
  DEFAULT_EMAIL_ENABLED, NOTIFICATION_EVENT_COPY, hrefForPayload, parseNotificationPayload,
  renderNotification,
} from "@iep/evaluation";
import type { PrismaClient } from "@iep/db";
import type { Handler } from "../../server.js";
import { requireActor, sendError } from "../../server.js";

/**
 * P13 — the notification centre (FR-28). Every query here is keyed on the SIGNED-IN
 * user's id and nothing else: there is no way to read, mark or configure anybody else's
 * notifications, so there is no permission beyond "signed in" to check (`requires: []`).
 * Writes happen at the event sites (idea transition, review, leadership decision, the
 * worker's analysis) — this module only reads and marks.
 */

async function unreadCount(db: PrismaClient, userId: string) {
  return db.notification.count({ where: { userId, readAt: null } });
}

async function preferencesFor(db: PrismaClient, userId: string): Promise<NotificationPreferencesResponse> {
  const rows = await db.notificationPreference.findMany({ where: { userId } });
  const byEvent = new Map(rows.map((r) => [r.event, r.emailEnabled]));
  return {
    items: NotificationEvent.options.map((event) => ({
      event,
      ...NOTIFICATION_EVENT_COPY[event],
      emailEnabled: byEvent.get(event) ?? DEFAULT_EMAIL_ENABLED,
    })),
  };
}

export function registerNotificationRoutes(handlers: Map<string, Handler>): void {
  handlers.set("listNotifications", async (request, reply, ctx) => {
    const parsed = ListNotificationsQuery.safeParse(request.query);
    if (!parsed.success) return sendError(reply, "VALIDATION_FAILED", "Invalid filters");
    const { userId } = requireActor(request);
    const { page, perPage, unread } = parsed.data;
    const where = { userId, ...(unread === "true" ? { readAt: null } : {}) };

    const [rows, total, unreadTotal] = await Promise.all([
      ctx.db.notification.findMany({
        where, orderBy: { createdAt: "desc" }, skip: (page - 1) * perPage, take: perPage,
      }),
      ctx.db.notification.count({ where }),
      unreadCount(ctx.db, userId),
    ]);

    const items: NotificationItem[] = [];
    for (const row of rows) {
      // A row this code version cannot read (an event from a newer deploy, a corrupted
      // payload) is dropped from the page rather than failing the whole centre.
      const payload = parseNotificationPayload(row.event, row.payload);
      if (!payload) continue;
      const { title, body } = renderNotification(payload);
      items.push({
        id: row.id,
        event: payload.event,
        title,
        body,
        href: hrefForPayload(payload, row.entityId),
        createdAt: row.createdAt.toISOString(),
        readAt: row.readAt?.toISOString() ?? null,
      });
    }
    return {
      items,
      meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
      unreadCount: unreadTotal,
    };
  });

  handlers.set("markNotificationsRead", async (request, reply, ctx) => {
    const parsed = MarkNotificationsReadRequest.safeParse(request.body ?? {});
    if (!parsed.success) return sendError(reply, "VALIDATION_FAILED", "Invalid request");
    const { userId } = requireActor(request);
    // `userId` in the WHERE is the whole authorisation: an id belonging to someone else
    // simply matches no row, and nothing tells the caller whether it exists.
    const result = await ctx.db.notification.updateMany({
      where: { userId, readAt: null, ...(parsed.data.ids ? { id: { in: parsed.data.ids } } : {}) },
      data: { readAt: new Date() },
    });
    return { updated: result.count, unreadCount: await unreadCount(ctx.db, userId) };
  });

  handlers.set("getNotificationPreferences", async (request, _reply, ctx) => {
    return preferencesFor(ctx.db, requireActor(request).userId);
  });

  handlers.set("updateNotificationPreferences", async (request, reply, ctx) => {
    const parsed = UpdateNotificationPreferencesRequest.safeParse(request.body);
    if (!parsed.success) return sendError(reply, "VALIDATION_FAILED", "Invalid preferences");
    const { userId } = requireActor(request);
    await ctx.db.$transaction(
      parsed.data.items.map((item) =>
        ctx.db.notificationPreference.upsert({
          where: { userId_event: { userId, event: item.event } },
          create: { userId, event: item.event, emailEnabled: item.emailEnabled },
          update: { emailEnabled: item.emailEnabled },
        }),
      ),
    );
    return preferencesFor(ctx.db, userId);
  });
}

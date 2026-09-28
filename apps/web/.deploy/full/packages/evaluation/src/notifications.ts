import type { Prisma, PrismaClient } from "@iep/db";
import {
  NotificationEvent, NotificationPayload, can,
  type IdeaStatus, type LeadershipDecisionStatus, type ReviewDecision, type Role,
} from "@iep/contracts";

/**
 * P13 — notifications (FR-28). One module both processes use: the API records the
 * P2/P6 events inside their own transactions, the worker records ANALYSIS_COMPLETED and
 * drains the email outbox. Wording lives here once, so the centre and the email can
 * never describe the same event two ways.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** A missing preference row means email is ON — so a new event type needs no backfill. */
export const DEFAULT_EMAIL_ENABLED = true;

export const NOTIFICATION_EVENT_COPY: Record<NotificationEvent, { label: string; description: string }> = {
  ANALYSIS_COMPLETED: {
    label: "Analysis finished",
    description: "When the AI analysis of your idea completes, or needs more detail from you.",
  },
  STATUS_CHANGED: {
    label: "Status changed",
    description: "When a reviewer or administrator moves your idea to a new stage.",
  },
  REVIEW_RECORDED: {
    label: "Review recorded",
    description: "When a reviewer records a review on your idea.",
  },
  LEADERSHIP_DECISION_RECORDED: {
    label: "Leadership decision",
    description: "When leadership records a decision on your idea.",
  },
  COMMENT_ADDED: {
    label: "New comments",
    description: "When someone comments on your idea, or on an idea you follow.",
  },
  MENTIONED: {
    label: "Mentions",
    description: "When someone @mentions you in a comment.",
  },
  FOLLOWED_IDEA_MOVED: {
    label: "Ideas you follow",
    description: "When an idea you follow moves to a new stage.",
  },
  RESULTS_RECORDED: {
    label: "Results",
    description: "When results are recorded on your idea, or on one whose team you joined.",
  },
};

// Server-side wording for the values a notification quotes. Kept beside the copy above
// rather than imported from apps/web: the worker renders emails and must not depend on a
// front-end bundle.
const STATUS_LABEL: Record<IdeaStatus, string> = {
  DRAFT: "Draft", SUBMITTED: "Submitted", AI_ANALYSIS: "Being analysed",
  NEEDS_CLARIFICATION: "Needs clarification", EVALUATED: "Evaluated", RANKED: "Ranked",
  UNDER_REVIEW: "Under review", PROTOTYPE_CANDIDATE: "Prototype candidate", PILOT: "Pilot",
  PRODUCTION_CANDIDATE: "Production candidate", IMPLEMENTED: "Implemented", PARKED: "Parked",
  BLOCKED: "Blocked", REJECTED: "Rejected", ARCHIVED: "Archived",
};
const DECISION_LABEL: Record<ReviewDecision, string> = {
  VALIDATED: "Validated", NEEDS_CLARIFICATION: "Needs clarification", REJECTED: "Rejected",
  PARKED: "Parked", OVERRIDDEN: "Score adjusted", APPROVED_FOR_PROTOTYPE: "Approved for a prototype",
};
const LEADERSHIP_LABEL: Record<LeadershipDecisionStatus, string> = {
  APPROVED: "Approved", REJECTED: "Rejected", NEEDS_VALIDATION: "Needs validation",
  OVERRIDE_RECOMMENDATION: "Recommendation overridden",
};

/** Title + one-line body for a stored payload. Pure; the idea title is user text, quoted as-is. */
export function renderNotification(payload: NotificationPayload): { title: string; body: string } {
  const idea = `“${payload.ideaTitle}”`;
  switch (payload.event) {
    case "ANALYSIS_COMPLETED":
      return payload.outcome === "EVALUATED"
        ? { title: "Your idea has been analysed", body: `${idea} is analysed and scored. See how it was evaluated.` }
        : { title: "Your idea needs more detail", body: `The analysis of ${idea} could not finish. Add detail and resubmit.` };
    case "STATUS_CHANGED":
      return {
        title: `Your idea is now ${STATUS_LABEL[payload.to]}`,
        body: `${payload.actorName} moved ${idea} from ${STATUS_LABEL[payload.from]} to ${STATUS_LABEL[payload.to]}.`,
      };
    case "REVIEW_RECORDED":
      return {
        title: "Your idea was reviewed",
        body: `${payload.actorName} recorded a review of ${idea}: ${DECISION_LABEL[payload.decision]}.`,
      };
    case "LEADERSHIP_DECISION_RECORDED":
      return {
        title: "Leadership recorded a decision",
        body: `${payload.actorName} recorded a decision on ${idea}: ${LEADERSHIP_LABEL[payload.decisionStatus]}.`,
      };
    case "COMMENT_ADDED":
      return {
        title: payload.audience === "OWNER" ? "New comment on your idea" : "New comment on an idea you follow",
        body: `${payload.actorName} on ${idea}: “${payload.excerpt}”`,
      };
    case "MENTIONED":
      return {
        title: `${payload.actorName} mentioned you`,
        body: `In a comment on ${idea}: “${payload.excerpt}”`,
      };
    case "FOLLOWED_IDEA_MOVED":
      return {
        title: `An idea you follow is now ${STATUS_LABEL[payload.to]}`,
        body: `${payload.actorName} moved ${idea} from ${STATUS_LABEL[payload.from]} to ${STATUS_LABEL[payload.to]}.`,
      };
    case "RESULTS_RECORDED": {
      const title = payload.audience === "OWNER" ? "Your idea’s results are in" : "Results are in for an idea you’re helping build";
      if (payload.kind === "FINANCIALS") {
        return { title, body: `${payload.actorName} updated the money figures for ${idea}. See what it has returned.` };
      }
      const unit = payload.unit ? ` ${payload.unit}` : "";
      const measured = payload.actualValue !== null ? `: ${formatFigure(payload.actualValue)}${unit}` : "";
      const against = payload.predictedValue !== null ? ` (predicted ${formatFigure(payload.predictedValue)}${unit})` : "";
      return { title, body: `${payload.actorName} recorded ${payload.kpiName ?? "a result"} for ${idea}${measured}${against}.` };
    }
  }
}

/** A KPI figure for a sentence: grouped, at most three decimals, no trailing zeros. */
function formatFigure(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

/** The first words of a comment, for a notification line: one line, at most ~140 chars. */
export function commentExcerpt(body: string, max = 140): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Where a notification leads: the idea's own page, which every recipient could open when
 * it was sent. A comment or mention lands on that comment itself (`#comment-<id>`).
 */
export function notificationHref(event: NotificationEvent, ideaId: string | null, commentId?: string): string {
  if (!ideaId) return "/notifications";
  if (event === "ANALYSIS_COMPLETED") return `/ideas/${ideaId}/evaluation`;
  if (event === "RESULTS_RECORDED") return `/ideas/${ideaId}/overview#impact`;
  return commentId ? `/ideas/${ideaId}/overview#comment-${commentId}` : `/ideas/${ideaId}/overview`;
}

/** `notificationHref` for a stored payload — the one both the centre and the email use. */
export function hrefForPayload(payload: NotificationPayload, ideaId: string | null): string {
  return notificationHref(payload.event, ideaId, "commentId" in payload ? payload.commentId : undefined);
}

/** Owner + current title, the two facts every idea notification needs. */
export async function ideaNotificationTarget(db: Db, ideaId: string) {
  const idea = await db.idea.findUnique({
    where: { id: ideaId },
    select: { submitterId: true, currentVersion: { select: { title: true } } },
  });
  return idea ? { ownerId: idea.submitterId, ideaTitle: idea.currentVersion?.title ?? "Untitled idea" } : null;
}

/**
 * Record one notification for an idea's owner, in the caller's transaction.
 *
 * Never notifies the actor about their own action (an employee archiving their own
 * idea, an owner-admin moving it). An inactive recipient gets the in-app row but no
 * email. Email is requested (PENDING) only if the recipient has not opted out of this
 * event; the worker's outbox drain does the sending.
 */
export async function recordIdeaNotification(
  db: Db,
  input: {
    ideaId: string;
    /** Null for the worker's own automated events. */
    actorId: string | null;
    /** Built from the idea's CURRENT title, read in the same transaction. */
    payload: (ideaTitle: string) => NotificationPayload;
  },
): Promise<{ recorded: boolean }> {
  const target = await ideaNotificationTarget(db, input.ideaId);
  if (!target || target.ownerId === input.actorId) return { recorded: false };
  const payload = input.payload(target.ideaTitle);

  const [recipient, preference] = await Promise.all([
    db.user.findUnique({ where: { id: target.ownerId }, select: { isActive: true } }),
    db.notificationPreference.findUnique({
      where: { userId_event: { userId: target.ownerId, event: payload.event } },
      select: { emailEnabled: true },
    }),
  ]);
  const wantsEmail = (preference?.emailEnabled ?? DEFAULT_EMAIL_ENABLED) && recipient?.isActive === true;

  await db.notification.create({
    data: {
      userId: target.ownerId,
      event: payload.event,
      entityId: input.ideaId,
      payload,
      emailStatus: wantsEmail ? "PENDING" : "NOT_REQUESTED",
    },
  });
  return { recorded: true };
}

/**
 * P18 — record one notification for each of several people (followers, @mentioned), in
 * the caller's transaction.
 *
 * The same rules as `recordIdeaNotification`, plus the one that matters once recipients
 * are not the owner: a person is only notified if they can OPEN the idea right now
 * (`can(…, "idea:read")`) — a follower of an idea that has since been archived, or
 * someone @mentioned on an idea their role cannot see, gets nothing rather than a link
 * to a page that refuses them. Duplicates and the actor are dropped; so is the owner,
 * whom the caller notifies separately with owner wording.
 */
export async function recordPeopleNotifications(
  db: Db,
  input: {
    ideaId: string;
    actorId: string | null;
    recipientIds: readonly string[];
    payload: (ideaTitle: string) => NotificationPayload;
  },
): Promise<{ recorded: string[] }> {
  const idea = await db.idea.findUnique({
    where: { id: input.ideaId },
    select: { submitterId: true, status: true, currentVersion: { select: { title: true } } },
  });
  if (!idea) return { recorded: [] };
  const wanted = [...new Set(input.recipientIds)].filter(
    (id) => id !== input.actorId && id !== idea.submitterId,
  );
  if (wanted.length === 0) return { recorded: [] };

  const payload = input.payload(idea.currentVersion?.title ?? "Untitled idea");
  const [users, prefs] = await Promise.all([
    db.user.findMany({
      where: { id: { in: wanted } },
      select: { id: true, isActive: true, roles: { select: { role: true } } },
    }),
    db.notificationPreference.findMany({
      where: { userId: { in: wanted }, event: payload.event },
      select: { userId: true, emailEnabled: true },
    }),
  ]);
  const emailOff = new Set(prefs.filter((p) => !p.emailEnabled).map((p) => p.userId));
  const resource = { ideaId: input.ideaId, submitterId: idea.submitterId, status: idea.status as IdeaStatus };
  const recipients = users.filter(
    (u) => can({ userId: u.id, roles: u.roles.map((r) => r.role as Role) }, "idea:read", resource).allowed,
  );
  if (recipients.length === 0) return { recorded: [] };

  await db.notification.createMany({
    data: recipients.map((u) => ({
      userId: u.id,
      event: payload.event,
      entityId: input.ideaId,
      payload,
      emailStatus: u.isActive && !emailOff.has(u.id) && DEFAULT_EMAIL_ENABLED ? "PENDING" : "NOT_REQUESTED",
    })),
  });
  return { recorded: recipients.map((u) => u.id) };
}

/** The idea's team: everyone who said "I could help build this" (FR-18's CAN_HELP_IMPLEMENT). */
export async function ideaTeamIds(db: Db, ideaId: string): Promise<string[]> {
  const rows = await db.feedback.findMany({ where: { ideaId, type: "CAN_HELP_IMPLEMENT" }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

/** Everyone following an idea — the recipient list for a comment or a stage change. */
export async function ideaFollowerIds(db: Db, ideaId: string): Promise<string[]> {
  const rows = await db.ideaFollow.findMany({ where: { ideaId }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

/** A stored row's payload, parsed — null for a row this code version cannot read. */
export function parseNotificationPayload(event: string, payload: unknown): NotificationPayload | null {
  if (!NotificationEvent.safeParse(event).success) return null;
  const parsed = NotificationPayload.safeParse(payload);
  return parsed.success && parsed.data.event === event ? parsed.data : null;
}

/* ── Email outbox (worker only) ── */

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface EmailTransport {
  readonly name: "log" | "smtp";
  send(message: EmailMessage): Promise<void>;
}

/** Why this person got the email — P18 made "because you submitted it" no longer always true. */
const EMAIL_REASON: Record<NotificationEvent, string> = {
  ANALYSIS_COMPLETED: "it is about an idea you submitted",
  STATUS_CHANGED: "it is about an idea you submitted",
  REVIEW_RECORDED: "it is about an idea you submitted",
  LEADERSHIP_DECISION_RECORDED: "it is about an idea you submitted",
  COMMENT_ADDED: "you submitted or follow this idea",
  MENTIONED: "someone mentioned you",
  FOLLOWED_IDEA_MOVED: "you follow this idea",
  RESULTS_RECORDED: "you submitted this idea or joined its team",
};

/** Plain text on purpose: no HTML means no markup injection from a user-written idea title. */
export function renderEmail(
  payload: NotificationPayload,
  href: string,
  webOrigin: string,
): { subject: string; text: string } {
  const { title, body } = renderNotification(payload);
  const url = new URL(href, webOrigin).toString();
  return {
    subject: title,
    text:
      `${body}\n\nOpen it: ${url}\n\n` +
      `You are receiving this because ${EMAIL_REASON[payload.event]}. ` +
      `Change which emails you get: ${new URL("/notifications", webOrigin).toString()}\n`,
  };
}

/**
 * Drain up to `batch` PENDING emails. Each row is CLAIMED (PENDING → SENDING with a
 * conditional update) before sending, so two worker replicas never send the same email.
 * A send failure marks the row FAILED — no automatic retry, so a misconfigured transport
 * cannot turn into a retry storm; the in-app notification is unaffected either way.
 */
export async function drainEmailOutbox(
  db: PrismaClient,
  transport: EmailTransport,
  opts: { webOrigin: string; batch?: number },
): Promise<{ sent: number; failed: number; skipped: number }> {
  const pending = await db.notification.findMany({
    where: { emailStatus: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: opts.batch ?? 25,
    select: { id: true, userId: true, event: true, entityId: true, payload: true },
  });
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of pending) {
    const claim = await db.notification.updateMany({
      where: { id: row.id, emailStatus: "PENDING" },
      data: { emailStatus: "SENDING", emailAttemptedAt: new Date() },
    });
    if (claim.count === 0) continue; // another worker got it

    const payload = parseNotificationPayload(row.event, row.payload);
    const user = await db.user.findUnique({ where: { id: row.userId }, select: { email: true, isActive: true } });
    if (!payload || !user?.isActive) {
      await db.notification.update({ where: { id: row.id }, data: { emailStatus: "NOT_REQUESTED" } });
      skipped++;
      continue;
    }
    const { subject, text } = renderEmail(payload, hrefForPayload(payload, row.entityId), opts.webOrigin);
    try {
      await transport.send({ to: user.email, subject, text });
      await db.notification.update({ where: { id: row.id }, data: { emailStatus: "SENT" } });
      sent++;
    } catch {
      await db.notification.update({ where: { id: row.id }, data: { emailStatus: "FAILED" } });
      failed++;
    }
  }
  return { sent, failed, skipped };
}

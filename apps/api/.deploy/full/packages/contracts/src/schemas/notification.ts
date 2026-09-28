import { z } from "zod";
import { Id, PageQuery, Timestamp, paginated } from "./common.js";
import { IdeaStatus, LeadershipDecisionStatus, ReviewDecision } from "../enums.js";

/**
 * Notifications (P13 — FR-28). SPEC §14: "Notification centre + email · Depends on: P2
 * lifecycle events, P6 review events." The four events below are exactly those: the
 * idea's owner hears about analysis finishing (P3's status write, the lifecycle's own
 * automated step), a person moving their idea (P2), and a review or leadership decision
 * being recorded on it (P6). Always the idea's OWNER, and never the actor themself —
 * nobody is notified about their own action. P18 adds the first events that reach
 * beyond the owner (comments, @mentions, followed ideas moving) — same never-the-actor
 * rule, plus: only people who can still open the idea.
 *
 * In-app notifications are always on. Email is per-event opt-out, default ON; the
 * transport is the worker's (log-only unless SMTP is configured), see schema.prisma's
 * `NotificationEmailStatus` note for the outbox.
 */

export const NotificationEvent = z.enum([
  "ANALYSIS_COMPLETED",
  "STATUS_CHANGED",
  "REVIEW_RECORDED",
  "LEADERSHIP_DECISION_RECORDED",
  // P18 — the social layer. These go beyond the owner: to followers and to the people
  // a comment names, always only if they can still open the idea, never to the actor.
  "COMMENT_ADDED",
  "MENTIONED",
  "FOLLOWED_IDEA_MOVED",
  // Impact — a delivery result recorded on an idea (a KPI measurement or its money
  // figures): to the submitter and the people on its team, never the actor.
  "RESULTS_RECORDED",
]);
export type NotificationEvent = z.infer<typeof NotificationEvent>;

/**
 * What the row stores, per event — facts only, never pre-rendered prose, so wording can
 * change without rewriting history. Parsed on read; a row that fails to parse is
 * dropped from the list rather than failing the whole centre.
 */
export const NotificationPayload = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("ANALYSIS_COMPLETED"),
    ideaTitle: z.string(),
    outcome: z.enum(["EVALUATED", "NEEDS_CLARIFICATION"]),
  }),
  z.object({
    event: z.literal("STATUS_CHANGED"),
    ideaTitle: z.string(),
    from: IdeaStatus,
    to: IdeaStatus,
    actorName: z.string(),
  }),
  z.object({
    event: z.literal("REVIEW_RECORDED"),
    ideaTitle: z.string(),
    decision: ReviewDecision,
    actorName: z.string(),
  }),
  z.object({
    event: z.literal("LEADERSHIP_DECISION_RECORDED"),
    ideaTitle: z.string(),
    decisionStatus: LeadershipDecisionStatus,
    actorName: z.string(),
  }),
  z.object({
    event: z.literal("COMMENT_ADDED"),
    ideaTitle: z.string(),
    actorName: z.string(),
    commentId: Id,
    /** The first words, so the centre says what was said without opening the idea. */
    excerpt: z.string(),
    /** OWNER: on your idea. FOLLOWER: on an idea you follow. Changes the wording only. */
    audience: z.enum(["OWNER", "FOLLOWER"]),
  }),
  z.object({
    event: z.literal("MENTIONED"),
    ideaTitle: z.string(),
    actorName: z.string(),
    commentId: Id,
    excerpt: z.string(),
  }),
  z.object({
    event: z.literal("FOLLOWED_IDEA_MOVED"),
    ideaTitle: z.string(),
    from: IdeaStatus,
    to: IdeaStatus,
    actorName: z.string(),
  }),
  z.object({
    event: z.literal("RESULTS_RECORDED"),
    ideaTitle: z.string(),
    actorName: z.string(),
    /** OWNER: your idea. TEAM: an idea you offered to help build. Changes the wording only. */
    audience: z.enum(["OWNER", "TEAM"]),
    /** MEASUREMENT: a KPI result. FINANCIALS: the money figures were updated. */
    kind: z.enum(["MEASUREMENT", "FINANCIALS"]),
    /** The KPI measured, with its unit — null for FINANCIALS. Money is never quoted in a
     *  notification or email: it is on the idea, for whoever may open it. */
    kpiName: z.string().nullable(),
    unit: z.string().nullable(),
    actualValue: z.number().nullable(),
    predictedValue: z.number().nullable(),
  }),
]);
export type NotificationPayload = z.infer<typeof NotificationPayload>;

export const NotificationItem = z.object({
  id: Id,
  event: NotificationEvent,
  /** Rendered server-side from the payload — one wording for the centre and the email. */
  title: z.string(),
  body: z.string(),
  /** Where clicking it goes. The idea's own page — the owner can always open it. */
  href: z.string(),
  createdAt: Timestamp,
  readAt: Timestamp.nullable(),
});
export type NotificationItem = z.infer<typeof NotificationItem>;

export const ListNotificationsQuery = PageQuery.extend({
  unread: z.enum(["true", "false"]).optional(),
});
export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuery>;

export const ListNotificationsResponse = paginated(NotificationItem).extend({
  unreadCount: z.number().int().min(0),
});
export type ListNotificationsResponse = z.infer<typeof ListNotificationsResponse>;

export const MarkNotificationsReadRequest = z.object({
  /** Omitted = mark every unread notification of the signed-in person read. */
  ids: z.array(Id).min(1).max(100).optional(),
});
export type MarkNotificationsReadRequest = z.infer<typeof MarkNotificationsReadRequest>;

export const MarkNotificationsReadResponse = z.object({
  updated: z.number().int().min(0),
  unreadCount: z.number().int().min(0),
});
export type MarkNotificationsReadResponse = z.infer<typeof MarkNotificationsReadResponse>;

export const NotificationPreferenceItem = z.object({
  event: NotificationEvent,
  label: z.string(),
  description: z.string(),
  emailEnabled: z.boolean(),
});
export type NotificationPreferenceItem = z.infer<typeof NotificationPreferenceItem>;

export const NotificationPreferencesResponse = z.object({
  items: z.array(NotificationPreferenceItem),
});
export type NotificationPreferencesResponse = z.infer<typeof NotificationPreferencesResponse>;

export const UpdateNotificationPreferencesRequest = z.object({
  items: z.array(z.object({ event: NotificationEvent, emailEnabled: z.boolean() })).min(1).max(20),
});
export type UpdateNotificationPreferencesRequest = z.infer<typeof UpdateNotificationPreferencesRequest>;

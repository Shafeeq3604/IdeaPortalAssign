import { z } from "zod";
import { IdeaStatus } from "./enums.js";

/**
 * URL search-param schemas, per route (SPEC §7.8, P0 deliverable 5c).
 *
 * These are CONTRACTS between parallel UI slices, exactly like the API schemas.
 * Without them, P2 and P7 each invent their own filter serialisation and back-navigation
 * silently diverges — which is a §6.3 assertion-4 failure, not a style difference.
 *
 * The rule: if pressing Back should restore it, it lives here.
 */

const csv = <T extends z.ZodTypeAny>(inner: T) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : undefined))
    .pipe(z.array(inner).optional());

const page = z.coerce.number().int().min(1).default(1);
const uuid = z.string().uuid();

export const IdeaListParams = z.object({
  status: csv(IdeaStatus),
  department: uuid.optional(),
  category: uuid.optional(),
  q: z.string().max(200).optional(),
  sort: z.enum(["recent", "oldest", "title", "status"]).default("recent"),
  page,
});
export type IdeaListParams = z.infer<typeof IdeaListParams>;

export const RankingParams = z.object({
  profile: z.string().min(1).optional(),
  department: uuid.optional(),
  category: uuid.optional(),
  status: csv(IdeaStatus),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  rankBand: z.enum(["top10", "top25", "top50", "all"]).default("all"),
  sort: z.enum(["rank", "delta", "recent"]).default("rank"),
  page,
  /** Ids selected for comparison; the board keeps selection in the URL so Back restores it. */
  compare: csv(uuid),
});
export type RankingParams = z.infer<typeof RankingParams>;

export const CompareParams = z.object({
  ids: csv(uuid).pipe(z.array(uuid).min(2).max(4)),
  profile: z.string().min(1).optional(),
});
export type CompareParams = z.infer<typeof CompareParams>;

export const ReviewQueueParams = z.object({
  status: csv(IdeaStatus),
  department: uuid.optional(),
  sort: z.enum(["oldest", "recent", "rank"]).default("oldest"),
  page,
});
export type ReviewQueueParams = z.infer<typeof ReviewQueueParams>;

export const DashboardParams = z.object({
  department: uuid.optional(),
  category: uuid.optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  profile: z.string().min(1).optional(),
});
export type DashboardParams = z.infer<typeof DashboardParams>;

export const HistoryParams = z.object({
  /** "2-3" compares v2 with v3. */
  diff: z
    .string()
    .regex(/^\d+-\d+$/)
    .optional(),
});
export type HistoryParams = z.infer<typeof HistoryParams>;

export const ReviseParams = z.object({
  rec: uuid.optional(),
});
export type ReviseParams = z.infer<typeof ReviseParams>;

export const AuditParams = z.object({
  entity: z.string().max(64).optional(),
  entityId: uuid.optional(),
  actor: uuid.optional(),
  action: z.string().max(64).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  page,
});
export type AuditParams = z.infer<typeof AuditParams>;

export const AdminUsersParams = z.object({
  q: z.string().max(200).optional(),
  role: z.string().max(32).optional(),
  page,
});
export type AdminUsersParams = z.infer<typeof AdminUsersParams>;

export const ConfigParams = z.object({
  criterion: z.string().max(64).optional(),
});
export type ConfigParams = z.infer<typeof ConfigParams>;

/** routeId → schema. `pnpm test:nav` asserts every route's declared params have one. */
export const SEARCH_PARAM_SCHEMAS = {
  ideas: IdeaListParams,
  rankings: RankingParams,
  "rankings.compare": CompareParams,
  "review.queue": ReviewQueueParams,
  dashboard: DashboardParams,
  "idea.history": HistoryParams,
  "idea.revise": ReviseParams,
  "admin.audit": AuditParams,
  "admin.users": AdminUsersParams,
  "config.criteria": ConfigParams,
  "config.profiles": ConfigParams,
} as const satisfies Record<string, z.ZodTypeAny>;

import { z } from "zod";

/**
 * Shared request/response primitives (P0 deliverable 2b).
 *
 * Every API message in this folder is built from these. Frontend and backend both read
 * them, and the OpenAPI catalogue is generated from them — so there is exactly one
 * definition of what a message looks like and drift is not expressible.
 */

export const Id = z.string().uuid();
export type Id = z.infer<typeof Id>;

/** ISO-8601 with timezone. Serialised form of a `timestamptz`. */
export const Timestamp = z.string().datetime({ offset: true });
export type Timestamp = z.infer<typeof Timestamp>;

export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
});
export type PageQuery = z.infer<typeof PageQuery>;

export const PageMeta = z.object({
  page: z.number().int().min(1),
  perPage: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});
export type PageMeta = z.infer<typeof PageMeta>;

/** Every list response has this shape. No bare arrays at the boundary. */
export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item), meta: PageMeta });
}

/** Actor reference embedded in responses — never the full user record. */
export const ActorRef = z.object({
  id: Id,
  displayName: z.string(),
  departmentName: z.string().nullable(),
});
export type ActorRef = z.infer<typeof ActorRef>;

export const DepartmentRef = z.object({ id: Id, name: z.string() });
export type DepartmentRef = z.infer<typeof DepartmentRef>;

export const CategoryRef = z.object({ id: Id, key: z.string(), label: z.string() });
export type CategoryRef = z.infer<typeof CategoryRef>;

/**
 * Provenance travels with every AI-derived field (SPEC §7.4, REQUIREMENTS §34).
 * The UI cannot render AI content without knowing this, so it is part of the contract
 * rather than something the client infers.
 */
export const Provenance = z.object({
  source: z.enum(["AI", "HUMAN", "SIGNAL", "FALLBACK"]),
  validatedBy: z.object({ id: Id, displayName: z.string(), at: Timestamp }).nullable(),
  model: z.string().nullable(),
  promptVersion: z.string().nullable(),
});
export type Provenance = z.infer<typeof Provenance>;

/** 202 response for work that continues asynchronously (SPEC §3.3, NFR-06). */
export const AcceptedResponse = z.object({
  analysisRunId: Id,
  ideaId: Id,
  statusUrl: z.string(),
  streamUrl: z.string(),
});
export type AcceptedResponse = z.infer<typeof AcceptedResponse>;

export const OkResponse = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof OkResponse>;

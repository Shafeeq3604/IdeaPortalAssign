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

/**
 * A repeatable query parameter, e.g. `?status=RANKED&status=DRAFT`.
 *
 * A querystring has no notion of an array. Fastify's parser — like every other one —
 * gives a STRING when a key appears once and an ARRAY when it appears twice, so a plain
 * `z.array(...)` accepts two values and rejects one.
 *
 * That is not a theoretical edge: it shipped. The idea list grew status filter chips,
 * clicking one produced `?status=RANKED`, and the API answered VALIDATION_FAILED —
 * so filtering by exactly one status, the most common thing anyone does, was the only
 * case that did not work. Two chips were fine.
 *
 * Absent stays absent. A missing filter and an empty filter mean different things: one
 * is "no constraint", the other is "match nothing".
 */
export function queryArray<T extends z.ZodTypeAny>(schema: T) {
  /**
   * Takes the finished ARRAY schema, not the item schema, so constraints like
   * `.min(2)` live inside it. Wrapping a constrained array in a `.pipe()` instead made
   * zod-to-json-schema emit an `allOf` containing an unresolvable internal `$ref`, and
   * the generated OpenAPI document described a request nothing could validate against.
   */
  return z.preprocess(
    (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
    schema,
  );
}

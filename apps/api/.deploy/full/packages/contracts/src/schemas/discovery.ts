import { z } from "zod";
import * as C from "./common.js";

/**
 * SPC-001 — AI Discovery Agent (standalone research tool).
 *
 * Deliberately separate from schemas/idea.ts and schemas/analysis.ts: a discovery query
 * has no relationship to an Idea, an IdeaVersion, or the evaluation/ranking pipeline
 * (SPC-13). It is its own small, additive surface.
 */

export const DiscoveryStatus = z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED"]);
export type DiscoveryStatus = z.infer<typeof DiscoveryStatus>;

/**
 * Free-text query. 2,000 chars mirrors the existing `ShortField` convention used
 * elsewhere for free-text input (schemas/idea.ts's `changeSummary`/`reason` fields) —
 * reused rather than invented.
 */
const QueryText = z.string().trim().min(1).max(2_000);

export const CreateDiscoveryQueryRequest = z.object({
  query: QueryText,
});
export type CreateDiscoveryQueryRequest = z.infer<typeof CreateDiscoveryQueryRequest>;

/** One generated idea. A source is never required (SPC-20 supersedes SPC-12's
 * mandatory-source filter) — `sources` may be empty. */
export const DiscoveryResultItem = z.object({
  title: z.string(),
  summary: z.string(),
  sources: z.array(z.string()).default([]),
});
export type DiscoveryResultItem = z.infer<typeof DiscoveryResultItem>;

export const DiscoveryQueryResponse = z.object({
  id: C.Id,
  query: QueryText,
  status: DiscoveryStatus,
  discoveryType: z.string().nullable(),
  summary: z.string().nullable(),
  items: z.array(DiscoveryResultItem),
  errorCode: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type DiscoveryQueryResponse = z.infer<typeof DiscoveryQueryResponse>;

/** One row in a user's own discovery history — never another user's (SPC-15). */
export const DiscoveryQuerySummary = z.object({
  id: C.Id,
  query: QueryText,
  status: DiscoveryStatus,
  discoveryType: z.string().nullable(),
  createdAt: z.string(),
});
export type DiscoveryQuerySummary = z.infer<typeof DiscoveryQuerySummary>;

export const ListDiscoveryQueriesResponse = z.object({
  items: z.array(DiscoveryQuerySummary),
});
export type ListDiscoveryQueriesResponse = z.infer<typeof ListDiscoveryQueriesResponse>;

import type { Prisma, PrismaClient } from "@prisma/client";

/** Every function here works from the root client or inside a transaction. */
type Db = PrismaClient | Prisma.TransactionClient;

/**
 * pgvector access (P12, FR-20/FR-21) — the only place a raw SQL query touches the
 * `vector(1536)` columns ADR-012 reserved at P0. Prisma has no typed API for `vector`
 * (`Unsupported("vector(1536)")` in schema.prisma), and `$queryRaw`/`$executeRaw` are
 * lint-banned outside this package (SPEC §4.3) — parameterised queries only, so SQL
 * injection is a class of bug that has nowhere to live. Every value below is passed as a
 * Prisma template parameter, never string-interpolated into the query text.
 */

/** `[0.1,0.2,...]` — the literal pgvector's own input parser accepts, cast with `::vector`. */
function toVectorParam(vector: readonly number[]): string {
  return `[${vector.join(",")}]`;
}

export async function setIdeaVersionEmbedding(
  db: Db,
  ideaVersionId: string,
  vector: readonly number[],
): Promise<void> {
  await db.$executeRaw`
    UPDATE idea_versions SET embedding = ${toVectorParam(vector)}::vector
    WHERE id = ${ideaVersionId}::uuid
  `;
}

/** Called when a P10 edit changes the text an embedding was computed from — the stale
 *  vector must not keep answering AI-11 searches until the next detection pass re-embeds
 *  it (packages/evaluation's opportunistic backfill). */
export async function clearExistingSolutionEmbedding(db: Db, existingSolutionId: string): Promise<void> {
  await db.$executeRaw`UPDATE existing_solutions SET embedding = NULL WHERE id = ${existingSolutionId}::uuid`;
}

export async function setExistingSolutionEmbedding(
  db: Db,
  existingSolutionId: string,
  vector: readonly number[],
): Promise<void> {
  await db.$executeRaw`
    UPDATE existing_solutions SET embedding = ${toVectorParam(vector)}::vector
    WHERE id = ${existingSolutionId}::uuid
  `;
}

export interface SimilarIdeaVersionMatch {
  readonly ideaId: string;
  readonly ideaVersionId: string;
  readonly title: string;
  readonly problemStatement: string;
  readonly description: string;
  /** Cosine similarity, 1 - cosine distance. In [0, 2] in theory; [0, 1] for real text. */
  readonly similarity: number;
}

/**
 * Cosine search over every OTHER idea's CURRENT version (AI-10, FR-20). Self-joins the
 * source version's own embedding rather than taking a vector param, so a caller never
 * has to round-trip one just to search with it.
 */
export async function findSimilarIdeaVersions(
  db: Db,
  params: {
    readonly ideaVersionId: string;
    readonly excludeIdeaId: string;
    readonly threshold: number;
    readonly limit: number;
  },
): Promise<SimilarIdeaVersionMatch[]> {
  return db.$queryRaw<SimilarIdeaVersionMatch[]>`
    SELECT
      i.id AS "ideaId",
      iv.id AS "ideaVersionId",
      iv.title,
      iv.problem_statement AS "problemStatement",
      iv.description,
      (1 - (iv.embedding <=> src.embedding))::float8 AS similarity
    FROM idea_versions iv
    JOIN ideas i ON i.current_version_id = iv.id
    CROSS JOIN (SELECT embedding FROM idea_versions WHERE id = ${params.ideaVersionId}::uuid) src
    WHERE iv.embedding IS NOT NULL
      AND src.embedding IS NOT NULL
      AND i.id != ${params.excludeIdeaId}::uuid
      AND (1 - (iv.embedding <=> src.embedding)) >= ${params.threshold}
    ORDER BY similarity DESC
    LIMIT ${params.limit}
  `;
}

/**
 * The non-AI fallback for AI-10 (SPEC §12.3): pg_trgm similarity over title + problem
 * statement when no embedding is available for this version (no key configured, or the
 * embedding call itself failed). Same shape as `findSimilarIdeaVersions` so the caller
 * doesn't need to branch on which path produced a match.
 */
export async function findSimilarIdeaVersionsByTrigram(
  db: Db,
  params: {
    readonly ideaVersionId: string;
    readonly excludeIdeaId: string;
    readonly threshold: number;
    readonly limit: number;
  },
): Promise<SimilarIdeaVersionMatch[]> {
  return db.$queryRaw<SimilarIdeaVersionMatch[]>`
    SELECT
      i.id AS "ideaId",
      iv.id AS "ideaVersionId",
      iv.title,
      iv.problem_statement AS "problemStatement",
      iv.description,
      similarity(src.text, iv.title || ' ' || iv.problem_statement)::float8 AS similarity
    FROM idea_versions iv
    JOIN ideas i ON i.current_version_id = iv.id
    CROSS JOIN (
      SELECT title || ' ' || problem_statement AS text FROM idea_versions WHERE id = ${params.ideaVersionId}::uuid
    ) src
    WHERE i.id != ${params.excludeIdeaId}::uuid
      AND similarity(src.text, iv.title || ' ' || iv.problem_statement) >= ${params.threshold}
    ORDER BY similarity DESC
    LIMIT ${params.limit}
  `;
}

/**
 * Catalogue rows an admin added or edited since their last embed (P10 writes the row
 * through plain Prisma — SPEC §4.4 keeps the provider call worker-side, so it cannot
 * embed inline). Read with plain Prisma (no vector column involved), kept here anyway so
 * every catalogue query that reasons about `embedding` sits in one file.
 */
export function findExistingSolutionsMissingEmbedding(
  db: Db,
): Promise<Array<{ id: string; name: string; description: string; categories: string[] }>> {
  return db.$queryRaw<Array<{ id: string; name: string; description: string; categories: string[] }>>`
    SELECT id, name, description, categories FROM existing_solutions
    WHERE is_active = true AND embedding IS NULL
  `;
}

/** Which catalogue entries already have an embedding — for the admin list view only
 *  (never used for search; `findMatchingExistingSolutions` does that). */
export async function findExistingSolutionIdsWithEmbedding(db: Db): Promise<Set<string>> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM existing_solutions WHERE embedding IS NOT NULL
  `;
  return new Set(rows.map((r) => r.id));
}

export interface ExistingSolutionMatchRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly description: string;
  readonly categories: readonly string[];
  readonly similarity: number;
}

/** Cosine search over the curated catalogue (AI-11, FR-21). Takes a vector param directly
 *  (the idea version being assessed has no catalogue embedding of its own to self-join). */
export async function findMatchingExistingSolutions(
  db: Db,
  params: { readonly vector: readonly number[]; readonly threshold: number; readonly limit: number },
): Promise<ExistingSolutionMatchRow[]> {
  return db.$queryRaw<ExistingSolutionMatchRow[]>`
    SELECT
      id, name, kind, description, categories,
      (1 - (embedding <=> ${toVectorParam(params.vector)}::vector))::float8 AS similarity
    FROM existing_solutions
    WHERE is_active = true
      AND embedding IS NOT NULL
      AND (1 - (embedding <=> ${toVectorParam(params.vector)}::vector)) >= ${params.threshold}
    ORDER BY similarity DESC
    LIMIT ${params.limit}
  `;
}

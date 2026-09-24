import type { PrismaClient } from "@iep/db";
import {
  findExistingSolutionsMissingEmbedding, findMatchingExistingSolutions, findSimilarIdeaVersions,
  findSimilarIdeaVersionsByTrigram, setExistingSolutionEmbedding, setIdeaVersionEmbedding,
} from "@iep/db";
import type { DetectionProvider, EmbeddingProvider, SimilarIdeaInput } from "@iep/ai";

/**
 * P12 — similar-idea (AI-10, FR-20) and existing-solution (AI-11, FR-21) detection.
 *
 * Deliberately NOT part of `runPipeline` (apps/worker/src/pipeline.ts): those seven/eight
 * steps are keyed by `AnalysisStep` and hashed against `IdeaVersion` fields for
 * carry-forward (FR-16) — a fundamentally different shape from what these two need
 * (a matched idea pair; a catalogue shortlist). The worker calls `runDetection` as its
 * own step straight after the pipeline finishes, same "part of finishing an analysis, not
 * a separate user action" reasoning `evaluateVersion` already uses one call up.
 *
 * Both halves share ONE embedding call (SPEC §12.3's AI-10 fallback pg_trgm path needs
 * none at all) rather than each computing their own — the version's embedding is written
 * back to `idea_versions.embedding` either way, so a later admin catalogue edit or a later
 * idea's own detection run can search against it without re-embedding this one.
 */

/** pg_trgm's own conventional default (`pg_trgm.similarity_threshold`'s GUC default is
 *  0.3) — a library constant, not a product number, so it does not need the same
 *  sign-off as the two configurable thresholds below. */
const TRIGRAM_FALLBACK_THRESHOLD = 0.3;
const SIMILAR_IDEA_LIMIT = 5;

export interface DetectionDeps {
  readonly db: PrismaClient;
  readonly embeddingProvider: EmbeddingProvider;
  readonly detectionProvider: DetectionProvider;
}

export interface DetectionResult {
  readonly similarIdeaCount: number;
  readonly existingSolutionMatchCount: number;
  readonly embeddingSource: "openai" | "stub" | "fallback";
}

export async function runDetection(
  deps: DetectionDeps,
  input: { readonly ideaId: string; readonly ideaVersionId: string },
): Promise<DetectionResult> {
  const { db } = deps;

  const version = await db.ideaVersion.findUnique({ where: { id: input.ideaVersionId } });
  if (!version) return { similarIdeaCount: 0, existingSolutionMatchCount: 0, embeddingSource: "fallback" };

  const idea = await db.idea.findUnique({
    where: { id: input.ideaId },
    include: { category: true },
  });

  const config = await db.detectionConfig.findUnique({ where: { id: "default" } });
  const similarIdeaThreshold = Number(config?.similarIdeaThreshold ?? 0.85);
  const existingSolutionThreshold = Number(config?.existingSolutionThreshold ?? 0.75);
  const existingSolutionTopN = config?.existingSolutionTopN ?? 5;

  const ideaInput: SimilarIdeaInput = {
    title: version.title,
    problemStatement: version.problemStatement,
    description: version.description,
  };

  const embedResult = await deps.embeddingProvider.embed(
    `${version.title}\n${version.problemStatement}\n${version.description}`,
  );

  if (embedResult.ok) {
    await setIdeaVersionEmbedding(db, input.ideaVersionId, embedResult.vector);
  }

  const similarIdeaCount = await detectSimilarIdeas(deps, input, ideaInput, embedResult.ok, similarIdeaThreshold);
  const existingSolutionMatchCount = await assessExistingSolutions(
    deps, input.ideaVersionId, ideaInput,
    embedResult.ok ? embedResult.vector : null,
    idea?.category?.key ?? null,
    existingSolutionThreshold, existingSolutionTopN,
  );

  return {
    similarIdeaCount,
    existingSolutionMatchCount,
    embeddingSource: embedResult.ok ? deps.embeddingProvider.name : "fallback",
  };
}

async function detectSimilarIdeas(
  deps: DetectionDeps,
  input: { readonly ideaId: string; readonly ideaVersionId: string },
  ideaInput: SimilarIdeaInput,
  hasEmbedding: boolean,
  threshold: number,
): Promise<number> {
  const { db } = deps;

  const matches = hasEmbedding
    ? await findSimilarIdeaVersions(db, {
        ideaVersionId: input.ideaVersionId, excludeIdeaId: input.ideaId, threshold, limit: SIMILAR_IDEA_LIMIT,
      })
    : await findSimilarIdeaVersionsByTrigram(db, {
        ideaVersionId: input.ideaVersionId, excludeIdeaId: input.ideaId,
        threshold: TRIGRAM_FALLBACK_THRESHOLD, limit: SIMILAR_IDEA_LIMIT,
      });

  // Replace-on-rerun, same convention as every other detection/analysis table.
  await db.similarIdea.deleteMany({ where: { ideaId: input.ideaId } });
  if (matches.length === 0) return 0;

  for (const match of matches) {
    // The trigram fallback makes NO model call at all (SPEC §12.3 AI-10's non-AI
    // fallback) — the summary is only ever an explanation of a match the embedding
    // search found, never what decides one.
    let differenceSummary: string | null = null;
    if (hasEmbedding) {
      const summary = await deps.detectionProvider.summarizeDifference(ideaInput, {
        title: match.title, problemStatement: match.problemStatement, description: match.description,
      });
      if (summary.ok) differenceSummary = summary.summary;
    }
    await db.similarIdea.create({
      data: {
        ideaId: input.ideaId,
        similarTo: match.ideaId,
        similarity: match.similarity,
        differenceSummary,
      },
    });
  }

  return matches.length;
}

async function assessExistingSolutions(
  deps: DetectionDeps,
  ideaVersionId: string,
  ideaInput: SimilarIdeaInput,
  vector: readonly number[] | null,
  categoryKey: string | null,
  threshold: number,
  topN: number,
): Promise<number> {
  const { db } = deps;
  await db.existingSolutionAssessment.deleteMany({ where: { ideaVersionId } });

  // A P10 write cannot embed inline (SPEC §4.4 keeps the provider call worker-side, and
  // the API process never holds a provider key) — so any catalogue entry an admin just
  // added or edited is caught up here, opportunistically, on the next idea's detection
  // pass rather than needing its own queue. Cheap for a curated catalogue's size.
  if (vector) {
    const missing = await findExistingSolutionsMissingEmbedding(db);
    for (const m of missing) {
      const result = await deps.embeddingProvider.embed(`${m.name}\n${m.description}\n${m.categories.join(", ")}`);
      if (result.ok) await setExistingSolutionEmbedding(db, m.id, result.vector);
    }
  }

  // AI-11's non-AI fallback (SPEC §12.3): catalogue lookup by category, no model call.
  if (!vector) {
    const catalogueMatches = categoryKey
      ? await db.existingSolution.findMany({ where: { isActive: true, categories: { has: categoryKey } } })
      : [];
    await db.existingSolutionAssessment.create({
      data: {
        ideaVersionId,
        source: "FALLBACK",
        recommendation: null,
        rationale: null,
        confidence: null,
        matches: {
          create: catalogueMatches.map((m) => ({ existingSolutionId: m.id, similarity: 0 })),
        },
      },
    });
    return catalogueMatches.length;
  }

  const candidates = await findMatchingExistingSolutions(db, { vector, threshold, limit: topN });
  if (candidates.length === 0) {
    await db.existingSolutionAssessment.create({
      data: {
        ideaVersionId,
        source: "AI",
        recommendation: "BUILD",
        rationale: "No catalogue entry matched above the configured similarity threshold.",
        confidence: "HIGH",
      },
    });
    return 0;
  }

  const recommendation = await deps.detectionProvider.recommendExistingSolution(
    ideaInput,
    candidates.map((c) => ({ id: c.id, name: c.name, kind: c.kind, description: c.description, categories: c.categories })),
  );

  await db.existingSolutionAssessment.create({
    data: {
      ideaVersionId,
      source: recommendation.ok ? "AI" : "FALLBACK",
      recommendation: recommendation.ok ? recommendation.recommendation : null,
      rationale: recommendation.ok ? recommendation.rationale : null,
      confidence: recommendation.ok ? recommendation.confidence : null,
      matches: {
        create: candidates.map((c) => ({ existingSolutionId: c.id, similarity: c.similarity })),
      },
    },
  });

  return candidates.length;
}

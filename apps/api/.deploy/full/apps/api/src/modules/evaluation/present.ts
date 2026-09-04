import type { Prisma } from "@iep/db";
import type {
  CriterionScore, ExplanationItem, PeerComparison, RankingExplanation,
} from "@iep/contracts";

/**
 * Shaping evaluation rows into the contract's response types.
 *
 * Two things this file exists to guarantee:
 *
 *  - **Decimals become numbers exactly once.** Prisma returns `Decimal` for every score
 *    column; letting one reach JSON would serialise as a string and quietly break every
 *    client-side comparison.
 *  - **An explanation is never absent.** `RankingPosition.explanation` is required, so a
 *    ranking row without one is a data defect, and this raises rather than hides it.
 */

const num = (d: Prisma.Decimal | number): number => Number(d);

type ScoreRow = {
  rawBand: string | null;
  normalized: Prisma.Decimal;
  weight: Prisma.Decimal;
  contribution: Prisma.Decimal;
  source: string;
  confidence: string;
  rationale: string;
  evidence: string[];
  criterion: { key: string; label: string; group: string; direction: string };
  overrides: {
    reviewer: { id: string; displayName: string; department: { name: string } | null };
    previousNormalized: Prisma.Decimal;
    newNormalized: Prisma.Decimal;
    reason: string;
    createdAt: Date;
  }[];
};

export function presentCriterionScore(row: ScoreRow): CriterionScore {
  // The LATEST override is the one in force. Earlier ones are history, and they live in
  // the audit log rather than being replayed here.
  const override = row.overrides.at(-1);

  return {
    criterionKey: row.criterion.key,
    criterionLabel: row.criterion.label,
    group: row.criterion.group as CriterionScore["group"],
    direction: row.criterion.direction as CriterionScore["direction"],
    rawBand: row.rawBand as CriterionScore["rawBand"],
    normalized: num(row.normalized),
    weight: num(row.weight),
    contribution: num(row.contribution),
    source: row.source as CriterionScore["source"],
    confidence: row.confidence as CriterionScore["confidence"],
    rationale: row.rationale,
    // P-7: the contract requires at least one. If the row somehow has none, say that
    // rather than emitting an empty array a client would render as a blank panel.
    evidence: row.evidence.length > 0 ? row.evidence : ["no evidence recorded for this score"],
    override: override
      ? {
          reviewer: {
            id: override.reviewer.id,
            displayName: override.reviewer.displayName,
            departmentName: override.reviewer.department?.name ?? null,
          },
          previousNormalized: num(override.previousNormalized),
          newNormalized: num(override.newNormalized),
          reason: override.reason,
          at: override.createdAt.toISOString(),
        }
      : null,
  };
}

type ExplanationRow = {
  strengths: Prisma.JsonValue;
  constraints: Prisma.JsonValue;
  peerComparisons: Prisma.JsonValue;
  generatedBy: string;
} | null;

/**
 * The engine stores its explanation as JSON, so it comes back as `JsonValue` and has to
 * be narrowed. Peer titles are joined in by the caller — the engine deliberately does not
 * know them, because it must not read anything but the contribution vector (ADR-006).
 */
export function presentExplanation(
  row: ExplanationRow,
  titleByIdeaId: ReadonlyMap<string, string>,
  tieBreakNote: string | null,
): RankingExplanation {
  const items = (value: Prisma.JsonValue): ExplanationItem[] =>
    Array.isArray(value) ? (value as unknown as ExplanationItem[]) : [];

  const peers: PeerComparison[] = (Array.isArray(row?.peerComparisons)
    ? (row.peerComparisons as unknown as (Omit<PeerComparison, "peerTitle"> & { peerTitle?: string })[])
    : []
  ).map((p) => ({
    peerIdeaId: p.peerIdeaId,
    peerTitle: p.peerTitle ?? titleByIdeaId.get(p.peerIdeaId) ?? "Another idea",
    peerRank: p.peerRank,
    text: p.text,
    divergentCriteria: p.divergentCriteria ?? [],
  }));

  return {
    strengths: items(row?.strengths ?? []),
    constraints: items(row?.constraints ?? []),
    peerComparisons: peers,
    tieBreakNote,
    generatedBy: (row?.generatedBy ?? "ENGINE") as RankingExplanation["generatedBy"],
  };
}

/**
 * The tie-break note is reconstructed on read rather than stored.
 *
 * `tieBreakApplied` is a property of the RUN — who this idea was level with and what
 * separated them — and re-deriving it from the two neighbouring rows keeps it honest if
 * the board is ever re-paginated.
 */
export function tieBreakNoteFor(
  neighbours: readonly { rank: number; compositeScore: Prisma.Decimal }[],
  rank: number,
  composite: Prisma.Decimal,
): string | null {
  const tied = neighbours.some(
    (n) => n.rank !== rank && Math.abs(num(n.compositeScore) - num(composite)) < 0.001,
  );
  return tied
    ? "This idea scored level with at least one other. The order between them was decided " +
        "by feasibility, then maturity, then which was submitted first."
    : null;
}

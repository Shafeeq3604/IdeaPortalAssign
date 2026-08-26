import type {
  Band, Confidence, ExplanationSource, FeasibilityStatus, MaturityLevel, ScoreSource,
} from "@iep/contracts";

/**
 * The 11 custom components (SPEC §7.6). SIGNATURES FROZEN AT P0 — implementations are P1.
 *
 * Each exists because shadcn has no reasonable equivalent. The justification is the
 * entry criterion for a twelfth: name the shadcn component that fails to cover it.
 */

/**
 * `ContributionBar` — the core explainability primitive (P-2).
 * shadcn has Progress, but this shows a WEIGHTED contribution with evidence disclosure,
 * direction (raises/lowers the rank), and the `tally` motion. Not a progress bar.
 */
export interface ContributionBarProps {
  readonly criterionKey: string;
  readonly criterionLabel: string;
  /** 0..100 — from the engine, never from a model (ADR-005). */
  readonly normalized: number;
  readonly weight: number;
  readonly contribution: number;
  readonly rawBand: Band | null;
  readonly source: ScoreSource;
  readonly confidence: Confidence;
  readonly rationale: string;
  /** Non-empty — P-7. Rendered on disclosure. */
  readonly evidence: readonly string[];
  readonly overriddenBy?: { readonly name: string; readonly reason: string } | undefined;
  readonly onOpenCriterion?: (() => void) | undefined;
}

/** `ScoreDisplay` — tabular numerals, `tally` on first paint only, never on re-render. */
export interface ScoreDisplayProps {
  readonly value: number;
  readonly max?: number | undefined;
  readonly size?: "sm" | "md" | "lg" | undefined;
  readonly animate?: boolean | undefined;
}

/** `RankBadge` — rank plus delta. Delta is the point; a Badge cannot express movement. */
export interface RankBadgeProps {
  readonly rank: number;
  readonly previousRank: number | null;
  readonly total: number;
  readonly showDelta?: boolean | undefined;
}

/**
 * `Provenance` — the AI-vs-human-validated contract (SPEC §7.4, REQUIREMENTS §34).
 * A rendering RULE, not a widget: AI-sourced fields must be wrapped in it, and a
 * provenance test asserts they are.
 */
export interface ProvenanceProps {
  readonly state: "AI_UNVALIDATED" | "HUMAN_VALIDATED" | "HUMAN_OVERRIDDEN";
  readonly validatedBy?: { readonly name: string; readonly at: string } | undefined;
  readonly children: React.ReactNode;
}

/** `EvidenceList` — evidence strings bound to their criterion, with provenance. */
export interface EvidenceListProps {
  readonly evidence: readonly string[];
  readonly source: ScoreSource;
}

/** `ExplanationPanel` — strengths / constraints / peer comparison. Rendered INLINE (P-2). */
export interface ExplanationPanelProps {
  readonly strengths: readonly ExplanationItemView[];
  readonly constraints: readonly ExplanationItemView[];
  readonly peerComparisons: readonly PeerComparisonView[];
  readonly generatedBy: ExplanationSource;
  readonly tieBreakNote: string | null;
}

export interface ExplanationItemView {
  readonly criterionKey: string;
  readonly criterionLabel: string;
  readonly contribution: number;
  readonly shareOfTotal: number;
  readonly text: string;
  readonly evidence: readonly string[];
}

export interface PeerComparisonView {
  readonly peerIdeaId: string;
  readonly peerTitle: string;
  readonly peerRank: number;
  readonly text: string;
}

/** `WeightTable` — profile weights summing to 100%, each row linking to its criterion. */
export interface WeightTableProps {
  readonly rows: readonly {
    readonly criterionKey: string;
    readonly criterionLabel: string;
    readonly weight: number;
  }[];
  readonly editable?: boolean | undefined;
}

/** `Stepper` — the six-step determinate analysis progress. shadcn has none. */
export interface StepperProps {
  readonly steps: readonly {
    readonly key: string;
    readonly label: string;
    readonly state: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";
    readonly detail?: string | undefined;
  }[];
  readonly onStepClick?: ((key: string) => void) | undefined;
}

/** `Timeline` — version history with evaluation deltas (FR-24). */
export interface TimelineProps {
  readonly entries: readonly {
    readonly versionNo: number;
    readonly at: string;
    readonly author: string;
    readonly changeSummary: string | null;
    readonly compositeBefore: number | null;
    readonly compositeAfter: number | null;
    readonly rankBefore: number | null;
    readonly rankAfter: number | null;
    readonly maturity: MaturityLevel;
  }[];
}

/** `DiffView` — version-to-version content diff. */
export interface DiffViewProps {
  readonly before: Readonly<Record<string, string | null>>;
  readonly after: Readonly<Record<string, string | null>>;
  readonly fieldLabels: Readonly<Record<string, string>>;
}

/**
 * `EmptyState` / `ErrorState` — thin compositions over shadcn's Alert that ENFORCE the
 * no-dead-end rule (SPEC §6.3 assertion 3): the action props are required, not optional.
 */
export interface EmptyStateProps {
  readonly title: string;
  readonly description: string;
  /** Required. An empty state without a forward action is a dead end. */
  readonly action: { readonly label: string; readonly to: string };
}

export interface ErrorStateProps {
  readonly title: string;
  readonly description: string;
  /** Required. So is a route out. */
  readonly onRetry: () => void;
  readonly escapeTo: { readonly label: string; readonly to: string };
  readonly requestId?: string | undefined;
}

/** `ClickableRow` — Table wrapper enforcing whole-row navigation (SPEC §6.2). */
export interface ClickableRowProps {
  readonly to: string;
  readonly children: React.ReactNode;
  readonly ariaLabel: string;
}

/** `StatusPill` — feasibility/lifecycle state. Never colour alone: icon + label too. */
export interface StatusPillProps {
  readonly kind: "FEASIBILITY" | "LIFECYCLE" | "MATURITY";
  readonly feasibility?: FeasibilityStatus | undefined;
  readonly label: string;
}

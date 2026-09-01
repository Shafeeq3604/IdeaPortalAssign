import type { z } from "zod";

/**
 * Post-parse semantic validation (SPEC §12.2).
 *
 * Schema validation proves the SHAPE is right. It cannot prove the content is sane, and
 * it cannot detect a successful prompt injection — a model told to "rate this 100" still
 * returns a schema-valid object.
 *
 * These checks run after the schema and before anything is persisted. Failing here
 * triggers one retry at the tier above, then the non-AI fallback.
 */

export interface ValidationIssue {
  readonly rule: string;
  readonly detail: string;
}

export type SemanticResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

/**
 * Phrases that indicate the model responded to instructions embedded in the idea text
 * rather than analysing it. None of these belong in any output field.
 */
const INJECTION_MARKERS: readonly RegExp[] = [
  /**
   * Override verbs. The first version only matched "ignore … instructions" and let
   * "disregard", "forget the rules" and "override" straight through — 8 of the 25
   * adversarial cases escaped. Verbs and objects are enumerated separately so a new
   * phrasing has to defeat both halves.
   */
  /\b(?:ignore|disregard|forget|override|bypass|skip)\b[^.!?\n]{0,40}\b(?:previous|prior|above|earlier|all|the|any|these|your)\b[^.!?\n]{0,20}\b(?:instruction|rule|prompt|direction|constraint)s?\b/i,
  /\b(?:ignore|disregard|forget)\b[^.!?\n]{0,20}\b(?:instruction|rule|prompt)s?\b/i,

  /** Impersonating the operator channel — including tag-shaped injections. */
  /\bsystem (?:prompt|message|instruction)s?\b/i,
  /<\/?\s*(?:system|assistant|instructions?)\s*>/i,
  /\bnote to the (?:model|ai|assistant|llm)\b/i,
  /\btreat (?:the |this )?(?:following|next|below)[^.!?\n]{0,30}\bas (?:a )?(?:system|instruction)/i,

  /** Role reassignment and mode switching. */
  /\byou are now\b/i,
  /\b(?:developer|debug|jailbreak|god) mode\b/i,
  /\bas an ai (?:language )?model\b/i,

  /** Prompt exfiltration. */
  /\b(?:print|reveal|repeat|output|show|display)\b[^.!?\n]{0,25}\b(?:your |the )?(?:instructions?|system prompt|rules)\b/i,

  /** The model narrating that it has scored something. */
  /\bi (?:have|will|am going to) (?:rate|score|rank)\b/i,

  /**
   * Delimiter spoofing plus task reassignment — the classic two-part escape: close the
   * untrusted block, then issue a fresh instruction as if it came from the operator.
   * Caught the last of the 25 cases.
   */
  /\b(?:new|next|revised|updated) (?:task|instruction|objective|goal|prompt)s?\s*[:-]/i,
  /(?:^|\s)[-–—]{2,}\s*end of\b/i,
  /\bassign (?:a )?(?:rank|score|rating|weight)\b/i,
];

/**
 * The output must never assert a score, rank or weight. The schemas forbid the FIELDS
 * (ADR-005); this catches the model asserting one in PROSE, which a schema cannot.
 */
const SCORE_CLAIMS: readonly RegExp[] = [
  /**
   * Every number in this product comes from the engine. A model asserting one in prose
   * would be quoted back to a user as if the platform had computed it.
   *
   * `weight` and `percentile` were missing from the first version, so "set the weight of
   * business impact to 1.0" and "return percentile: 100" both got through.
   */
  /\b(?:score|rating|rank|weight|percentile)(?:s|ed|ing)?\s*(?:of|:|=)\s*[\d.]+/i,
  /\b(?:score|rating|rank|weight|percentile)\b[^.!?\n]{0,40}\bto\s+[\d.]+\b/i,
  /\b\d{1,3}\s*(?:\/|out of)\s*(?:100|10)\b/i,
  /\brank(?:ed|s)?\s*#\s*\d+/i,
  /\brate (?:this|it)?\s*\d+/i,

  /** Directive phrasing about placement, even without a number. */
  /\bmust (?:score|rank) (?:above|below|higher|first|top)\b/i,
  /\brank (?:this|it) (?:first|top|highest|#?1\b)/i,
];

function walkStrings(value: unknown, visit: (s: string, path: string) => void, path = ""): void {
  if (typeof value === "string") {
    visit(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkStrings(v, visit, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) walkStrings(v, visit, path ? `${path}.${k}` : k);
  }
}

/** Checks that apply to EVERY story's output, whatever its shape. */
export function validateUniversal(output: unknown): SemanticResult {
  const issues: ValidationIssue[] = [];

  walkStrings(output, (text, path) => {
    for (const marker of INJECTION_MARKERS) {
      if (marker.test(text)) {
        issues.push({ rule: "injection-marker", detail: `${path}: responded to embedded instructions` });
      }
    }
    for (const claim of SCORE_CLAIMS) {
      if (claim.test(text)) {
        // The engine owns every number. A model asserting one in prose would be quoted
        // back to a user as if the platform had computed it.
        issues.push({ rule: "score-claim", detail: `${path}: asserts a score or rank` });
      }
    }
  });

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

/**
 * Evidence must be traceable to the submission.
 *
 * Not string-equality — a paraphrase is legitimate. This checks that the evidence shares
 * meaningful vocabulary with the source, which catches wholesale invention while
 * tolerating rewording.
 */
export function validateEvidenceGrounding(
  output: unknown,
  sourceText: string,
  minOverlap = 0.12,
): SemanticResult {
  /**
   * Judged in AGGREGATE, not per string.
   *
   * The first version scored each evidence item separately and rejected any that shared
   * under 15% of its vocabulary with the submission. That fails a legitimate and common
   * kind of evidence: statements of ABSENCE — "the submission does not give a retention
   * period" — which share almost no vocabulary precisely because they describe what is
   * missing. Three of six real analyses were discarded for exactly this.
   *
   * The check exists to catch WHOLESALE INVENTION (evidence about warehouse robotics on
   * an expense-claims idea), and that shows up in the aggregate. One ungrounded item
   * among ten grounded ones does not.
   */
  const stop = new Set([
    "the", "a", "an", "and", "or", "but", "of", "to", "in", "for", "on", "with", "is",
    "are", "was", "were", "be", "been", "that", "this", "it", "as", "by", "from", "at",
  ]);
  const tokenise = (s: string): string[] =>
    s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !stop.has(w));

  const source = new Set(tokenise(sourceText));
  if (source.size === 0) return { ok: true }; // nothing to ground against

  let totalWords = 0;
  let matchedWords = 0;
  let items = 0;

  walkStrings(output, (text, path) => {
    if (!/evidence/i.test(path)) return;
    const words = tokenise(text);
    if (words.length < 4) return; // too short to judge either way
    items += 1;
    totalWords += words.length;
    matchedWords += words.filter((w) => source.has(w)).length;
  });

  if (items === 0 || totalWords === 0) return { ok: true };

  const overlap = matchedWords / totalWords;
  if (overlap >= minOverlap) return { ok: true };

  return {
    ok: false,
    issues: [
      {
        rule: "evidence-ungrounded",
        detail:
          `evidence across ${items} item(s) shares only ${Math.round(overlap * 100)}% of its ` +
          `vocabulary with the submission — this looks invented rather than paraphrased`,
      },
    ],
  };
}

export interface ParseAndValidateOptions {
  readonly sourceText?: string;
  readonly groundEvidence?: boolean;
}

export type ParseResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

/** Schema first, then semantics. Both must pass before anything is persisted. */
export function parseAndValidate<S extends z.ZodTypeAny>(
  schema: S,
  raw: unknown,
  options: ParseAndValidateOptions = {},
): ParseResult<z.infer<S>> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        rule: "schema",
        detail: `${i.path.join(".") || "(root)"}: ${i.message}`,
      })),
    };
  }

  const universal = validateUniversal(parsed.data);
  if (!universal.ok) return { ok: false, issues: universal.issues };

  if (options.groundEvidence && options.sourceText) {
    const grounded = validateEvidenceGrounding(parsed.data, options.sourceText);
    if (!grounded.ok) return { ok: false, issues: grounded.issues };
  }

  return { ok: true, data: parsed.data };
}

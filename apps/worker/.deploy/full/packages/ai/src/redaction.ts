/**
 * PII redaction before anything leaves the network (SPEC §4.5, A3).
 *
 * The approval covers idea CONTENT. It does not cover employee identity, so names,
 * emails, phone numbers and identifiers are stripped from free text first, and
 * `redactionApplied` is recorded on the analysis.
 *
 * Pure and synchronous on purpose: it is easy to test exhaustively, and there is no
 * async path where a caller could accidentally send the unredacted original.
 */

export interface RedactionResult {
  readonly text: string;
  readonly applied: boolean;
  /** Counts by kind — logged as telemetry, never the matched values themselves. */
  readonly counts: Readonly<Record<RedactionKind, number>>;
}

export type RedactionKind = "email" | "phone" | "employeeId" | "nationalId" | "url" | "iban";

interface Rule {
  readonly kind: RedactionKind;
  readonly pattern: RegExp;
  readonly placeholder: string;
}

/**
 * Ordered: the more specific patterns run first, so an employee id inside a URL is not
 * half-redacted by the URL rule.
 */
const RULES: readonly Rule[] = [
  { kind: "email", pattern: /\b[\w.%+-]+@[\w.-]+\.[a-z]{2,}\b/gi, placeholder: "[email]" },
  {
    kind: "iban",
    pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}\b/g,
    placeholder: "[account]",
  },
  {
    // UK NI, US SSN and similar dashed identifiers.
    kind: "nationalId",
    pattern: /\b(?:[A-Z]{2}[ ]?\d{2}[ ]?\d{2}[ ]?\d{2}[ ]?[A-D]|\d{3}-\d{2}-\d{4})\b/g,
    placeholder: "[national-id]",
  },
  {
    kind: "employeeId",
    pattern: /\b(?:emp|employee|staff|badge)[-_ ]?(?:id[-_ ]?)?\d{3,}\b/gi,
    placeholder: "[employee-id]",
  },
  {
    // Deliberately conservative: 9+ digits with common separators, not any long number,
    // so "processes 40000 claims" survives. Under-redacting a metric is better than
    // mangling the idea; over-redacting numbers would destroy the analysis input.
    kind: "phone",
    pattern: /(?:(?:\+\d{1,3}[ -]?)?(?:\(\d{2,4}\)[ -]?)?\d{3,4}[ -]\d{3,4}[ -]?\d{0,4})(?=\D|$)/g,
    placeholder: "[phone]",
  },
  { kind: "url", pattern: /\bhttps?:\/\/\S+/gi, placeholder: "[link]" },
];

const EMPTY_COUNTS: Readonly<Record<RedactionKind, number>> = {
  email: 0, phone: 0, employeeId: 0, nationalId: 0, url: 0, iban: 0,
};

export function redact(input: string, enabled = true): RedactionResult {
  if (!enabled || input.length === 0) {
    return { text: input, applied: false, counts: EMPTY_COUNTS };
  }

  const counts: Record<RedactionKind, number> = { ...EMPTY_COUNTS };
  let text = input;

  for (const rule of RULES) {
    text = text.replace(rule.pattern, () => {
      counts[rule.kind] += 1;
      return rule.placeholder;
    });
  }

  const applied = Object.values(counts).some((n) => n > 0);
  return { text, applied, counts };
}

/** Redact every string field of a submission, leaving structure intact. */
export function redactFields<T extends Readonly<Record<string, string | null>>>(
  fields: T,
  enabled = true,
): { fields: T; applied: boolean } {
  let applied = false;
  const out: Record<string, string | null> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== "string") {
      out[key] = value;
      continue;
    }
    const result = redact(value, enabled);
    out[key] = result.text;
    applied ||= result.applied;
  }
  return { fields: out as T, applied };
}

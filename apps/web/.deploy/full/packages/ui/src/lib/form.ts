import type { FieldValues, UseFormSetError, Path } from "react-hook-form";
import type { ErrorResponse, FieldIssue } from "@iep/contracts";

/**
 * Server-error → form-field binding (ADR-016, SPEC §7.8).
 *
 * The API returns 400 with field PATHS (`issues[].path`), and both sides validate with the
 * same Zod schema — so a server rejection can land on the exact input that caused it
 * instead of in a toast the user has to interpret.
 *
 * Without this, client and server validation drift in the way users actually feel: the
 * form says fine, the server says no, and nobody can see which field is wrong.
 */

/** `["idea", "title"]` → `"idea.title"`, the path shape react-hook-form expects. */
export function issuePathToFieldName(path: FieldIssue["path"]): string {
  return path.map(String).join(".");
}

export interface ApplyServerErrorsResult {
  /** Issues that matched a form field and were attached to it. */
  readonly applied: readonly string[];
  /**
   * Issues with no matching field — show these at form level. Never drop them silently;
   * an unattached error the user cannot see is worse than no validation at all.
   */
  readonly unmatched: readonly FieldIssue[];
}

export function applyServerErrors<T extends FieldValues>(
  error: ErrorResponse,
  setError: UseFormSetError<T>,
  knownFields: readonly string[],
): ApplyServerErrorsResult {
  const applied: string[] = [];
  const unmatched: FieldIssue[] = [];

  for (const issue of error.issues ?? []) {
    const name = issuePathToFieldName(issue.path);
    if (name && knownFields.includes(name)) {
      setError(name as Path<T>, { type: "server", message: issue.message });
      applied.push(name);
    } else {
      unmatched.push(issue);
    }
  }

  return { applied, unmatched };
}

/** Codes that mean "the submitted values are wrong", as opposed to auth or server faults. */
export function isFieldLevelError(error: ErrorResponse): boolean {
  return (
    error.code === "VALIDATION_FAILED" ||
    error.code === "REASON_REQUIRED" ||
    error.code === "EVIDENCE_REQUIRED" ||
    error.code === "RECOMMENDATION_INCOMPLETE"
  );
}

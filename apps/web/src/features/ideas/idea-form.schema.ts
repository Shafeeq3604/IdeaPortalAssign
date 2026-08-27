import { z } from "zod";

/**
 * The idea form's validation shape (FR-02, ADR-016).
 *
 * Its own module because it is imported by pages that never render the form, and
 * because a component file that also exports a value breaks Fast Refresh.
 */

const Required = z.string().trim().min(1, "This is needed");

export const IdeaFormSchema = z.object({
  title: Required.max(200, "Keep the title under 200 characters"),
  description: Required.max(20_000),
  problemStatement: Required.max(2_000),
  expectedUsers: Required.max(2_000),
  expectedOutcome: Required.max(2_000),
  existingProcess: z.string().trim().max(2_000).optional(),
  existingSolutions: z.string().trim().max(2_000).optional(),
  suggestedTechnology: z.string().trim().max(2_000).optional(),
  expectedBenefits: z.string().trim().max(2_000).optional(),
  estimatedCostNote: z.string().trim().max(2_000).optional(),
  references: z.string().trim().max(2_000).optional(),
  /** Present only when revising. Required from v2 onward (FR-24). */
  changeSummary: z.string().trim().max(2_000).optional(),
});

export type IdeaFormValues = z.infer<typeof IdeaFormSchema>;

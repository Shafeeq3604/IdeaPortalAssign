import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Button, Input, Label, Textarea, applyServerErrors, isFieldLevelError,
} from "@iep/ui";
import { ApiError } from "../../app/api-client";

/**
 * The idea form (FR-02) — shared by submission and revision.
 *
 * Validated with the SAME Zod shape the API uses, so the two cannot disagree about what
 * is valid (ADR-016). A server 400 is mapped back onto the exact field that caused it
 * rather than shown as a toast the user has to interpret.
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

const FIELD_NAMES = Object.keys(IdeaFormSchema.shape);

interface Field {
  readonly name: keyof IdeaFormValues;
  readonly label: string;
  readonly help: string;
  readonly long?: boolean;
}

/** The six required fields of FR-02, in the order a person would think about them. */
const REQUIRED_FIELDS: readonly Field[] = [
  { name: "title", label: "Title", help: "One line. What would you call this?" },
  { name: "problemStatement", label: "The problem", help: "What goes wrong today, and for whom?", long: true },
  { name: "description", label: "Your idea", help: "Describe it in your own words — no technical detail needed.", long: true },
  { name: "expectedUsers", label: "Who would use it", help: "Which people or teams would benefit?", long: true },
  { name: "expectedOutcome", label: "What would change", help: "If this worked, what would be different?", long: true },
];

/**
 * Optional fields are genuinely optional: leaving them blank lowers the maturity level
 * and produces "missing information" guidance — it never blocks submission (FR-02).
 */
const OPTIONAL_FIELDS: readonly Field[] = [
  { name: "existingProcess", label: "How it's done today", help: "The current workaround, if there is one.", long: true },
  { name: "existingSolutions", label: "Existing tools", help: "Anything that already does part of this.", long: true },
  { name: "suggestedTechnology", label: "Suggested approach", help: "Only if you have one in mind.", long: true },
  { name: "expectedBenefits", label: "Expected benefits", help: "Time saved, cost avoided, fewer errors.", long: true },
  { name: "estimatedCostNote", label: "Cost thoughts", help: "Any sense of what it might take.", long: true },
  { name: "references", label: "References", help: "Links or documents that support this.", long: true },
];

interface Props {
  readonly defaultValues?: Partial<IdeaFormValues>;
  readonly requireChangeSummary?: boolean;
  readonly submitLabel: string;
  readonly onSubmit: (values: IdeaFormValues, asDraft: boolean) => Promise<void>;
  readonly serverError?: unknown;
  readonly busy?: boolean;
}

export function IdeaForm({
  defaultValues, requireChangeSummary = false, submitLabel, onSubmit, serverError, busy,
}: Props) {
  const schema = requireChangeSummary
    ? IdeaFormSchema.extend({
        changeSummary: z.string().trim().min(1, "Say what you changed and why"),
      })
    : IdeaFormSchema;

  const form = useForm<IdeaFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: "", description: "", problemStatement: "", expectedUsers: "", expectedOutcome: "", ...defaultValues },
    mode: "onBlur",
  });

  // Server rejections land on the field that caused them (SPEC §7.8).
  if (serverError instanceof ApiError && isFieldLevelError(serverError.body)) {
    applyServerErrors(serverError.body, form.setError, FIELD_NAMES);
  }

  const renderField = (f: Field) => {
    const error = form.formState.errors[f.name];
    const id = `field-${f.name}`;
    return (
      <div key={f.name} className="space-y-2">
        <Label htmlFor={id}>{f.label}</Label>
        <p className="text-200 text-muted-foreground">{f.help}</p>
        {f.long ? (
          <Textarea id={id} rows={4} aria-invalid={Boolean(error)} {...form.register(f.name)} />
        ) : (
          <Input id={id} aria-invalid={Boolean(error)} {...form.register(f.name)} />
        )}
        {error ? (
          <p role="alert" className="text-200 text-destructive">{error.message}</p>
        ) : null}
      </div>
    );
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit((values) => onSubmit(values, false))(e);
      }}
      className="space-y-8"
    >
      {requireChangeSummary ? (
        <section className="space-y-2 rounded-lg border border-border bg-card p-6 shadow-e1">
          <Label htmlFor="field-changeSummary">What did you change?</Label>
          <p className="text-200 text-muted-foreground">
            This is shown on the history timeline so the change is traceable.
          </p>
          <Textarea id="field-changeSummary" rows={3} {...form.register("changeSummary")} />
          {form.formState.errors.changeSummary ? (
            <p role="alert" className="text-200 text-destructive">
              {form.formState.errors.changeSummary.message}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-6">{REQUIRED_FIELDS.map(renderField)}</section>

      <section className="space-y-6 rounded-lg border border-border bg-card p-6">
        <div>
          <h2 className="text-400 font-semibold">Anything else? (all optional)</h2>
          <p className="text-200 text-muted-foreground">
            Leaving these blank is fine — it never blocks submission. Filling them in
            gives the analysis more to work with.
          </p>
        </div>
        {OPTIONAL_FIELDS.map(renderField)}
      </section>

      {serverError instanceof ApiError && !isFieldLevelError(serverError.body) ? (
        <p role="alert" className="text-200 text-destructive">{serverError.body.message}</p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : submitLabel}</Button>
        {!requireChangeSummary ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void form.handleSubmit((v) => onSubmit(v, true))()}
          >
            Save as draft
          </Button>
        ) : null}
      </div>
    </form>
  );
}

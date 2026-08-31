import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button, Input, Label, Textarea, applyServerErrors, isFieldLevelError,
} from "@iep/ui";
import { ApiError } from "../../app/api-client";
import { IdeaFormSchema, type IdeaFormValues } from "./idea-form.schema";

/**
 * The idea form (FR-02) — shared by submission and revision.
 *
 * Validated with the SAME Zod shape the API uses, so the two cannot disagree about what
 * is valid (ADR-016). A server 400 is mapped back onto the exact field that caused it
 * rather than shown as a toast the user has to interpret.
 */

export type { IdeaFormValues };

const FIELD_NAMES = Object.keys(IdeaFormSchema.shape);

interface Field {
  readonly name: keyof IdeaFormValues;
  readonly label: string;
  readonly help: string;
  readonly long?: boolean;
}

/**
 * The required fields of FR-02, grouped into the three questions a person is actually
 * answering.
 *
 * The fields and their order are unchanged — this is presentation. A single column of
 * five identical textareas reads as a form to be endured; three short sections with a
 * heading each read as three questions, and someone can stop after one and come back.
 * The step numbers are the point: they say how much is left.
 */
const REQUIRED_SECTIONS: readonly {
  readonly step: number;
  readonly title: string;
  readonly blurb: string;
  readonly fields: readonly Field[];
}[] = [
  {
    step: 1,
    title: "What is it?",
    blurb: "A name and the problem behind it. This is the part people read first.",
    fields: [
      { name: "title", label: "Title", help: "One line. What would you call this?" },
      { name: "problemStatement", label: "The problem", help: "What goes wrong today, and for whom?", long: true },
    ],
  },
  {
    step: 2,
    title: "What would you do?",
    blurb: "In your own words. No technical detail is needed and none is expected.",
    fields: [
      { name: "description", label: "Your idea", help: "Describe it in your own words — no technical detail needed.", long: true },
    ],
  },
  {
    step: 3,
    title: "Who does it help?",
    blurb: "Who feels the difference, and what that difference looks like.",
    fields: [
      { name: "expectedUsers", label: "Who would use it", help: "Which people or teams would benefit?", long: true },
      { name: "expectedOutcome", label: "What would change", help: "If this worked, what would be different?", long: true },
    ],
  },
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

  /**
   * One ring, defined once. An invalid field turns its ring red rather than only its
   * message — the message can be below the fold on a long form, the border cannot.
   */
  const CONTROL =
    "rounded-lg transition-[box-shadow,border-color] duration-[var(--dur-fast)] " +
    "focus-visible:ring-2 focus-visible:ring-ring/40 " +
    "aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-2 " +
    "aria-[invalid=true]:ring-destructive/25";

  const renderField = (f: Field) => {
    const error = form.formState.errors[f.name];
    const id = `field-${f.name}`;
    return (
      <div key={f.name} className="space-y-2">
        <Label htmlFor={id}>{f.label}</Label>
        <p className="text-200 text-muted-foreground">{f.help}</p>
        {f.long ? (
          <Textarea id={id} rows={4} aria-invalid={Boolean(error)} className={CONTROL} {...form.register(f.name)} />
        ) : (
          <Input id={id} aria-invalid={Boolean(error)} className={CONTROL} {...form.register(f.name)} />
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

      {REQUIRED_SECTIONS.map((section) => (
        <section
          key={section.step}
          className="space-y-6 rounded-xl border border-border bg-card p-6 shadow-e1"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-200 font-semibold text-accent-foreground"
            >
              {section.step}
            </span>
            <div>
              <h2 className="text-400 font-semibold">{section.title}</h2>
              <p className="text-200 text-muted-foreground">{section.blurb}</p>
            </div>
          </div>
          {section.fields.map(renderField)}
        </section>
      ))}

      <section className="space-y-6 rounded-xl border border-dashed border-border bg-card p-6">
        <div className="flex items-start gap-3">
          {/*
            Dashed, and numbered with a dash rather than a 4. Optional means optional:
            the section should not look like a step somebody has failed to complete.
          */}
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-200 font-semibold text-muted-foreground"
          >
            +
          </span>
          <div>
            <h2 className="text-400 font-semibold">Anything else? (all optional)</h2>
            <p className="text-200 text-muted-foreground">
              Leaving these blank is fine — it never blocks submission. Filling them in
              gives the analysis more to work with, and raises the maturity level.
            </p>
          </div>
        </div>
        {OPTIONAL_FIELDS.map(renderField)}
      </section>

      {serverError instanceof ApiError && !isFieldLevelError(serverError.body) ? (
        <p role="alert" className="text-200 text-destructive">{serverError.body.message}</p>
      ) : null}

      {/*
        SPEC §4.5: the notice is linked from the submission form, because this is the
        moment someone decides how much detail to write.
      */}
      <p className="text-100 text-muted-foreground">
        Your idea text is analysed by an AI service; your name and email are not sent with
        it, and no AI decides anything.{" "}
        <a href="/help/data-and-ai">How your idea is handled</a>
      </p>

      {/*
        The actions stick to the bottom of the viewport, and they are the LAST thing in
        the form.

        Both halves matter. Sticky, because this form is six textareas long and a submit
        button that scrolls out of sight is a form people abandon halfway. Last, because
        a sticky element with content after it hangs over that content — the first version
        of this sat on top of section three's heading, which is worse than not sticking
        at all.
      */}
      <div className="sticky bottom-0 -mx-6 flex flex-wrap gap-3 border-t border-border bg-background/90 px-6 py-4 backdrop-blur">
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

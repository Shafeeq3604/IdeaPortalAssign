import * as React from "react";
import type { ReactNode } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check } from "lucide-react";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
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
  /** Shown as placeholder text — a worked example, not a default value, so it disappears
   *  the moment someone starts typing rather than needing to be cleared. */
  readonly example?: string;
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
    title: "The idea",
    blurb: "A name and the problem behind it. This is the part people read first.",
    fields: [
      {
        name: "title", label: "Title", help: "What would you call this?",
        example: "e.g. Automated expense approval reminders",
      },
      {
        name: "problemStatement", label: "The problem",
        help: "What's frustrating, inefficient, expensive, or difficult today?", long: true,
        example: "e.g. Expense approvals need manual email follow-ups and often take several days.",
      },
    ],
  },
  {
    step: 2,
    title: "Your solution",
    blurb: "In your own words. No technical detail is needed and none is expected.",
    fields: [
      {
        name: "description", label: "Your idea",
        help: "If you could change one thing, what would you do?", long: true,
        example: "e.g. Create automated approval reminders and escalation workflows.",
      },
    ],
  },
  {
    step: 3,
    title: "Impact",
    blurb: "Who feels the difference, and what that difference looks like.",
    fields: [
      {
        name: "expectedUsers", label: "Who would use it", help: "Who benefits if this succeeds?", long: true,
        example: "e.g. Finance approvers, and anyone submitting an expense report.",
      },
      {
        name: "expectedOutcome", label: "What would change",
        help: "If this worked, what would be different?", long: true,
        example: "e.g. Approvals clear in a day instead of a week, with no manual chasing.",
      },
    ],
  },
];

/**
 * Optional fields are genuinely optional: leaving them blank lowers the maturity level
 * and produces "missing information" guidance — it never blocks submission (FR-02).
 */
const OPTIONAL_FIELDS: readonly Field[] = [
  {
    name: "existingProcess", label: "How it's done today", help: "The current workaround, if there is one.", long: true,
    example: "e.g. Reports sit in a shared inbox and get chased manually.",
  },
  {
    name: "existingSolutions", label: "Existing tools", help: "Anything that already does part of this.", long: true,
    example: "e.g. Nothing that we use today.",
  },
  {
    name: "suggestedTechnology", label: "Suggested approach", help: "Only if you have one in mind.", long: true,
    example: "e.g. Could reuse the notification service we already have.",
  },
  {
    name: "expectedBenefits", label: "Expected benefits", help: "Time saved, cost avoided, fewer errors.", long: true,
    example: "e.g. Fewer late approvals and less time spent chasing them down.",
  },
  {
    name: "estimatedCostNote", label: "Cost thoughts", help: "Any sense of what it might take.", long: true,
    example: "e.g. Mostly engineering time — no new licensing that I know of.",
  },
  // No "references" input: a free-text field for "links or documents" sat right next to
  // real file Attachments and just duplicated it in a more confusing form. The `references`
  // column and its contract field are untouched — an idea submitted before this change
  // still shows whatever it has (OverviewTab.tsx, VersionPage.tsx); nothing new can be
  // written to it from here.
];

interface Props {
  readonly defaultValues?: Partial<IdeaFormValues>;
  readonly requireChangeSummary?: boolean;
  readonly submitLabel: string;
  readonly onSubmit: (values: IdeaFormValues, asDraft: boolean) => Promise<void>;
  readonly serverError?: unknown;
  readonly busy?: boolean;
  /** Rendered after the optional fields (References is last) and before the AI notice. */
  readonly extra?: ReactNode;
  /**
   * One question at a time instead of the whole form at once (design-review finding:
   * five textareas on arrival reads as a compliance form, not a place to jot an idea).
   * Off by default — revision already shows an idea's own answers, and hiding fields
   * someone has already written would read as the page losing their work, not helping
   * them focus.
   */
  readonly wizard?: boolean;
}

/** The one review/optional step tacked on after the three required ones. */
const REVIEW_STEP_TITLE = "Additional information";

export function IdeaForm({
  defaultValues, requireChangeSummary = false, submitLabel, onSubmit, serverError, busy, extra,
  wizard = false,
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

  /**
   * "How much is left" as a running count, not just the three numbered chips a person has
   * to scroll past all of to add up themselves. A section counts as answered once every
   * field in it has real text — matches what the submit button itself will accept, not a
   * softer "started typing" bar that could say "done" on something that still fails
   * validation on submit.
   */
  const values = form.watch();
  const isAnswered = (section: (typeof REQUIRED_SECTIONS)[number]): boolean =>
    section.fields.every((f) => (values[f.name] ?? "").trim().length > 0);
  const answeredCount = REQUIRED_SECTIONS.filter(isAnswered).length;

  // Server rejections land on the field that caused them (SPEC §7.8).
  if (serverError instanceof ApiError && isFieldLevelError(serverError.body)) {
    applyServerErrors(serverError.body, form.setError, FIELD_NAMES);
  }

  /**
   * Wizard navigation. `step` only matters when `wizard` is true — 0..2 are the required
   * sections, `REQUIRED_SECTIONS.length` is the final "additional information + submit"
   * screen. Advancing validates only the fields on the step someone is leaving: the whole
   * point of one-question-at-a-time is that an error two steps away doesn't block the one
   * in front of you.
   */
  const [step, setStep] = React.useState(0);
  const totalSteps = REQUIRED_SECTIONS.length + 1;
  const goBack = () => setStep((s) => Math.max(0, s - 1));
  const goNext = async () => {
    // `step` never leaves [0, REQUIRED_SECTIONS.length] by construction (goBack/goNext
    // are the only writers, and this branch never renders once wizard reaches the final
    // review step) — the guard exists only so the array access is provably safe, not
    // because this is expected to run.
    const section = REQUIRED_SECTIONS[step];
    if (!section) return;
    const ok = await form.trigger(section.fields.map((f) => f.name));
    if (ok) setStep((s) => s + 1);
  };
  // If a hidden earlier step is actually invalid (a stale server error, a field cleared
  // out from under the form), jump back to it instead of failing to submit with no
  // visible reason why — every field on this schema lives in one of these steps.
  const onInvalid = (errors: FieldErrors<IdeaFormValues>) => {
    if (!wizard) return;
    const badStep = REQUIRED_SECTIONS.findIndex((s) => s.fields.some((f) => errors[f.name]));
    if (badStep !== -1) setStep(badStep);
  };

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
          <Textarea
            id={id} rows={4} placeholder={f.example} aria-invalid={Boolean(error)}
            className={CONTROL} {...form.register(f.name)}
          />
        ) : (
          <Input
            id={id} placeholder={f.example} aria-invalid={Boolean(error)}
            className={CONTROL} {...form.register(f.name)}
          />
        )}
        {error ? (
          <p role="alert" className="text-200 text-destructive">{error.message}</p>
        ) : null}
      </div>
    );
  };

  const onFinalStep = !wizard || step === REQUIRED_SECTIONS.length;
  const showSection = (index: number) => !wizard || step === index;

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit((values) => onSubmit(values, false), onInvalid)(e);
      }}
      className="space-y-8"
    >
      {requireChangeSummary ? (
        <section className="space-y-2 rounded-2xl bg-card p-6 shadow-e2 ring-1 ring-inset ring-border">
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

      {wizard ? (
        /*
         * Design-review finding: five textareas visible on arrival read as a compliance
         * form, not a place to jot an idea down. One question at a time instead, with this
         * bar answering "how much is left" up front rather than only in the footer dots —
         * a segment per step (three required + the optional/submit screen), not a
         * percentage bar, since four fixed steps are what this actually is.
         */
        <div className="space-y-2">
          {/*
            Three states, not two (dark-mode final-polish pass, item 9): a completed step
            and the current one used to draw identically, so the bar could only ever say
            "how far in" rather than "which one am I actually on" — someone had to read
            the text line below to tell the two apart. Completed is now the calm, filled
            accent it always was; the current step gets the brighter, more saturated
            accent-500 so it visibly reads as "here," not "also done"; upcoming stays the
            plain border.
          */}
          <div className="flex items-center gap-1.5" aria-hidden>
            {Array.from({ length: totalSteps }, (_, i) => (
              <span
                key={i}
                className={`h-1.5 flex-1 rounded-full transition-colors duration-[var(--dur-base)] ${
                  i < step ? "bg-accent-600" : i === step ? "bg-accent-500" : "bg-border"
                }`}
              />
            ))}
          </div>
          <p className="text-100 text-muted-foreground">
            Step {step + 1} of {totalSteps} ·{" "}
            {REQUIRED_SECTIONS[step]?.title ?? REVIEW_STEP_TITLE}
          </p>
        </div>
      ) : null}

      {REQUIRED_SECTIONS.map((section, index) => {
        if (!showSection(index)) return null;
        /*
         * Design-audit finding: this card carried no visible sign of its own progress
         * beyond the dots at the very bottom of the form, a scroll away — `isAnswered`
         * was already computed for that footer and nothing else read it. A section that
         * is genuinely done now says so where someone is actually looking, the same
         * checkmark-on-done language the Analysis progress checklist already uses
         * elsewhere in this product, rather than a new visual idiom invented for one form.
         */
        const done = isAnswered(section);
        return (
          <section
            key={section.step}
            className={`space-y-6 rounded-2xl bg-card p-6 shadow-e2 ring-1 ring-inset transition-shadow duration-[var(--dur-base)] focus-within:shadow-e3 ${done ? "ring-factor-up/30" : "ring-border"}`}
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className={`grid size-8 shrink-0 place-items-center rounded-lg text-200 font-semibold shadow-e1 ${
                  done
                    ? "bg-factor-up-bg text-factor-up"
                    : "bg-gradient-to-br from-accent-600 to-grad-to text-primary-foreground"
                }`}
              >
                {done ? <Check aria-hidden className="size-4" /> : section.step}
              </span>
              <div>
                <h2 className="text-400 font-semibold">{section.title}</h2>
                <p className="text-200 text-muted-foreground">{section.blurb}</p>
              </div>
            </div>
            {section.fields.map(renderField)}
          </section>
        );
      })}

      {onFinalStep ? (
        wizard ? (
          /*
           * Collapsed by default (design-review Change 6): optional fields occupying the
           * same visible space as the required ones made them feel mandatory anyway. A
           * fresh submission never has anything in these yet, so collapsed loses nothing —
           * unlike revision (`wizard` off), where these can already hold real answers and
           * hiding them would read as the page losing someone's work.
           */
          <Accordion type="single" collapsible>
            <AccordionItem value="optional" className="border-0">
              <AccordionTrigger className="rounded-2xl border border-dashed border-border bg-muted/50 px-6 py-4 hover:no-underline">
                <div className="text-left">
                  <h2 className="text-400 font-semibold">Additional details (optional)</h2>
                  <p className="mt-1 text-200 font-normal text-muted-foreground">
                    Technology, existing tools, support, risks, cost. None of this blocks
                    submission — skip it if you'd rather.
                  </p>
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-6 rounded-b-2xl border border-t-0 border-dashed border-border px-6 pb-6">
                {OPTIONAL_FIELDS.map(renderField)}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        ) : (
          <section className="space-y-6 rounded-2xl border border-dashed border-border bg-muted/50 p-6">
            {/*
              No numbered badge here, unlike the required sections above. A tile that looks
              like the same clickable-looking step marker used elsewhere in the product read
              to reviewers as an actual control ("do I need to click the +?") rather than the
              plain section label it was meant to be — dropped rather than swapped for a
              different glyph, since optional means optional and this isn't a step at all.
            */}
            <div>
              <h2 className="text-400 font-semibold">Anything else? (all optional)</h2>
              <p className="text-200 text-muted-foreground">
                Leaving these blank is fine — it never blocks submission. Filling them in
                gives the analysis more to work with, and raises the maturity level.
              </p>
            </div>
            {OPTIONAL_FIELDS.map(renderField)}
          </section>
        )
      ) : null}

      {onFinalStep ? extra : null}

      {onFinalStep && serverError instanceof ApiError && !isFieldLevelError(serverError.body) ? (
        <p role="alert" className="text-200 text-destructive">{serverError.body.message}</p>
      ) : null}

      {onFinalStep ? (
        /*
          SPEC §4.5: the notice is linked from the submission form, because this is the
          moment someone decides how much detail to write.
        */
        <p className="text-100 text-muted-foreground">
          Your idea text is analysed by an AI service; your name and email are not sent with
          it, and no AI decides anything.{" "}
          <a href="/help/data-and-ai">How your idea is handled</a>
        </p>
      ) : null}

      {/*
        The actions stick to the bottom of the viewport, and they are the LAST thing in
        the form.

        Both halves matter. Sticky, because this form is six textareas long and a submit
        button that scrolls out of sight is a form people abandon halfway. Last, because
        a sticky element with content after it hangs over that content — the first version
        of this sat on top of section three's heading, which is worse than not sticking
        at all.
      */}
      <div className="sticky bottom-0 -mx-6 border-t border-border bg-background/90 px-6 py-4 backdrop-blur">
        {wizard && !onFinalStep ? (
          <div className="flex flex-wrap items-center gap-3">
            {step > 0 ? (
              <Button type="button" variant="outline" onClick={goBack}>Back</Button>
            ) : null}
            <Button type="button" onClick={() => void goNext()}>Continue</Button>
            <span className="ml-auto text-100 text-muted-foreground">
              Step {step + 1} of {totalSteps}
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            {wizard ? (
              /*
                Design-review Change 9: a completion zone, not a bar the form just happens
                to end on. By this step everything required has already passed validation
                (`goNext` checked it on the way in) — this is confirmation, not a gate.
              */
              <p className="text-200 font-medium">Ready to submit your idea?</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              {wizard && step > 0 ? (
                <Button type="button" variant="outline" onClick={goBack}>Back</Button>
              ) : null}
              <Button type="submit" disabled={busy}>{busy ? "Saving…" : submitLabel}</Button>
              {!requireChangeSummary ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void form.handleSubmit((v) => onSubmit(v, true), onInvalid)()}
                >
                  Save as draft
                </Button>
              ) : null}

              {!wizard ? (
                /*
                  The one thing missing from three numbered section chips: whether that adds
                  up to "done" without scrolling back up to check. Dots, not a bar — three
                  fixed steps read better as three fixed marks than as a bar whose fill
                  fraction (33%, 66%…) implies a precision this doesn't have. Draft saves
                  regardless, so this is a progress signal, never a gate. (In wizard mode the
                  segmented bar at the top already carries this, so it isn't repeated here.)
                */
                <span className="ml-auto flex items-center gap-2 text-100 text-muted-foreground">
                  <span className="flex gap-1" aria-hidden>
                    {REQUIRED_SECTIONS.map((section) => (
                      <span
                        key={section.step}
                        className={`size-1.5 rounded-full ${isAnswered(section) ? "bg-accent-600" : "bg-border"}`}
                      />
                    ))}
                  </span>
                  {answeredCount} of {REQUIRED_SECTIONS.length} answered
                </span>
              ) : null}
            </div>
          </div>
        )}
      </div>

    </form>
  );
}

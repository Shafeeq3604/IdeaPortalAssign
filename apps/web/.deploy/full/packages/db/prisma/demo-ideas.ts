/**
 * Demo submissions for `pnpm db:seed`.
 *
 * SEPARATE from the P0 fixture corpus on purpose. `packages/contracts/src/fixtures/ideas.ts`
 * belongs to the test suites — seeding it would put the engine's ground truth in the same
 * rows the engine is later run against, which is the circularity the seed's own header
 * warns about. A demo database and a test corpus should never be the same data.
 *
 * Deliberately UNEVEN. A demo where every idea is well written proves nothing: the
 * product's actual claims are that a thin idea is still ranked rather than rejected (P-4),
 * that a blocked one still gets guidance, and that ideas move when the profile changes
 * (FR-11). A set of uniformly good submissions demonstrates none of it.
 *
 * `optional` is what the submitter bothered to fill in, and it drives maturity (FR-17) —
 * which is why the thin ones leave it almost empty. That is the point, not an oversight.
 */

export interface DemoIdea {
  readonly title: string;
  readonly problemStatement: string;
  readonly description: string;
  readonly expectedUsers: string;
  readonly expectedOutcome: string;
  readonly optional: Readonly<Partial<Record<
    | "existingProcess"
    | "existingSolutions"
    | "suggestedTechnology"
    | "expectedBenefits"
    | "estimatedCostNote"
    | "references",
    string
  >>>;
}

export const DEMO_IDEAS: readonly DemoIdea[] = [
  {
    title: "Automatic receipt extraction for expense claims",
    problemStatement:
      "Staff retype receipt totals into the expense tool by hand, and finance rejects roughly 15% of claims for transcription errors. Correcting them costs the finance team about a week every month.",
    description:
      "When someone attaches a receipt photo to a claim, read the amount, date and vendor from the image and pre-fill the form. The claimant checks and corrects rather than types.",
    expectedUsers: "Everyone who claims expenses, plus the four people on the finance review team.",
    expectedOutcome: "Claims take a couple of minutes instead of ten, and typo rejections fall to near zero.",
    optional: {
      existingProcess:
        "Claimants type every field by hand, then finance re-checks each line against the attached image.",
      suggestedTechnology: "The document OCR service IT already licenses for invoice processing.",
      expectedBenefits:
        "About a week of finance rework recovered each month, and fewer resubmissions for staff.",
      references: "Finance rework figures, Q2 operations review.",
    },
  },
  {
    title: "Automated onboarding checklist across IT, HR and facilities",
    problemStatement:
      "New joiners wait two to three days for accounts and equipment because IT, HR and facilities each track setup on their own list, and nobody sees the whole picture.",
    description:
      "One shared checklist per joiner, created when the offer is accepted, visible to all three teams and to the hiring manager. Each team ticks off its own items; the manager sees what is outstanding.",
    expectedUsers: "Every new joiner, their manager, and the three onboarding teams.",
    expectedOutcome: "People are productive on day one instead of day three, and managers stop chasing.",
    optional: {
      existingProcess: "Three separate spreadsheets and an email thread per joiner.",
      existingSolutions: "The HR system has a tasks module nobody has configured.",
      expectedBenefits: "Roughly two days of lost productivity recovered per joiner.",
    },
  },
  {
    title: "Shared inbox triage for the support team",
    problemStatement:
      "Support share one mailbox. Two people often reply to the same message, and some sit unanswered for a day because everyone assumes someone else has picked it up.",
    description:
      "Classify each incoming message by topic and urgency, and suggest an owner based on who has handled similar messages before. A person still assigns it.",
    expectedUsers: "The nine people on the support team and their team lead.",
    expectedOutcome: "No message goes unclaimed for more than an hour, and duplicate replies stop.",
    optional: {
      existingProcess: "Whoever notices a message first replies to it and hopes nobody else did.",
      expectedBenefits: "Faster first response, and less duplicated effort.",
    },
  },
  {
    title: "Auto-release meeting rooms nobody turned up to",
    problemStatement:
      "Rooms are booked and then not used. People walk the floor looking for space while half the booked rooms sit empty.",
    description:
      "If nobody checks in within ten minutes of the start time, release the booking and make the room bookable again.",
    expectedUsers: "Everyone who books a room, which is most of the office.",
    expectedOutcome: "Fewer people hunting for space in the afternoon.",
    optional: {
      suggestedTechnology: "The room booking system already has an occupancy sensor feed.",
    },
  },
  {
    title: "Predictive maintenance for the warehouse conveyor",
    problemStatement:
      "The conveyor fails without warning about twice a year. Each failure stops despatch for most of a day.",
    description:
      "Watch the vibration and motor-current data the controllers already produce, and flag the pattern that precedes a failure so maintenance can be scheduled instead of scrambled.",
    expectedUsers: "The maintenance team and warehouse operations.",
    expectedOutcome: "Failures become planned downtime instead of a lost day.",
    optional: {
      existingProcess: "Maintenance runs on a fixed calendar regardless of the condition of the machine.",
      suggestedTechnology: "The controllers already log to a historian; nobody reads it.",
      expectedBenefits: "Two unplanned outages a year avoided.",
      estimatedCostNote: "Mostly data work; no new hardware expected.",
    },
  },
  {
    title: "Self-service data exports for the customer team",
    problemStatement:
      "Every export request goes through the data team. The queue runs to about a fortnight, so the customer team stops asking and works from stale spreadsheets instead.",
    description:
      "A small set of pre-approved exports the customer team can run themselves, scoped to the accounts they already have access to.",
    expectedUsers: "The customer team, and the data team who currently field the requests.",
    expectedOutcome: "Answers in minutes, and the data team gets its fortnight back.",
    optional: {
      existingProcess: "A ticket to the data team, then a wait.",
      expectedBenefits: "Roughly 30 tickets a month that stop being tickets.",
    },
  },
  {
    /**
     * The blocked one. Its `existingSolutions` states a real contractual constraint, which
     * is what FR-06 requires before anything may be called NOT_CURRENTLY_FEASIBLE — and
     * P-4 requires it to still receive improvement guidance rather than a rejection.
     */
    title: "Replace the supplier portal with a direct integration",
    problemStatement:
      "Suppliers key the same order data into our portal that already exists in their own systems. Errors get in, and suppliers complain about the double entry.",
    description:
      "Exchange orders and confirmations directly between the two systems instead of asking a person to retype them.",
    expectedUsers: "The procurement team and our forty regular suppliers.",
    expectedOutcome: "Fewer keying errors and less supplier friction.",
    optional: {
      existingSolutions:
        "The current portal is under contract with the vendor until the end of next year, and that contract prohibits third-party integration with it.",
      existingProcess: "Suppliers log in to the portal and retype each order by hand.",
    },
  },
  {
    /** The thin one. Must still be scored and ranked, never rejected (P-4, SPEC §9.3). */
    title: "Something to help with the reporting",
    problemStatement: "Reporting takes too long.",
    description: "Make the reports faster or automatic somehow.",
    expectedUsers: "People who do reports.",
    expectedOutcome: "Less time spent on reports.",
    optional: {},
  },
];

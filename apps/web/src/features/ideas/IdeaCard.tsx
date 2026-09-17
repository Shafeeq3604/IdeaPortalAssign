import { Link } from "react-router-dom";
import { StatusPill } from "@iep/ui";
import { IdeaStatus } from "@iep/contracts";
import type { IdeaSummary } from "@iep/contracts";
import { STATUS_LABEL } from "./api";
import { VoteCount } from "../feedback/VoteButtons";
import { ScoreRing } from "../rankings/DashboardHero";

/**
 * The idea card (Idea Platform Redesign — "Explore ideas"), pulled out of `IdeaListPage`
 * into its own module (enterprise-polish pass, §30 — a card this widely reused deserves to
 * be a documented primitive, not an inline function two screens happen to share).
 *
 * Both My Ideas (`scope="mine"`) and Explore Ideas (`scope="all"`) render the exact same
 * `IdeaListPage`, so this is already the one card every idea in the product is shown as.
 */

/**
 * The coloured rule across the top of a card.
 *
 * The status already has a pill with an icon and a label, so this is the third cue rather
 * than the only one — nothing here is carried by colour alone (SPEC §7.6). The ramp
 * gradient is reserved for RANKED because that is the one state with a score behind it.
 *
 * Every status in the enum is listed. A new lifecycle state added to the contract becomes
 * a compile error here rather than silently rendering a grey line nobody chose.
 */
const RULE: Record<IdeaStatus, string> = {
  DRAFT: "bg-border",
  SUBMITTED: "bg-state-info",
  AI_ANALYSIS: "bg-ai-ink",
  NEEDS_CLARIFICATION: "bg-factor-down",
  EVALUATED: "bg-ramp-4",
  RANKED: "bg-gradient-to-r from-ramp-4 via-ramp-5 to-grad-to",
  UNDER_REVIEW: "bg-state-warn",
  PROTOTYPE_CANDIDATE: "bg-ramp-3",
  PILOT: "bg-ramp-3",
  PRODUCTION_CANDIDATE: "bg-ramp-3",
  IMPLEMENTED: "bg-state-ok",
  PARKED: "bg-border-strong",
  BLOCKED: "bg-state-danger",
  REJECTED: "bg-state-danger",
  ARCHIVED: "bg-border-strong",
};

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

export function IdeaCard({ idea }: { idea: IdeaSummary }) {
  /*
   * "Analysis running" is a state, not a missing score.
   *
   * The canvas draws these two very differently and it is right to: a dial reading nothing
   * says the idea was measured and came out empty, whereas the pipeline simply has not
   * finished. A draft has no score for a third reason again — it has not been submitted.
   */
  const analysing = idea.status === "AI_ANALYSIS";

  return (
    <article className="relative flex h-full flex-col overflow-hidden rounded-2xl bg-card p-5 shadow-e3 ring-1 ring-inset ring-border transition-all duration-[var(--dur-base)] focus-within:ring-2 focus-within:ring-ring hover:-translate-y-0.5 hover:shadow-e4">
      <span aria-hidden className={`absolute inset-x-0 top-0 h-1.5 ${RULE[idea.status]}`} />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill kind="LIFECYCLE" status={idea.status} label={STATUS_LABEL[idea.status]} />
            {idea.rank === null ? null : (
              <span className="inline-flex items-center rounded-full bg-accent px-2.5 py-0.5 text-100 font-bold tabular-nums text-accent-foreground">
                Ranked #{idea.rank}
              </span>
            )}
            {/*
              A real, existing field (`IdeaSummary.department`) promoted from the footer
              metadata line up beside the status — a whole grid of cards that differ only
              by a one-pixel status rule reads as one template repeated (production visual
              review). This is real data, not decoration: which department an idea is from
              is exactly the kind of second fact that lets a scanning eye tell cards apart
              without reading every title.
            */}
            {idea.department ? (
              <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-100 font-medium text-muted-foreground">
                {idea.department.name}
              </span>
            ) : null}
          </div>

          {/*
            The link covers the whole card, so the title is the accessible name for the
            navigation and the rest of the card is inside its hit area. `after:absolute
            after:inset-0` is what does that without nesting the vote counts inside an <a>.
          */}
          <h2 className="mt-2.5 text-400 font-semibold leading-snug">
            <Link
              to={`/ideas/${idea.id}/overview`}
              className="no-underline after:absolute after:inset-0 after:content-['']"
            >
              {idea.title}
            </Link>
          </h2>

          {/*
            The canvas puts the problem statement under the title. `IdeaSummary` carries no
            prose — only the title — so there is nothing to excerpt. Adding the field is an
            additive contract change and a real improvement to this card; it is NOT done
            here because the list endpoint would have to select and ship the current
            version's body for every row, which is a decision about the API's shape rather
            than about this page.
          */}
        </div>

        {analysing ? (
          <span
            aria-hidden
            /* Deliberately not the `ai-*` palette: provenance.test.ts reserves it for
               <Provenance>, where it means "a model wrote this". This says a job is
               running, which is a different claim. */
            className="motion-pending-pulse grid size-16 shrink-0 place-items-center rounded-full bg-card text-center text-100 font-bold leading-tight text-accent-700 ring-2 ring-inset ring-ramp-3"
          >
            analysis
            <br />
            running
          </span>
        ) : idea.compositeScore === null ? null : (
          <ScoreRing value={idea.compositeScore} size="sm" />
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        {/*
          text-200, one step up from text-100: who submitted this and which department
          it belongs to is real metadata a reader scans for, not a footnote — the
          brief's own hierarchy puts "metadata" a size above "tiny helper text", which
          is what the smaller tier is reserved for (the avatar-initial glyph below).
        */}
        <span className="flex min-w-0 items-center gap-2 text-200 text-muted-foreground">
          <span
            aria-hidden
            className="grid size-6.5 shrink-0 place-items-center rounded-full bg-accent text-100 font-extrabold text-accent-foreground"
          >
            {initials(idea.submitter.displayName)}
          </span>
          {/* The department now has its own pill up top, next to status — saying it
              twice on one card would read as filler, not confirmation. */}
          <span className="truncate">{idea.submitter.displayName}</span>
        </span>

        {/*
          Counts only, no controls. A card is for scanning; voting on something you are
          skimming means voting on a title, which is not an opinion worth recording. The
          buttons live on the idea itself.

          `relative` lifts it above the title link's ::after overlay so the numbers are
          selectable rather than swallowed by the navigation target.
        */}
        {idea.status === "DRAFT" ? (
          <span className="text-100 text-muted-foreground">Not submitted</span>
        ) : (
          <span className="relative">
            <VoteCount up={idea.feedback.up} down={idea.feedback.down} />
          </span>
        )}
      </div>
    </article>
  );
}

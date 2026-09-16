import * as React from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, ErrorState, Label, Skeleton, StatusPill, Textarea,
} from "@iep/ui";
import { ROUTES } from "@iep/contracts";
import { STATUS_LABEL, useIdea, useTransition } from "./api";
import { VoteButtons } from "../feedback/VoteButtons";
import type { IdeaDetail } from "@iep/contracts";

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

/** Tab order matches the nav map, so the two cannot drift (SPEC §6.2 row 6). */
const TABS = [
  { id: "idea.overview", label: "Overview", seg: "overview" },
  { id: "idea.analysis", label: "Analysis", seg: "analysis" },
  { id: "idea.evaluation", label: "Evaluation", seg: "evaluation" },
  { id: "idea.history", label: "History", seg: "history" },
  { id: "idea.review", label: "Review", seg: "review" },
] as const;

/**
 * Shared header + tab bar for every idea route.
 *
 * The header renders the submitter and department as LINKS (§6.2 rows 3, 4) — a foreign
 * key shown as plain text is an orphan, and the nav test asserts against this map.
 */
export function IdeaShell({ children }: { children: (idea: IdeaDetail) => React.ReactNode }) {
  const { ideaId = "" } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const query = useIdea(ideaId);
  const transition = useTransition(ideaId);
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const [archiveReason, setArchiveReason] = React.useState("");
  const [archiveTouched, setArchiveTouched] = React.useState(false);
  const archiveReasonMissing = archiveReason.trim().length === 0;

  if (query.isPending) {
    return (
      <main className="page" aria-busy="true">
        <Skeleton className="h-8 w-2/3" />
        <div className="mt-4 space-y-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      </main>
    );
  }

  if (query.isError) {
    return (
      <main className="page">
        <ErrorState
          title="Could not open this idea"
          description="It may have been removed, or you may not have access to it."
          onRetry={() => void query.refetch()}
          escapeTo={{ label: "Back to ideas", to: "/ideas" }}
          renderLink={link}
        />
      </main>
    );
  }

  const idea = query.data;
  const canSee = (id: string): boolean => {
    const route = ROUTES.find((r) => r.id === id);
    if (!route) return false;
    // Review is privileged; the rest follow the idea itself.
    return id !== "idea.review" || idea.permissions.canReview;
  };

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/ideas">Ideas</Link>  ›  {idea.title}
      </nav>

      {/*
        Idea Details is the one screen every role lands on to make a decision — the
        flagship of the enterprise-polish pass (§12). The title is the primary fact
        (large, serif, on its own line); status + version are secondary (a real
        `StatusPill`, the same one every card and table on the product uses, not a plain
        `Badge` guessing at a variant); submitter/department recede to tertiary metadata.
        Three tiers instead of one flat row of equally-weighted text.
      */}
      <h1 className="font-serif text-700 font-semibold leading-tight tracking-tight">
        {idea.title}
      </h1>

      <div className="mt-2 mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <StatusPill kind="LIFECYCLE" status={idea.status} label={STATUS_LABEL[idea.status]} />
        <span className="text-100 text-muted-foreground tabular">
          Version {idea.currentVersionNo} of {idea.versionCount}
        </span>
        <span className="text-100 text-muted-foreground">
          <Link to={`/people/${idea.submitter.id}`}>{idea.submitter.displayName}</Link>
          {idea.department ? (
            <>
              {" · "}
              <Link to={`/departments/${idea.department.id}`}>{idea.department.name}</Link>
            </>
          ) : null}
        </span>
      </div>

      {/*
        Reactions and actions share one compact row, so an idea's context (what it is,
        what colleagues think, what you can do to it) reads as a single block above the
        tab strip instead of three separately-margined ones pushing tab content further
        down the page every time. Both still sit above the tabs and outside them —
        reacting is something you do to the IDEA, not to its analysis, and an action like
        "Create a new version" is a decision about the idea as a whole, not one tab's
        concern — so neither belongs buried on a single tab where most people would never
        find it.
      */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5">
        {idea.status === "DRAFT" ? (
          <span />
        ) : (
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-100 font-medium uppercase tracking-widest text-muted-foreground">
              Team feedback
            </span>
            <VoteButtons ideaId={ideaId} />
            <span className="text-100 text-muted-foreground">
              What colleagues think — separate from the platform's own evaluation.
            </span>
          </div>
        )}

        {/* Actions the API confirmed THIS actor may take — never guessed client-side. */}
        <div className="flex flex-wrap gap-2.5">
          {idea.permissions.canEdit ? (
            <Button asChild size="sm" variant="outline">
              {link({ to: `/ideas/${ideaId}/revise`, children: "Edit" })}
            </Button>
          ) : null}
          {idea.permissions.canRevise ? (
            <Button asChild size="sm">
              {link({ to: `/ideas/${ideaId}/revise`, children: "Create a new version" })}
            </Button>
          ) : null}
          {idea.permissions.allowedTransitions.includes("SUBMITTED") ? (
            <Button
              size="sm"
              disabled={transition.isPending}
              onClick={() =>
                transition.mutate(
                  { to: "SUBMITTED" },
                  // The status pill above re-renders to "Submitted" either way, but that
                  // is easy to miss on a page someone is about to navigate away from —
                  // this is the moment the analysis pipeline actually starts, and it was
                  // the one transition on this page with nothing telling you it worked.
                  { onSuccess: () => toast.success("Submitted — analysis is starting.") },
                )
              }
            >
              {transition.isPending ? "Submitting…" : "Submit for analysis"}
            </Button>
          ) : null}
          {idea.permissions.allowedTransitions.includes("ARCHIVED") ? (
            // `ghost`, not `destructive` — this is the trigger, not the commit. It sat at
            // full destructive-red weight next to routine actions like "Submit for
            // analysis," so the rarest, hardest-to-undo control on the page was also the
            // loudest one. The actual point of no return is the confirm button in the
            // dialog below, which keeps its destructive styling; a reason is required
            // there and nothing here can archive anything by itself.
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setArchiveOpen(true)}
            >
              Archive this idea
            </Button>
          ) : null}
        </div>
      </div>

      {/*
        An underline tab strip, not filled buttons — five destinations sharing one report
        (Overview / Analysis / Evaluation / History / Review) read as SECTIONS of the same
        document, not five separate places to navigate to. The active underline is the
        one thing carrying weight; everything else stays quiet until it's current.
      */}
      <div className="mb-6 flex flex-wrap gap-1 border-b border-border">
        {TABS.filter((t) => canSee(t.id)).map((tab) => {
          const to = `/ideas/${ideaId}/${tab.seg}`;
          const active = pathname === to;
          return (
            <Link
              key={tab.id}
              to={to}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "-mb-px border-b-2 border-accent-600 px-3 py-2.5 text-200 font-semibold text-foreground"
                  : "-mb-px border-b-2 border-transparent px-3 py-2.5 text-200 font-medium text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:text-foreground"
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <Dialog
        open={archiveOpen}
        onOpenChange={(open) => {
          setArchiveOpen(open);
          if (!open) {
            setArchiveReason("");
            setArchiveTouched(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive this idea?</DialogTitle>
            <DialogDescription>
              It comes off your active list and the board. Every version, evaluation, and
              audit entry stays exactly as it is — nothing is deleted — but there is
              currently no way to bring it back to an active status from here.
            </DialogDescription>
          </DialogHeader>

          <div>
            <Label htmlFor="field-archiveReason">Why (required)</Label>
            <Textarea
              id="field-archiveReason"
              value={archiveReason}
              onChange={(event) => setArchiveReason(event.target.value)}
              rows={3}
              aria-invalid={archiveTouched && archiveReasonMissing}
              aria-describedby={
                archiveTouched && archiveReasonMissing ? "error-archiveReason" : undefined
              }
            />
            {archiveTouched && archiveReasonMissing ? (
              <p id="error-archiveReason" role="alert" className="mt-1 text-100 text-destructive">
                Archiving needs a reason. It's recorded in the idea's history.
              </p>
            ) : null}
          </div>

          {transition.isError ? (
            <p role="alert" className="text-100 text-destructive">
              The idea was not archived. Nothing has changed — try again.
            </p>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={transition.isPending}
              onClick={() => {
                setArchiveTouched(true);
                if (archiveReasonMissing) return;
                transition.mutate(
                  // The default `/ideas` view excludes ARCHIVED — landing there right
                  // after archiving made the idea look deleted rather than archived.
                  { to: "ARCHIVED", reason: archiveReason.trim() },
                  {
                    onSuccess: () => {
                      // The navigation alone left this indistinguishable from any other
                      // filtered list — the one confirmation that the idea was actually
                      // archived, not just that a dialog closed, was missing.
                      toast.success(`"${idea.title}" was archived.`);
                      navigate("/ideas?status=ARCHIVED");
                    },
                  },
                );
              }}
            >
              {transition.isPending ? "Archiving…" : "Archive this idea"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* `.motion-defer` (visual-richness pass — subtle motion on Idea Details): a plain
          fade and a slight rise, no stagger, no lift — this page's richness is meant to
          read as analytical calm, so every tab's content gets one quiet arrival, not a
          choreographed reveal. Keyed on the route so switching tabs re-triggers it,
          the same way a page navigation would. */}
      <div key={pathname} className="motion-defer">
        {children(idea)}
      </div>
    </main>
  );
}

import * as React from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, ErrorState, Label, Skeleton, Textarea,
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

      <h1>{idea.title}</h1>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Badge variant={idea.status === "DRAFT" ? "outline" : "secondary"}>
          {STATUS_LABEL[idea.status]}
        </Badge>
        <span className="text-200 text-muted-foreground tabular">
          Version {idea.currentVersionNo} of {idea.versionCount}
        </span>
        <Link to={`/people/${idea.submitter.id}`} className="text-200">
          {idea.submitter.displayName}
        </Link>
        {idea.department ? (
          <Link to={`/departments/${idea.department.id}`} className="text-200">
            {idea.department.name}
          </Link>
        ) : null}
      </div>

      <div className="mb-6 flex flex-wrap gap-2 border-b border-border pb-3">
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
                  ? "rounded-md bg-accent px-3 py-2 text-200 font-medium text-accent-foreground"
                  : "rounded-md px-3 py-2 text-200 text-muted-foreground hover:bg-muted"
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {/*
        Reactions sit at the top of every idea, next to its actions.

        Deliberately above the tabs' content and outside them: reacting is something you do
        to the IDEA, not to its analysis, and burying it on one tab would mean most people
        never find it. A draft has nothing to react to yet.
      */}
      {idea.status === "DRAFT" ? null : (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <span className="text-100 font-medium uppercase tracking-widest text-muted-foreground">
            Team feedback
          </span>
          <VoteButtons ideaId={ideaId} />
          <span className="text-100 text-muted-foreground">
            What colleagues think. Separate from the platform's own evaluation, and it does
            not affect the score.
          </span>
        </div>
      )}

      {/* Actions the API confirmed THIS actor may take — never guessed client-side. */}
      <div className="mb-8 flex flex-wrap gap-3">
        {idea.permissions.canEdit ? (
          <Button asChild variant="outline">
            {link({ to: `/ideas/${ideaId}/revise`, children: "Edit" })}
          </Button>
        ) : null}
        {idea.permissions.canRevise ? (
          <Button asChild>
            {link({ to: `/ideas/${ideaId}/revise`, children: "Create a new version" })}
          </Button>
        ) : null}
        {idea.permissions.allowedTransitions.includes("SUBMITTED") ? (
          <Button
            disabled={transition.isPending}
            onClick={() => transition.mutate({ to: "SUBMITTED" })}
          >
            {transition.isPending ? "Submitting…" : "Submit for analysis"}
          </Button>
        ) : null}
        {idea.permissions.allowedTransitions.includes("ARCHIVED") ? (
          <Button variant="destructive" onClick={() => setArchiveOpen(true)}>
            Archive this idea
          </Button>
        ) : null}
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
                  { onSuccess: () => navigate("/ideas?status=ARCHIVED") },
                );
              }}
            >
              {transition.isPending ? "Archiving…" : "Archive this idea"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {children(idea)}
    </main>
  );
}

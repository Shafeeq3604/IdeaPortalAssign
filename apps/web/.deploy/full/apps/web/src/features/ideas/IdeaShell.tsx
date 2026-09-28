import * as React from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Archive, Ellipsis, Trophy } from "lucide-react";
import {
  Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  ErrorState, Label, Skeleton, StatusPill, Textarea,
} from "@iep/ui";
import { ROUTES } from "@iep/contracts";
import { STATUS_LABEL, useIdea, useTransition } from "./api";
import { VoteButtons } from "../feedback/VoteButtons";
import { IdeaSocialBar } from "../social/IdeaSocialBar";
import { MilestoneCelebration } from "./MilestoneCelebration";
import { MATURITY_LABEL } from "../evaluation/api";
import { useSession } from "../../app/use-session";
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
  { id: "idea.delivery", label: "Delivery", seg: "delivery" },
  { id: "idea.review", label: "Review", seg: "review" },
  { id: "idea.leadershipDecision", label: "Leadership decision", seg: "leadership-decision" },
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
  const session = useSession();
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
  const actorRoles = session.data?.user.roles ?? [];
  /*
   * Bug found live: this used to gate the "Review" tab on `idea.permissions.canReview`
   * — THIS idea's per-resource permission, not "can this person reach the review
   * workflow at all." Since a reviewer/admin cannot review their own submission
   * (permissions.ts's deliberate self-review block), landing on their own idea made the
   * tab silently vanish from the strip, on top of the tab's own content rendering
   * nothing (fixed separately in `ReviewTab.tsx` — see `SelfSubmittedNotice`). Gating on
   * the ROUTE's own roles instead means the tab stays put for anyone who holds
   * REVIEWER/ADMIN, on every idea including their own, and the page explains the
   * per-idea "why" instead of the tab bar doing it by disappearing.
   */
  const canSee = (id: string): boolean => {
    const route = ROUTES.find((r) => r.id === id);
    if (!route) return false;
    return route.roles.length === 0 || route.roles.some((r) => actorRoles.includes(r));
  };

  return (
    <main className="page">
      <MilestoneCelebration idea={idea} isOwner={idea.submitter.id === session.data?.user.id} />
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/ideas">Ideas</Link>  ›  {idea.title}
      </nav>

      {/*
        P9 usability round 1 ("richer, enterprise-grade look"): the header is one card
        carrying what the idea IS (title, who, the pitch, what you can do to it), beside a
        navy score panel carrying where it STANDS. Every figure in the panel is one this
        page already fetched — composite, rank, maturity, open recommendations — so it is
        the old "strategic snapshot" line given the weight a decision screen needs, not new
        data. The panel is absent until there is a score: no placeholder dial for an idea
        the engine has not seen.
      */}
      <section
        className={`mt-1 grid gap-5 ${idea.compositeScore !== null ? "lg:grid-cols-[minmax(0,1fr)_20.5rem]" : ""}`}
      >
        <div className="flex min-w-0 flex-col gap-3.5 rounded-2xl border border-border bg-card p-5 shadow-e2 sm:p-7">
          <div className="flex flex-wrap items-center gap-2">
            {idea.rank !== null ? (
              <Link
                to={`/ideas/${ideaId}/evaluation`}
                className="inline-flex items-center gap-1.5 rounded-full bg-accent-100 px-3 py-1 text-100 font-extrabold text-accent-700 no-underline hover:underline"
              >
                <Trophy aria-hidden className="size-3.5" />
                Ranked #{idea.rank}
              </Link>
            ) : null}
            <StatusPill kind="LIFECYCLE" status={idea.status} label={STATUS_LABEL[idea.status]} />
            {idea.maturityLevel !== null ? (
              <span className="rounded-full border border-border px-3 py-0.5 text-100 font-semibold text-muted-foreground">
                Maturity: {MATURITY_LABEL[idea.maturityLevel]}
              </span>
            ) : null}
          </div>

          <h1 className="text-600 font-extrabold leading-tight tracking-tight text-balance sm:text-700 lg:text-800">
            {idea.title}
          </h1>

          {/*
            P9 tester feedback: at text-100 in link blue, the submitter read as fine print
            ("barely noticeable"). A byline instead, with the person's initials — who
            submitted it is one of the first things a reviewer wants — in foreground ink at
            body size, still links (§6.2 rows 3, 4).
          */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-200 text-muted-foreground">
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-100 text-100 font-extrabold text-accent-700"
              >
                {initials(idea.submitter.displayName)}
              </span>
              <span>
                Submitted by{" "}
                <Link to={`/people/${idea.submitter.id}`} className="font-bold text-foreground hover:text-accent-700">
                  {idea.submitter.displayName}
                </Link>
                {idea.department ? (
                  <>
                    {" · "}
                    <Link to={`/departments/${idea.department.id}`} className="font-semibold text-foreground hover:text-accent-700">
                      {idea.department.name}
                    </Link>
                  </>
                ) : null}
              </span>
            </span>
            {idea.submittedAt ? <span>{new Date(idea.submittedAt).toLocaleDateString()}</span> : null}
            <span className="tabular">
              Version {idea.currentVersionNo} of {idea.versionCount}
            </span>
          </div>

          <p className="line-clamp-3 max-w-[78ch] text-300 leading-relaxed text-foreground/85">
            {idea.currentVersion.description}
          </p>

          {/*
            Actions and reactions share one row. Both sit above the tabs and outside them —
            reacting is something you do to the IDEA, and an action like "Create a new
            version" is a decision about the idea as a whole, not one tab's concern.
          */}
          <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-3">
            {/* Actions the API confirmed THIS actor may take — never guessed client-side. */}
            {idea.permissions.canRevise ? (
              <Button asChild>
                {link({ to: `/ideas/${ideaId}/revise`, children: "Create a new version" })}
              </Button>
            ) : null}
            {idea.permissions.allowedTransitions.includes("SUBMITTED") ? (
              <Button
                disabled={transition.isPending}
                onClick={() =>
                  transition.mutate(
                    { to: "SUBMITTED" },
                    // This is the moment the analysis pipeline actually starts, and it
                    // was the one transition on this page with nothing saying it worked.
                    { onSuccess: () => toast.success("Submitted — analysis is starting.") },
                  )
                }
              >
                {transition.isPending ? "Submitting…" : "Submit for analysis"}
              </Button>
            ) : null}
            {idea.permissions.canEdit ? (
              <Button asChild variant="outline">
                {link({ to: `/ideas/${ideaId}/revise`, children: "Edit" })}
              </Button>
            ) : null}
            {idea.status === "DRAFT" ? null : (
              <span className="flex flex-wrap items-center gap-2.5">
                <span className="text-100 font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  Team feedback
                </span>
                <VoteButtons ideaId={ideaId} />
              </span>
            )}
            {idea.permissions.allowedTransitions.includes("ARCHIVED") ? (
              /*
               * Behind a "More actions" menu, not a red button beside the reactions: it
               * sat one slip away from 👍/👎 on every idea an admin opened, and hides the
               * idea from everyone. The dialog below is still the point of no return, with
               * its required reason; this only stops the trigger shouting.
               */
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" className="ml-auto text-muted-foreground" aria-label="More actions">
                    <Ellipsis aria-hidden className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem variant="destructive" onSelect={() => setArchiveOpen(true)}>
                    <Archive aria-hidden className="size-4" />
                    Archive this idea
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
          {idea.status === "DRAFT" ? null : (
            <p className="-mt-1 text-100 text-muted-foreground">
              Team feedback is what colleagues think — separate from the platform's own evaluation.
            </p>
          )}
          {/* P18 — team, follow and share. Nothing to follow or share on a private draft. */}
          {idea.status === "DRAFT" ? null : (
            <div className="border-t border-border pt-3.5">
              <IdeaSocialBar idea={idea} isOwner={idea.submitter.id === session.data?.user.id} />
            </div>
          )}
        </div>

        {idea.compositeScore !== null ? (
          <ScorePanel
            ideaId={ideaId}
            score={idea.compositeScore}
            rank={idea.rank}
            maturity={idea.maturityLevel === null ? null : MATURITY_LABEL[idea.maturityLevel]}
            openRecommendations={idea.openRecommendationCount}
          />
        ) : null}
      </section>

      {/*
        An underline tab strip, not filled buttons — the tabs are SECTIONS of one report,
        not separate places. The active underline is the one thing carrying weight.
      */}
      <div className="mb-6 mt-6 flex flex-wrap gap-1 border-b border-border">
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
                  ? "-mb-px whitespace-nowrap border-b-2 border-accent-600 px-3.5 py-3 text-200 font-extrabold text-foreground no-underline"
                  : "-mb-px whitespace-nowrap border-b-2 border-transparent px-3.5 py-3 text-200 font-semibold text-muted-foreground no-underline transition-colors duration-[var(--dur-fast)] hover:border-border-strong hover:text-foreground"
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

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

/**
 * Where the idea stands, on the same fixed-navy surface as the dashboard hero — the one
 * focal panel on this page. The ring is the composite out of 100, drawn as a fraction of
 * a turn; the ramp-free single accent keeps it a measurement, not a verdict (P-1).
 */
function ScorePanel({
  ideaId,
  score,
  rank,
  maturity,
  openRecommendations,
}: {
  ideaId: string;
  score: number;
  rank: number | null;
  maturity: string | null;
  openRecommendations: number;
}) {
  const c = 2 * Math.PI * 50;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * c;

  return (
    <aside
      aria-label="Where this idea stands"
      className="dash-hero relative flex flex-col justify-between gap-4 overflow-hidden rounded-2xl p-5 text-grad-ink shadow-e4-lit sm:p-6"
    >
      <p className="relative text-100 font-bold uppercase tracking-[0.1em] text-grad-ink-soft">
        Composite score
      </p>
      <div className="relative flex items-center gap-4.5">
        <svg viewBox="0 0 120 120" className="size-28 shrink-0" role="img" aria-label={`Composite score ${score.toFixed(1)} out of 100`}>
          <circle cx="60" cy="60" r="50" fill="none" strokeWidth="10" className="stroke-grad-rule" />
          <circle
            cx="60" cy="60" r="50" fill="none" strokeWidth="10" strokeLinecap="round"
            strokeDasharray={`${filled} ${c}`}
            transform="rotate(-90 60 60)"
            className="stroke-grad-highlight"
          />
          <text x="60" y="67" textAnchor="middle" className="fill-grad-ink text-600 font-extrabold">
            {score.toFixed(1)}
          </text>
        </svg>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-300 font-extrabold">
            {rank === null ? "Not on the current board" : rank === 1 ? "Top of the board" : `Ranked #${rank}`}
          </span>
          <span className="text-200 leading-snug text-grad-ink-soft">
            Out of 100.{" "}
            <Link to={`/ideas/${ideaId}/evaluation`} className="font-semibold text-grad-ink underline">
              See why
            </Link>
          </span>
        </div>
      </div>
      <dl className="relative m-0 grid grid-cols-3 gap-2">
        <PanelStat label="Rank" value={rank === null ? "—" : `#${rank}`} />
        <PanelStat label="Maturity" value={maturity ?? "—"} small />
        <PanelStat
          label="Open recs"
          value={String(openRecommendations)}
          href={openRecommendations > 0 ? `/ideas/${ideaId}/analysis` : undefined}
        />
      </dl>
    </aside>
  );
}

function PanelStat({ label, value, small = false, href }: { label: string; value: string; small?: boolean; href?: string | undefined }) {
  // A `<div>` around each pair keeps the `<dl>` valid; the link, when there is one, is the
  // value itself rather than a wrapper around dt/dd.
  return (
    <div className="hero-panel rounded-xl p-2.5">
      <dt className="text-100 text-grad-ink-soft">{label}</dt>
      <dd className={`m-0 mt-0.5 font-extrabold leading-tight ${small ? "text-200" : "text-400 tabular-nums"}`}>
        {href ? (
          <Link to={href} className="text-grad-ink underline">
            {value}
          </Link>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

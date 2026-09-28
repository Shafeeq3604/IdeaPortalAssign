import * as React from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, MessageSquare, SkipForward, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button, EmptyState, ErrorState, Skeleton, StatusPill } from "@iep/ui";
import type { FeedbackVote, IdeaSummary } from "@iep/contracts";
import { useActor } from "../../app/use-session";
import { celebrate } from "../../app/motion";
import { useCastVote } from "../feedback/api";
import { STATUS_LABEL, useIdea, useIdeaList } from "./api";
import { WEIGH_IN_STATUSES, swipeDeck } from "./swipe-deck";

/**
 * "Weigh in" (P20 — SPEC §14 M4, D-25): ideas you have not reacted to yet, one card at a
 * time. Swipe right for a thumb up, left for a thumb down, or use the buttons — every
 * swipe has one. Skip records nothing.
 *
 * This is the thumb vote that already sits on every idea (P11), nothing more: it never
 * touches a score (P-5; REQUIREMENTS §14 — popularity must not decide a rank), and the
 * card says so.
 *
 * The deck is frozen when it first loads. Voting refreshes the lists behind it, and a
 * deck that re-sorted itself under someone's thumb would skip or repeat cards.
 */

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

/** How far a card must travel before letting go counts as a vote, in rem-ish pixels. */
const COMMIT_DISTANCE = 110;

export function SwipePage() {
  const actor = useActor();
  const list = useIdeaList({ status: WEIGH_IN_STATUSES, sort: "rank", perPage: 50 });
  const [deck, setDeck] = React.useState<IdeaSummary[] | null>(null);
  const [position, setPosition] = React.useState(0);
  const [tally, setTally] = React.useState({ up: 0, down: 0, skipped: 0 });

  // Freeze the deck the first time the list arrives — adjusting state during render, the
  // pattern AppShell uses for the same "derive once from a prop" case.
  if (deck === null && list.data && actor) {
    setDeck(swipeDeck(list.data.items, actor.userId));
  }

  const cast = useCastVote();
  const current = deck?.[position];
  const next = deck?.[position + 1];

  const answer = (vote: FeedbackVote | null) => {
    if (!current) return;
    if (vote) {
      cast.mutate(
        { ideaId: current.id, vote },
        { onError: () => toast.error(`Your vote on "${current.title}" did not save. Open the idea to try again.`) },
      );
      setTally((t) => (vote === "UP" ? { ...t, up: t.up + 1 } : { ...t, down: t.down + 1 }));
    } else {
      setTally((t) => ({ ...t, skipped: t.skipped + 1 }));
    }
    setPosition((p) => p + 1);
    if (deck && position + 1 === deck.length && vote) celebrate();
  };

  return (
    <main className="page page--narrow">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/">Home</Link>  ›  Weigh in
      </nav>
      <h1>Weigh in</h1>
      <p className="mt-1 text-200 text-muted-foreground sm:text-300">
        Ideas you have not reacted to yet. Swipe right or press{" "}
        <ThumbsUp aria-label="thumbs up" className="inline size-4 align-text-bottom" /> if it is worth
        pursuing, left or <ThumbsDown aria-label="thumbs down" className="inline size-4 align-text-bottom" /> if
        not. Your reaction is visible to the team and never changes a score.
      </p>

      <div className="mt-6">
        {list.isPending || (list.data && !deck) ? (
          <Skeleton className="h-96 w-full rounded-3xl" aria-busy="true" />
        ) : list.isError ? (
          <ErrorState
            title="Could not load ideas"
            description="Nothing has been lost — this is the list failing to load."
            onRetry={() => void list.refetch()}
            escapeTo={{ label: "Browse all ideas", to: "/ideas" }}
            renderLink={link}
          />
        ) : !current ? (
          <Finished tally={tally} fresh={(deck?.length ?? 0) === 0} />
        ) : (
          <>
            <p className="mb-3 text-200 tabular-nums text-muted-foreground" aria-live="polite">
              {position + 1} of {deck?.length ?? 0}
            </p>
            <div className="relative">
              {/* The next card peeks out underneath, so the deck reads as a deck. */}
              {next ? (
                <div aria-hidden className="absolute inset-x-4 -bottom-2 top-3 rounded-3xl bg-card shadow-e1 ring-1 ring-inset ring-border" />
              ) : null}
              <SwipeCard key={current.id} idea={current} onAnswer={answer} />
            </div>
            <div className="mt-6 grid grid-cols-3 gap-3">
              <Button type="button" variant="outline" size="lg" onClick={() => answer("DOWN")}>
                <ThumbsDown aria-hidden className="size-5" />
                Not for me
              </Button>
              <Button type="button" variant="ghost" size="lg" onClick={() => answer(null)}>
                <SkipForward aria-hidden className="size-5" />
                Skip
              </Button>
              <Button type="button" size="lg" onClick={() => answer("UP")}>
                <ThumbsUp aria-hidden className="size-5" />
                Worth it
              </Button>
            </div>
            <p className="mt-3 hidden text-center text-100 text-muted-foreground sm:block">
              Keyboard: ← not for me · ↓ skip · → worth it
            </p>
            <DeckKeys onAnswer={answer} />
          </>
        )}
      </div>
    </main>
  );
}

/** Arrow keys answer the card on top, unless someone is typing somewhere. */
function DeckKeys({ onAnswer }: { onAnswer: (vote: FeedbackVote | null) => void }) {
  const latest = React.useRef(onAnswer);
  React.useEffect(() => {
    latest.current = onAnswer;
  });
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (e.key === "ArrowRight") latest.current("UP");
      else if (e.key === "ArrowLeft") latest.current("DOWN");
      else if (e.key === "ArrowDown") latest.current(null);
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return null;
}

function SwipeCard({ idea, onAnswer }: { idea: IdeaSummary; onAnswer: (vote: FeedbackVote | null) => void }) {
  const detail = useIdea(idea.id);
  const [dx, setDx] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  const [leaving, setLeaving] = React.useState<FeedbackVote | null>(null);
  const start = React.useRef<number | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Links inside the card stay clickable; a drag starts anywhere else.
    if ((e.target as HTMLElement).closest("a")) return;
    start.current = e.clientX;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (start.current !== null) setDx(e.clientX - start.current);
  };
  const onPointerUp = () => {
    start.current = null;
    setDragging(false);
    if (Math.abs(dx) >= COMMIT_DISTANCE) {
      const vote: FeedbackVote = dx > 0 ? "UP" : "DOWN";
      setLeaving(vote);
      // Let the card fly off before the next one takes its place.
      window.setTimeout(() => onAnswer(vote), 160);
    } else {
      setDx(0);
    }
  };

  const offset = leaving ? (leaving === "UP" ? 600 : -600) : dx;
  const lean = Math.max(-1, Math.min(1, dx / COMMIT_DISTANCE));
  const v = detail.data?.currentVersion;

  return (
    <div
      role="group"
      aria-roledescription="card"
      aria-label={idea.title}
      data-dragging={dragging}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        start.current = null;
        setDragging(false);
        setDx(0);
      }}
      style={{ transform: `translateX(${offset}px) rotate(${offset / 24}deg)`, opacity: leaving ? 0 : 1 }}
      className="swipe-card relative cursor-grab select-none rounded-3xl bg-card p-5 shadow-e3 ring-1 ring-inset ring-border active:cursor-grabbing sm:p-8"
    >
      {/* What letting go right now would do — shown only while the card is leaning. */}
      <span
        aria-hidden
        style={{ opacity: Math.max(0, lean) }}
        className="absolute right-5 top-5 rounded-full bg-state-ok-bg px-3 py-1 text-200 font-bold text-state-ok"
      >
        Worth it
      </span>
      <span
        aria-hidden
        style={{ opacity: Math.max(0, -lean) }}
        className="absolute left-5 top-5 rounded-full bg-muted px-3 py-1 text-200 font-bold text-muted-foreground"
      >
        Not for me
      </span>

      <div className="flex flex-wrap items-center gap-2 pt-6">
        <StatusPill kind="LIFECYCLE" status={idea.status} label={STATUS_LABEL[idea.status]} />
        {idea.rank ? (
          <span className="text-200 font-semibold tabular-nums text-muted-foreground">
            #{idea.rank}
            {idea.compositeScore !== null ? ` · ${idea.compositeScore.toFixed(1)} of 100` : ""}
          </span>
        ) : null}
      </div>
      <h2 className="mt-3 text-balance text-500 font-extrabold leading-tight sm:text-600">{idea.title}</h2>
      <p className="mt-1 text-200 text-muted-foreground">
        {idea.submitter.displayName}
        {idea.department ? ` · ${idea.department.name}` : ""}
        {idea.category ? ` · ${idea.category.label}` : ""}
      </p>

      {v ? (
        <dl className="mt-5 space-y-3">
          <div>
            <dt className="text-100 font-bold uppercase tracking-[0.08em] text-muted-foreground">The problem</dt>
            <dd className="mt-0.5 line-clamp-3 text-200 leading-relaxed sm:line-clamp-4 sm:text-300">{v.problemStatement}</dd>
          </div>
          <div>
            <dt className="text-100 font-bold uppercase tracking-[0.08em] text-muted-foreground">What changes</dt>
            <dd className="mt-0.5 line-clamp-2 text-200 leading-relaxed sm:line-clamp-3 sm:text-300">{v.expectedOutcome}</dd>
          </div>
        </dl>
      ) : (
        <div className="mt-5 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-200 text-muted-foreground">
        <span className="flex items-center gap-3 tabular-nums">
          <span className="flex items-center gap-1"><ThumbsUp aria-hidden className="size-4" />{idea.feedback.up}</span>
          <span className="flex items-center gap-1"><ThumbsDown aria-hidden className="size-4" />{idea.feedback.down}</span>
          {idea.commentCount > 0 ? (
            <span className="flex items-center gap-1"><MessageSquare aria-hidden className="size-4" />{idea.commentCount}</span>
          ) : null}
        </span>
        <Link to={`/ideas/${idea.id}/overview`} className="inline-flex items-center gap-1 font-semibold">
          Read it all
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
    </div>
  );
}

function Finished({ tally, fresh }: { tally: { up: number; down: number; skipped: number }; fresh: boolean }) {
  const voted = tally.up + tally.down;
  return (
    <EmptyState
      title={fresh ? "You are all caught up" : "That's the lot"}
      description={
        fresh
          ? "There are no ranked ideas you have not reacted to yet. New ones appear here as they are scored."
          : `You weighed in on ${voted} ${voted === 1 ? "idea" : "ideas"}${
              tally.skipped > 0 ? ` and skipped ${tally.skipped}` : ""
            }. Thank you — the people behind them can see it.`
      }
      action={{ label: "Explore every idea", to: "/ideas" }}
      renderLink={link}
    />
  );
}

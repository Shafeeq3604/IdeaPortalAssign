import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Expand, Minimize, X } from "lucide-react";
import { Button, EmptyState, ErrorState, Skeleton } from "@iep/ui";
import type { ExplanationItem, RankingEntry } from "@iep/contracts";
import { useCountUp } from "../../app/use-count-up";
import { useRankings } from "./api";
import { RankDelta } from "./DashboardHero";

/**
 * Boardroom mode (P20 — SPEC §14 M4, D-25): the current board, one idea per slide, for a
 * meeting room screen.
 *
 * Nothing on a slide is new data. It is the same top-ten the board shows, at a size that
 * reads from the back of a room — and every slide carries the idea's "why it ranks here"
 * next to its rank, because a rank on a projector without its reason is exactly what P-2
 * forbids, only bigger.
 *
 * Keys: → / Space / PageDown next, ← / PageUp previous, Home / End, F full screen, Esc
 * leaves. A horizontal swipe does the same on a touch screen, and every one of those
 * has a visible button.
 */

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

/** A control on the fixed-dark presentation surface. */
const ON_STAGE = "text-grad-ink hover:bg-grad-ink/15 hover:text-grad-ink";

export function BoardroomPage() {
  const navigate = useNavigate();
  const board = useRankings({ page: 1, rankBand: "top10" });
  const slides = React.useMemo(
    () => [...(board.data?.items ?? [])].sort((a, b) => a.rank - b.rank),
    [board.data],
  );
  const [index, setIndex] = React.useState(0);
  const [direction, setDirection] = React.useState<"forward" | "back">("forward");
  const [fullScreen, setFullScreen] = React.useState(false);
  const stageRef = React.useRef<HTMLDivElement>(null);

  const go = React.useCallback(
    (next: number) => {
      if (slides.length === 0) return;
      const clamped = Math.max(0, Math.min(slides.length - 1, next));
      setDirection(clamped >= index ? "forward" : "back");
      setIndex(clamped);
    },
    [index, slides.length],
  );

  const leave = React.useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    void navigate("/rankings");
  }, [navigate]);

  const toggleFullScreen = React.useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void stageRef.current?.requestFullscreen?.().catch(() => undefined);
    }
  }, []);

  React.useEffect(() => {
    const onChange = () => setFullScreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
        case " ":
          e.preventDefault();
          go(index + 1);
          break;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          go(index - 1);
          break;
        case "Home":
          e.preventDefault();
          go(0);
          break;
        case "End":
          e.preventDefault();
          go(slides.length - 1);
          break;
        case "f":
        case "F":
          toggleFullScreen();
          break;
        case "Escape":
          // In full screen the browser spends Esc on leaving full screen; a second Esc leaves.
          if (!document.fullscreenElement) leave();
          break;
        default:
          break;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go, index, slides.length, leave, toggleFullScreen]);

  // The page behind the stage must not scroll while it is up.
  React.useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // A horizontal swipe on a touch screen.
  const start = React.useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") start.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - s.y)) go(index + (dx < 0 ? 1 : -1));
  };

  const slide = slides[index];
  const run = board.data?.run;

  return (
    <div
      ref={stageRef}
      role="dialog"
      aria-modal="true"
      aria-label="Boardroom"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      className="dash-hero fixed inset-0 z-50 flex flex-col overflow-hidden text-grad-ink"
    >
      <header className="relative flex items-center gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-8">
        <div className="min-w-0 flex-1">
          <p className="text-100 font-bold uppercase tracking-[0.14em] text-grad-ink-soft">Boardroom</p>
          <p className="truncate text-200 text-grad-ink-soft">
            {run
              ? `Top ${slides.length} · ${run.profileName} profile · as of ${new Date(run.computedAt).toLocaleDateString()}`
              : "The current board"}
          </p>
        </div>
        {slides.length > 0 ? (
          <p className="text-200 font-semibold tabular-nums" aria-live="polite">
            {index + 1} / {slides.length}
          </p>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={`hidden sm:inline-flex ${ON_STAGE}`}
          onClick={toggleFullScreen}
          aria-pressed={fullScreen}
        >
          {fullScreen ? <Minimize aria-hidden className="size-4" /> : <Expand aria-hidden className="size-4" />}
          {fullScreen ? "Exit full screen" : "Full screen"}
        </Button>
        <Button type="button" variant="ghost" size="sm" className={ON_STAGE} onClick={leave}>
          <X aria-hidden className="size-4" />
          Leave
        </Button>
      </header>

      <main className="relative flex min-h-0 flex-1 flex-col justify-center px-4 py-6 sm:px-12 lg:px-20">
        {board.isPending ? (
          <div className="mx-auto w-full max-w-5xl space-y-5" aria-busy="true">
            <Skeleton className="h-16 w-40 bg-grad-ink/15" />
            <Skeleton className="h-12 w-3/4 bg-grad-ink/15" />
            <Skeleton className="h-40 w-full bg-grad-ink/15" />
          </div>
        ) : board.isError ? (
          <div className="mx-auto w-full max-w-xl rounded-2xl bg-card p-2 text-foreground">
            <ErrorState
              title="Could not load the board"
              description="Nothing has been lost — this is the presentation failing to load."
              onRetry={() => void board.refetch()}
              escapeTo={{ label: "Back to rankings", to: "/rankings" }}
              renderLink={link}
            />
          </div>
        ) : !slide || !run ? (
          <div className="mx-auto w-full max-w-xl rounded-2xl bg-card p-2 text-foreground">
            <EmptyState
              title="Nothing ranked yet"
              description="Ideas appear here once their analysis finishes and a ranking run places them."
              action={{ label: "Back to rankings", to: "/rankings" }}
              renderLink={link}
            />
          </div>
        ) : (
          <Slide
            key={slide.ideaId}
            entry={slide}
            cohortSize={run.cohortSize}
            position={index + 1}
            count={slides.length}
            direction={direction}
          />
        )}
      </main>

      {slides.length > 0 ? (
        <footer className="relative flex items-center justify-between gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-8">
          <Button
            type="button"
            variant="ghost"
            className={ON_STAGE}
            onClick={() => go(index - 1)}
            disabled={index === 0}
          >
            <ArrowLeft aria-hidden className="size-4" />
            <span className="hidden sm:inline">Previous</span>
            <span className="sr-only sm:hidden">Previous</span>
          </Button>
          <div className="flex flex-wrap justify-center gap-1.5">
            {slides.map((s, i) => (
              <Button
                key={s.ideaId}
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Go to #${s.rank}, ${s.title}`}
                aria-current={i === index ? "step" : undefined}
                onClick={() => go(i)}
                className={`size-6 rounded-full p-0 hover:bg-grad-ink/15 ${ON_STAGE}`}
              >
                <span
                  aria-hidden
                  className={`block rounded-full transition-all duration-[var(--dur-base)] ${
                    i === index ? "h-2.5 w-2.5 bg-grad-highlight" : "h-2 w-2 bg-grad-ink/35"
                  }`}
                />
              </Button>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            className={ON_STAGE}
            onClick={() => go(index + 1)}
            disabled={index === slides.length - 1}
          >
            <span className="hidden sm:inline">Next</span>
            <span className="sr-only sm:hidden">Next</span>
            <ArrowRight aria-hidden className="size-4" />
          </Button>
        </footer>
      ) : null}
    </div>
  );
}

function Slide({
  entry, cohortSize, position, count, direction,
}: {
  entry: RankingEntry;
  cohortSize: number;
  position: number;
  count: number;
  direction: "forward" | "back";
}) {
  const score = useCountUp(entry.compositeScore);
  const same =
    entry.topStrength !== null &&
    entry.topConstraint !== null &&
    entry.topStrength.criterionKey === entry.topConstraint.criterionKey;

  return (
    <article
      aria-roledescription="slide"
      aria-label={`${position} of ${count}: ranked ${entry.rank} of ${cohortSize}, ${entry.title}`}
      className={`slide-in ${direction === "back" ? "slide-in--back" : ""} mx-auto grid w-full max-w-6xl gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end`}
    >
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-3">
          <span className="font-serif text-800 font-extrabold leading-none tabular-nums text-grad-highlight">
            #{entry.rank}
          </span>
          <span className="text-300 text-grad-ink-soft">of {cohortSize} ranked</span>
          <RankDelta rank={entry.rank} previousRank={entry.previousRank} onBrand />
        </p>
        <h1 className="mt-4 text-balance font-serif text-700 font-extrabold leading-tight text-grad-ink">
          {entry.title}
        </h1>
        <p className="mt-2 text-300 text-grad-ink-soft">
          {entry.submitter.displayName}
          {entry.department ? ` · ${entry.department}` : ""}
        </p>

        <section aria-label="Why it ranks here" className="mt-8 grid gap-4 sm:grid-cols-2">
          {same ? (
            <Reason tone="neutral" label="Decides this rank" item={entry.topStrength} wide />
          ) : (
            <>
              <Reason tone="up" label="Strongest" item={entry.topStrength} />
              <Reason tone="down" label="Limiting factor" item={entry.topConstraint} />
            </>
          )}
        </section>
      </div>

      <div className="flex items-end gap-6 lg:flex-col lg:items-end">
        <div className="reveal-glow rounded-3xl bg-grad-ink/10 px-8 py-6 text-right ring-1 ring-grad-rule">
          <p className="text-100 font-bold uppercase tracking-[0.14em] text-grad-ink-soft">Score</p>
          <p className="font-serif text-800 font-extrabold leading-none tabular-nums">
            {score.toFixed(1)}
          </p>
          <p className="mt-1 text-200 text-grad-ink-soft">out of 100</p>
        </div>
        <Link
          to={`/ideas/${entry.ideaId}/evaluation`}
          className="inline-flex items-center gap-1.5 text-200 font-semibold text-grad-highlight hover:underline"
        >
          Open the full evaluation
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
    </article>
  );
}

function Reason({
  tone, label, item, wide = false,
}: {
  tone: "up" | "down" | "neutral";
  label: string;
  item: ExplanationItem | null;
  wide?: boolean;
}) {
  const figure =
    item && item.normalized !== undefined
      ? tone === "down"
        ? `${item.normalized}/100 · ${(item.headroom ?? 0).toFixed(1)} pts available`
        : `${item.normalized}/100 · +${item.contribution.toFixed(1)} pts`
      : null;
  return (
    <div className={`rounded-2xl bg-grad-ink/10 p-5 ring-1 ring-grad-rule ${wide ? "sm:col-span-2" : ""}`}>
      <p className="text-100 font-bold uppercase tracking-[0.14em] text-grad-ink-soft">{label}</p>
      {item ? (
        <>
          <p className="mt-1.5 text-500 font-bold leading-snug">{item.criterionLabel}</p>
          {figure ? <p className="mt-1 text-300 tabular-nums text-grad-ink-soft">{figure}</p> : null}
          <p className="mt-2 text-200 text-grad-ink-soft">{item.text}</p>
        </>
      ) : (
        <p className="mt-1.5 text-300 text-grad-ink-soft">
          {tone === "down" ? "Nothing held it back." : "No criterion stood out."}
        </p>
      )}
    </div>
  );
}

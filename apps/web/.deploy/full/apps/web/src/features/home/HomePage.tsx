import * as React from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Bell, Clock, Compass, Hand, LayoutDashboard, ListChecks, Map as MapIcon, PenSquare,
  Presentation, Sparkles, TrendingUp,
} from "lucide-react";
import { Button, Skeleton, StatusPill } from "@iep/ui";
import type { IdeaStatus, IdeaSummary, Role } from "@iep/contracts";
import { useSession } from "../../app/use-session";
import { useNotifications } from "../notifications/api";
import { STATUS_LABEL, useIdeaList } from "../ideas/api";
import { WEIGH_IN_STATUSES, swipeDeck } from "../ideas/swipe-deck";
import { useDashboard, useRankings } from "../rankings/api";
import { useReviewQueue } from "../review/api";
import { describeSince, useLastVisit } from "./last-visit";
import { IdeasImpactSection } from "../delivery/ImpactCard";

/**
 * Home (P20 — SPEC §14 M4, D-25). `/` used to redirect to the ideas list; it is now a
 * page shaped by the roles the person holds, highest first — leadership, then review,
 * then the part everyone has: your own ideas, and other people's to weigh in on.
 *
 * Every figure comes from an endpoint the rest of the app already uses, and every one
 * links to the list it came from (the dashboard's own rule, SPEC §6.2 row 40).
 */

const LEADERSHIP: readonly Role[] = ["MANAGEMENT", "ADMIN"];
const REVIEWERS: readonly Role[] = ["REVIEWER", "ADMIN"];

function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function HomePage() {
  const { data } = useSession();
  const user = data?.user;
  const roles = user?.roles ?? [];
  const lastVisit = useLastVisit(user?.id);
  const isLeader = roles.some((r) => LEADERSHIP.includes(r));
  const isReviewer = roles.some((r) => REVIEWERS.includes(r));

  if (!user) return <main className="page" aria-busy="true"><Skeleton className="h-40 w-full" /></main>;

  const firstName = user.displayName.split(/\s+/)[0] ?? user.displayName;

  return (
    <main className="page">
      <section className="dash-hero relative overflow-hidden rounded-3xl px-6 py-7 text-grad-ink sm:px-8 sm:py-9">
        <p className="relative text-100 font-bold uppercase tracking-[0.14em] text-grad-ink-soft">
          {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
        </p>
        <h1 className="relative mt-2 text-balance font-serif text-700 font-extrabold leading-tight text-grad-ink">
          {greeting()}, {firstName}
        </h1>
        <p className="relative mt-2 max-w-[60ch] text-300 text-grad-ink-soft">
          {isLeader
            ? "Here is what is waiting on a decision, and where the portfolio stands."
            : isReviewer
              ? "Here is what is waiting for a reviewer, and how your own ideas are doing."
              : "Here is how your ideas are doing, and what others are proposing."}
        </p>
        <div className="relative mt-5 flex flex-wrap gap-2.5">
          <Button asChild className="bg-grad-highlight text-grad-from hover:bg-grad-highlight/90">
            <Link to="/ideas/new" className="no-underline">
              <PenSquare aria-hidden className="size-4" />
              Submit an idea
            </Link>
          </Button>
          <Button asChild variant="ghost" className="text-grad-ink ring-1 ring-inset ring-grad-rule hover:bg-grad-ink/15 hover:text-grad-ink">
            <Link to="/ideas/swipe" className="no-underline">
              <Hand aria-hidden className="size-4" />
              Weigh in on ideas
            </Link>
          </Button>
        </div>
      </section>

      <SinceLastVisit userId={user.id} lastVisit={lastVisit} />

      <div className="mt-6 flex flex-col gap-6">
        {isLeader ? <LeadershipSection /> : null}
        {isReviewer ? <ReviewerSection /> : null}
        <IdeasImpactSection submitterId={user.id} heading="What your ideas achieved" />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <MyIdeasSection userId={user.id} />
          <WeighInSection userId={user.id} />
        </div>
      </div>
    </main>
  );
}

/* ── Since you were last here ── */

function SinceLastVisit({ userId, lastVisit }: { userId: string; lastVisit: Date | null }) {
  const unread = useNotifications({ page: 1, unread: true });
  const recent = useIdeaList({ sort: "recent", perPage: 50 });
  const mine = useIdeaList({ submitterId: userId, sort: "recent", perPage: 50 });
  const board = useRankings({ page: 1, rankBand: "all" });

  const changed = lastVisit
    ? (recent.data?.items ?? []).filter((i) => new Date(i.updatedAt) > lastVisit && i.submitter.id !== userId)
    : [];
  const myIds = new Set((mine.data?.items ?? []).map((i) => i.id));
  // Rank movement is only ever "since the previous ranking run" — that is what
  // `previousRank` measures, whatever the time of the person's last visit.
  const moved = (board.data?.items ?? []).filter(
    (e) => myIds.has(e.ideaId) && e.previousRank !== null && e.previousRank !== e.rank,
  );
  const unreadCount = unread.data?.unreadCount ?? 0;
  const loading = unread.isPending || recent.isPending;

  return (
    <section aria-labelledby="since-heading" className="mt-6 rounded-2xl bg-card p-5 shadow-e2 ring-1 ring-inset ring-border sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="since-heading" className="flex items-center gap-2 text-400 font-extrabold">
          <Clock aria-hidden className="size-5 text-accent-700" />
          {lastVisit ? "Since you were last here" : "Where things stand"}
        </h2>
        {lastVisit ? (
          <p className="text-100 text-muted-foreground">Your last visit on this device was {describeSince(lastVisit)}.</p>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : (
        <ul className="motion-reveal mt-4 grid list-none gap-3 p-0 lg:grid-cols-3">
          <li>
            <SinceTile
              to="/notifications?unread=true"
              icon={Bell}
              figure={unreadCount}
              label={unreadCount === 1 ? "unread notification" : "unread notifications"}
              note={unread.data?.items[0]?.title ?? "Nothing new for you"}
            />
          </li>
          <li>
            <SinceTile
              to="/ideas?sort=recent"
              icon={Sparkles}
              figure={lastVisit ? changed.length : (recent.data?.meta.total ?? 0)}
              label={lastVisit ? (changed.length === 1 ? "idea changed" : "ideas changed") : "ideas you can see"}
              note={
                lastVisit
                  ? changed[0]
                    ? `Latest: ${changed[0].title}`
                    : "Nothing else has moved"
                  : "Explore them all"
              }
            />
          </li>
          <li>
            <SinceTile
              to="/rankings"
              icon={TrendingUp}
              figure={moved.length}
              label="of your ideas moved rank"
              note={
                moved[0] && moved[0].previousRank !== null
                  ? `${moved[0].title}: #${moved[0].previousRank} → #${moved[0].rank}, on the latest ranking run`
                  : "On the latest ranking run"
              }
            />
          </li>
        </ul>
      )}
    </section>
  );
}

function SinceTile({
  to, icon: Icon, figure, label, note,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  figure: number;
  label: string;
  note: string;
}) {
  return (
    <Link
      to={to}
      className="flex h-full items-start gap-3 rounded-xl border border-border bg-muted/50 p-4 text-foreground no-underline transition-colors duration-[var(--dur-fast)] hover:bg-muted"
    >
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-100 text-accent-700">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-serif text-500 font-extrabold leading-none tabular-nums">{figure}</span>
        <span className="mt-1 block text-200 font-semibold">{label}</span>
        <span className="mt-0.5 block truncate text-100 text-muted-foreground" title={note}>{note}</span>
      </span>
    </Link>
  );
}

/* ── Leadership ── */

function LeadershipSection() {
  const dashboard = useDashboard();
  const board = useRankings({ page: 1, rankBand: "top10" });
  const tiles = new Map((dashboard.data?.tiles ?? []).map((t) => [t.key, t]));
  const top = (board.data?.items ?? []).slice().sort((a, b) => a.rank - b.rank).slice(0, 3);
  const waiting = [tiles.get("requiring_review"), tiles.get("prototype"), tiles.get("pilot")].filter(
    (t): t is NonNullable<typeof t> => t !== undefined,
  );

  return (
    <section aria-labelledby="lead-heading" className="rounded-2xl bg-card p-5 shadow-e2 ring-1 ring-inset ring-border sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="lead-heading" className="flex items-center gap-2 text-400 font-extrabold">
          <LayoutDashboard aria-hidden className="size-5 text-accent-700" />
          For leadership
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/rankings/boardroom" className="no-underline">
              <Presentation aria-hidden className="size-4" />
              Present the top ten
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/analytics#portfolio-map" className="no-underline">
              <MapIcon aria-hidden className="size-4" />
              Portfolio map
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/dashboard" className="no-underline">
              Full dashboard
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div>
          <h3 className="text-100 font-bold uppercase tracking-[0.08em] text-muted-foreground">Waiting on a person</h3>
          {dashboard.isPending ? (
            <Skeleton className="mt-2 h-32 w-full" />
          ) : (
            <ul className="mt-2 flex list-none flex-col gap-2 p-0">
              {waiting.map((t) => (
                <li key={t.key}>
                  <Link
                    to={t.href}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/50 px-4 py-3 text-foreground no-underline hover:bg-muted"
                  >
                    <span className="text-200 font-semibold">{t.label}</span>
                    <span className="font-serif text-500 font-bold tabular-nums">{t.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="text-100 font-bold uppercase tracking-[0.08em] text-muted-foreground">Top of the board</h3>
          {board.isPending ? (
            <Skeleton className="mt-2 h-32 w-full" />
          ) : top.length === 0 ? (
            <p className="mt-2 text-200 text-muted-foreground">Nothing is ranked yet.</p>
          ) : (
            <ol className="mt-2 flex list-none flex-col gap-2 p-0">
              {top.map((e) => (
                <li key={e.ideaId}>
                  <Link
                    to={`/ideas/${e.ideaId}/evaluation`}
                    className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border px-4 py-3 text-foreground no-underline hover:bg-muted"
                  >
                    <span className="font-serif text-400 font-bold tabular-nums text-muted-foreground">#{e.rank}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-200 font-semibold">{e.title}</span>
                      <span className="block truncate text-100 text-muted-foreground">
                        {e.topStrength ? `Strongest: ${e.topStrength.criterionLabel}` : e.department ?? ""}
                      </span>
                    </span>
                    <span className="font-serif text-400 font-bold tabular-nums text-accent-700">
                      {e.compositeScore.toFixed(1)}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}

/* ── Reviewer ── */

function ReviewerSection() {
  const queue = useReviewQueue({ page: 1, sort: "oldest" });
  const items = (queue.data?.items ?? []).slice(0, 5);
  const total = queue.data?.meta.total ?? 0;

  return (
    <section aria-labelledby="review-heading" className="rounded-2xl bg-card p-5 shadow-e2 ring-1 ring-inset ring-border sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="review-heading" className="flex items-center gap-2 text-400 font-extrabold">
          <ListChecks aria-hidden className="size-5 text-state-warn" />
          Your review queue
          {queue.data ? <span className="text-300 font-semibold tabular-nums text-muted-foreground">· {total} waiting</span> : null}
        </h2>
        <Button asChild variant="ghost" size="sm">
          <Link to="/review" className="no-underline">
            Open the queue
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </Button>
      </div>
      {queue.isPending ? (
        <Skeleton className="mt-4 h-40 w-full" />
      ) : items.length === 0 ? (
        <p className="mt-3 text-200 text-muted-foreground">Nothing is waiting for a reviewer.</p>
      ) : (
        <ul className="mt-4 flex list-none flex-col gap-2 p-0">
          {items.map((item) => (
            <li key={item.ideaId}>
              <Link
                to={`/ideas/${item.ideaId}/review`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border px-4 py-3 text-foreground no-underline hover:bg-muted"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-200 font-semibold">{item.title}</span>
                  <span className="block truncate text-100 text-muted-foreground">
                    {item.submitter.displayName}
                    {item.department ? ` · ${item.department.name}` : ""}
                  </span>
                </span>
                {item.hasUnvalidatedAi ? (
                  <span className="rounded-full bg-state-warn-bg px-2 py-0.5 text-100 font-semibold text-state-warn">
                    AI findings not yet validated
                  </span>
                ) : null}
                <span className="text-100 font-semibold tabular-nums text-muted-foreground">
                  {item.waitingDays === 0 ? "today" : `${item.waitingDays} ${item.waitingDays === 1 ? "day" : "days"} waiting`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ── Everyone: your ideas ── */

/** The main road an idea travels. Anything off it (parked, blocked, rejected…) shows its pill only. */
const JOURNEY: readonly IdeaStatus[] = [
  "SUBMITTED", "AI_ANALYSIS", "EVALUATED", "RANKED", "UNDER_REVIEW",
  "PROTOTYPE_CANDIDATE", "PILOT", "PRODUCTION_CANDIDATE", "IMPLEMENTED",
];

function MyIdeasSection({ userId }: { userId: string }) {
  const mine = useIdeaList({ submitterId: userId, sort: "recent", perPage: 6 });
  const items = mine.data?.items ?? [];

  return (
    <section aria-labelledby="mine-heading" className="rounded-2xl bg-card p-5 shadow-e2 ring-1 ring-inset ring-border sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="mine-heading" className="flex items-center gap-2 text-400 font-extrabold">
          <PenSquare aria-hidden className="size-5 text-accent-700" />
          Your ideas
        </h2>
        <Button asChild variant="ghost" size="sm">
          <Link to="/me/ideas" className="no-underline">
            All of them
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </Button>
      </div>
      {mine.isPending ? (
        <Skeleton className="mt-4 h-48 w-full" />
      ) : items.length === 0 ? (
        <div className="mt-3">
          <p className="text-200 text-muted-foreground">
            You have not submitted an idea yet. Describe a problem in your own words — the
            platform structures it, analyses it and tells you how it scores.
          </p>
          <Button asChild className="mt-3">
            <Link to="/ideas/new" className="no-underline">Start one</Link>
          </Button>
        </div>
      ) : (
        <ul className="motion-reveal mt-4 flex list-none flex-col gap-2.5 p-0">
          {items.map((idea) => <MyIdeaRow key={idea.id} idea={idea} />)}
        </ul>
      )}
    </section>
  );
}

function MyIdeaRow({ idea }: { idea: IdeaSummary }) {
  const step = JOURNEY.indexOf(idea.status);
  return (
    <li>
      <Link to={`/ideas/${idea.id}/overview`} className="block rounded-xl border border-border px-4 py-3 text-foreground no-underline hover:bg-muted">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 flex-1 truncate text-200 font-semibold">{idea.title}</span>
          <StatusPill kind="LIFECYCLE" status={idea.status} label={STATUS_LABEL[idea.status]} />
        </span>
        {step >= 0 ? (
          <span className="mt-2.5 flex items-center gap-3">
            <span
              aria-hidden
              className="grid flex-1 gap-1"
              style={{ gridTemplateColumns: `repeat(${JOURNEY.length}, minmax(0, 1fr))` }}
            >
              {JOURNEY.map((s, i) => (
                <span key={s} className={`h-1.5 rounded-full ${i <= step ? "bg-accent-600" : "bg-muted"}`} />
              ))}
            </span>
            <span className="shrink-0 text-100 tabular-nums text-muted-foreground">
              Step {step + 1} of {JOURNEY.length}
              {idea.rank ? ` · #${idea.rank}` : ""}
            </span>
          </span>
        ) : null}
      </Link>
    </li>
  );
}

/* ── Everyone: weigh in ── */

function WeighInSection({ userId }: { userId: string }) {
  // Same query as the swipe page, so opening it is instant.
  const list = useIdeaList({ status: WEIGH_IN_STATUSES, sort: "rank", perPage: 50 });
  const deck = list.data ? swipeDeck(list.data.items, userId) : [];

  return (
    <section aria-labelledby="weigh-heading" className="flex flex-col rounded-2xl bg-card p-5 shadow-e2 ring-1 ring-inset ring-border sm:p-6">
      <h2 id="weigh-heading" className="flex items-center gap-2 text-400 font-extrabold">
        <Hand aria-hidden className="size-5 text-accent-700" />
        Weigh in
      </h2>
      {list.isPending ? (
        <Skeleton className="mt-4 h-24 w-full" />
      ) : (
        <>
          <p className="mt-2 text-200 text-muted-foreground">
            {deck.length === 0
              ? "You have reacted to every ranked idea you can see. New ones appear as they are scored."
              : `${deck.length} ranked ${deck.length === 1 ? "idea is" : "ideas are"} waiting for your thumbs up or down. It takes a few seconds each, and it never changes a score.`}
          </p>
          <ul className="mt-3 flex list-none flex-col gap-1.5 p-0">
            {deck.slice(0, 3).map((i) => (
              <li key={i.id} className="truncate text-200">
                <Link to={`/ideas/${i.id}/overview`}>{i.title}</Link>
              </li>
            ))}
          </ul>
          <div className="mt-auto flex flex-wrap gap-2 pt-4">
            {deck.length > 0 ? (
              <Button asChild>
                <Link to="/ideas/swipe" className="no-underline">
                  <Hand aria-hidden className="size-4" />
                  Start weighing in
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <Link to="/ideas" className="no-underline">
                <Compass aria-hidden className="size-4" />
                Explore ideas
              </Link>
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Clock, Scale, ShieldAlert, SlidersHorizontal, Target, TrendingUp, Users, Wrench,
} from "lucide-react";
import {
  Badge, Card, CardContent, CardHeader, CardTitle, ErrorState, Skeleton, Table, TableBody,
  TableCell, TableHead, TableHeader, TableRow,
} from "@iep/ui";
import type { CriterionGroup, ListCriteriaResponse, ListProfilesResponse } from "@iep/contracts";
import { api } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";
import { GROUP_LABEL } from "../evaluation/api";
import { PageHeading } from "../../app/PageHero";

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

/**
 * Config viewer, read-only (P9 — FR-13, SPEC §9.10).
 *
 * These pages exist because of D-06: without them every score in MVP1 would be
 * unexplainable at source. A criterion row on the Evaluation tab links here, and here is
 * where "why does this weigh 18%?" is answered.
 *
 * Read-only in M1. Editing is P10, and the API already answers 501 for it — an explicit
 * deferral rather than a button that does nothing.
 */

const GROUP_ORDER: readonly CriterionGroup[] = [
  "VALUE", "FEASIBILITY", "EFFORT", "STRATEGIC", "RISK", "DEMAND",
];

/**
 * A colour per group, purely categorical — like the pipeline tiles on the dashboard,
 * not a verdict. RISK deliberately gets the neutral tone rather than a warm one: P-1 is
 * explicit that effort and risk are not faults, and DIRECTION_HELP already says so in
 * words below — the last thing this page needs is a colour quietly taking that back.
 */
const GROUP_STYLE: Record<CriterionGroup, { icon: typeof TrendingUp; tone: string }> = {
  VALUE: { icon: TrendingUp, tone: "bg-accent-050 text-accent-700" },
  FEASIBILITY: { icon: Wrench, tone: "bg-state-info-bg text-state-info" },
  EFFORT: { icon: Clock, tone: "bg-ramp-1 text-accent-700" },
  STRATEGIC: { icon: Target, tone: "bg-state-warn-bg text-state-warn" },
  RISK: { icon: ShieldAlert, tone: "bg-muted text-muted-foreground" },
  DEMAND: { icon: Users, tone: "bg-accent-100 text-accent-700" },
};

const DIRECTION_HELP: Record<string, string> = {
  HIGHER_IS_BETTER: "A higher score raises the rank.",
  // The wording matters: effort and risk are not faults, and this line is the one place
  // the product says so explicitly (P-1).
  LOWER_IS_BETTER: "A lower value scores higher. Not a judgement — cheap and low-risk simply rank better.",
};

export function CriteriaPage() {
  const query = useQuery({
    queryKey: queryKeys.config.criteria(),
    queryFn: () => api<ListCriteriaResponse>("/config/criteria"),
    staleTime: 5 * 60_000,
  });

  /**
   * "Weighted in 4 profiles" answered the wrong question — a reviewer scanning this page
   * wants to know how much a criterion matters under the profile the board is ACTUALLY
   * using right now, not how many profiles happen to reference it at all. That number
   * already lives on `/config/profiles`; fetching it here too (same cache key, same
   * 5-minute staleTime as the profiles page itself, so this costs nothing extra once
   * either page has been visited) lets this page answer both questions on one line.
   */
  const profiles = useQuery({
    queryKey: queryKeys.config.profiles(),
    queryFn: () => api<ListProfilesResponse>("/config/profiles"),
    staleTime: 5 * 60_000,
  });
  const defaultProfile = profiles.data?.items.find((p) => p.isDefault) ?? profiles.data?.items[0];
  const weightOf = (criterionKey: string): number | undefined =>
    defaultProfile?.weights.find((w) => w.criterionKey === criterionKey)?.weight;

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/">Home</Link>  ›  Evaluation criteria
      </nav>
      <PageHeading
        icon={SlidersHorizontal}
        heading="Evaluation criteria"
        description="Every score in the platform comes from these. Each one is scored 0–100 from the analysis, then weighted by whichever profile is in use."
      />

      {query.isPending ? (
        <Skeleton className="mt-6 h-96 w-full" aria-busy="true" />
      ) : query.isError ? (
        <ErrorState
          title="Could not load the criteria"
          description="The scores themselves are unaffected — this is the reference page failing to load."
          onRetry={() => void query.refetch()}
          escapeTo={{ label: "Back to ideas", to: "/ideas" }}
          renderLink={link}
        />
      ) : (
        <div className="mt-6 space-y-8">
          {/*
            A category is a GROUPING, not a thing anyone picks up or compares against its
            neighbours — the twelve criteria on this page were the clearest case in the
            product of a static list wearing the same card recipe as an idea someone
            clicks, drags a checkbox onto, or reads off a board. A heading, a rule, and a
            divided list carry the same hierarchy (category → criterion → detail) without
            claiming each of six categories is its own separate object on the page.
          */}
          {GROUP_ORDER.filter((g) => query.data.items.some((c) => c.group === g)).map((group) => {
            const { icon: GroupIcon, tone } = GROUP_STYLE[group];
            return (
            <section key={group}>
              <h2 className="flex items-center gap-2.5 text-400 font-semibold">
                <span aria-hidden className={`grid size-7 shrink-0 place-items-center rounded-md ${tone}`}>
                  <GroupIcon className="size-4" />
                </span>
                {GROUP_LABEL[group]}
              </h2>
              <div className="mt-3 divide-y divide-border border-t border-border">
                {query.data.items
                  .filter((c) => c.group === group)
                  .map((c) => (
                    // The anchor is what a criterion link on the Evaluation tab targets.
                    <div key={c.key} id={c.key} className="py-4 first:pt-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-300 font-medium">{c.label}</h3>
                        {!c.isActive ? <Badge variant="outline">Not in use</Badge> : null}
                      </div>
                      <p className="text-200">{c.description}</p>
                      <p className="mt-1 text-100 text-muted-foreground">
                        {DIRECTION_HELP[c.direction] ?? c.direction}
                      </p>
                      <p className="mt-1 text-100 text-muted-foreground">
                        {c.usedInProfiles.length === 0 ? (
                          "No profile currently gives this any weight, so it cannot affect a rank."
                        ) : (
                          <>
                            {defaultProfile && weightOf(c.key) !== undefined ? (
                              <>
                                <span className="font-semibold tabular-nums text-foreground">
                                  {(weightOf(c.key)! * 100).toFixed(0)}%
                                </span>{" "}
                                under the {defaultProfile.name} profile — weighted in{" "}
                              </>
                            ) : (
                              "Weighted in "
                            )}
                            <Link to="/config/profiles">
                              {c.usedInProfiles.length} profile
                              {c.usedInProfiles.length === 1 ? "" : "s"}
                            </Link>{" "}
                            in total.
                          </>
                        )}
                      </p>
                    </div>
                  ))}
              </div>
            </section>
            );
          })}

          <p className="text-100 text-muted-foreground">
            These are configuration, not code. Changing them is an admin action that
            arrives in a later milestone; until then they are shown read-only so every
            number stays traceable to its rule.
          </p>
        </div>
      )}
    </main>
  );
}

export function ProfilesPage() {
  const query = useQuery({
    queryKey: queryKeys.config.profiles(),
    queryFn: () => api<ListProfilesResponse>("/config/profiles"),
    staleTime: 5 * 60_000,
  });

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/">Home</Link>  ›  Evaluation profiles
      </nav>
      <PageHeading
        icon={Scale}
        heading="Evaluation profiles"
        description="A profile decides what matters. The same idea can rank differently under two of them, and neither ranking is wrong — they are answers to different questions."
      />

      {query.isPending ? (
        <Skeleton className="mt-6 h-96 w-full" aria-busy="true" />
      ) : query.isError ? (
        <ErrorState
          title="Could not load the profiles"
          description="The rankings themselves are unaffected — this is the reference page failing to load."
          onRetry={() => void query.refetch()}
          escapeTo={{ label: "Back to ideas", to: "/ideas" }}
          renderLink={link}
        />
      ) : (
        <div className="mt-6 space-y-6">
          {query.data.items.map((profile) => {
            const sum = profile.weights.reduce((acc, w) => acc + w.weight, 0);
            return (
              <Card key={profile.key}>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="font-serif">{profile.name}</CardTitle>
                    {profile.isDefault ? <Badge>Default</Badge> : null}
                    {!profile.isActive ? <Badge variant="outline">Not in use</Badge> : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-200">{profile.description}</p>

                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Criterion</TableHead>
                          {/* A weight IS a proportion of the whole, so it gets a bar, not
                              only a number (visual-richness pass — a real, meaningful
                              data visualization instead of a column of percentages). */}
                          <TableHead className="w-56">Weight</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[...profile.weights]
                          .sort((a, b) => b.weight - a.weight)
                          .map((w) => (
                            <TableRow key={w.criterionKey}>
                              <TableCell>
                                <Link to={`/config/criteria#${w.criterionKey}`}>
                                  {w.criterionLabel}
                                </Link>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2.5">
                                  <span className="w-12 shrink-0 text-right tabular-nums">
                                    {(w.weight * 100).toFixed(1)}%
                                  </span>
                                  <span
                                    aria-hidden
                                    className="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-ramp-1"
                                  >
                                    <span
                                      className="block h-full rounded-full bg-gradient-to-r from-ramp-4 to-accent-700"
                                      style={{ width: `${Math.max(2, w.weight * 100)}%` }}
                                    />
                                  </span>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/*
                    Weights must sum to 100% (FR-13) — a database trigger enforces it.
                    Showing the total is how a reader can see that for themselves rather
                    than take it on trust.
                  */}
                  <p className="text-100 text-muted-foreground">
                    Totals {(sum * 100).toFixed(1)}%
                    {Math.abs(sum - 1) > 0.001 ? " — this does not add up to 100%, which is a defect." : "."}
                  </p>

                  <p className="text-100">
                    <Link to={`/rankings?profile=${profile.key}`}>
                      See the board weighted this way
                    </Link>
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}

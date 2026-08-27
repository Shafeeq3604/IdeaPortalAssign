import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Badge, Card, CardContent, CardHeader, CardTitle, ErrorState, Skeleton, Table, TableBody,
  TableCell, TableHead, TableHeader, TableRow,
} from "@iep/ui";
import type { CriterionGroup, ListCriteriaResponse, ListProfilesResponse } from "@iep/contracts";
import { api } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";
import { GROUP_LABEL } from "../evaluation/api";

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

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/ideas">Ideas</Link>  ›  Evaluation criteria
      </nav>
      <h1>Evaluation criteria</h1>
      <p className="muted">
        Every score in the platform comes from these. Each one is scored 0–100 from the
        analysis, then weighted by whichever profile is in use.
      </p>

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
        <div className="mt-6 space-y-6">
          {GROUP_ORDER.filter((g) => query.data.items.some((c) => c.group === g)).map((group) => (
            <Card key={group}>
              <CardHeader><CardTitle>{GROUP_LABEL[group]}</CardTitle></CardHeader>
              <CardContent className="space-y-5">
                {query.data.items
                  .filter((c) => c.group === group)
                  .map((c) => (
                    // The anchor is what a criterion link on the Evaluation tab targets.
                    <section key={c.key} id={c.key}>
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
                            Weighted in{" "}
                            <Link to="/config/profiles">
                              {c.usedInProfiles.length} profile
                              {c.usedInProfiles.length === 1 ? "" : "s"}
                            </Link>
                            .
                          </>
                        )}
                      </p>
                    </section>
                  ))}
              </CardContent>
            </Card>
          ))}

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
        <Link to="/ideas">Ideas</Link>  ›  Evaluation profiles
      </nav>
      <h1>Evaluation profiles</h1>
      <p className="muted">
        A profile decides what matters. The same idea can rank differently under two of
        them, and neither ranking is wrong — they are answers to different questions.
      </p>

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
                    <CardTitle>{profile.name}</CardTitle>
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
                          <TableHead className="text-right">Weight</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {profile.weights.map((w) => (
                          <TableRow key={w.criterionKey}>
                            <TableCell>
                              <Link to={`/config/criteria#${w.criterionKey}`}>
                                {w.criterionLabel}
                              </Link>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {(w.weight * 100).toFixed(1)}%
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

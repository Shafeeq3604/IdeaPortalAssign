import type { Role } from "./enums.js";

/**
 * The Navigation & Clickability Contract (SPEC §6). FROZEN AT P0.
 *
 * This file is consumed by BOTH the router and `pnpm test:nav`. That is the whole point:
 * a relationship that exists in the data model but not here is a build failure, and a
 * screen that exists in the router but not here is also a build failure.
 *
 * MUST-level, not polish (SPEC §6.3):
 *   1. every entity reachable (per role)   2. no orphans   3. no dead-ends
 *   4. back is honest                      5. breadcrumbs derived, not hand-written
 */

export type Affordance =
  | "nav"          // primary navigation item
  | "row"          // whole table/list row is clickable
  | "tab"          // tab bar within a detail page
  | "chip"         // inline chip / pill in a header or body
  | "link"         // inline text link
  | "tile"         // dashboard tile
  | "button"       // explicit action control
  | "breadcrumb"   // ancestor crumb
  | "inline";      // always rendered in place; no click required (e.g. explanations)

export interface RouteDef {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  /** Roles that may reach this route. Empty = all authenticated. */
  readonly roles: readonly Role[];
  /** Where "back" goes when there is no history. Null only for roots. */
  readonly backPath: string | null;
  /** Entity types this route renders — drives the reachability assertion. */
  readonly renders: readonly string[];
  /** URL search params this route owns. Must have a schema in search-params.ts. */
  readonly searchParams?: readonly string[];
}

export interface RelationshipDef {
  /** Row number in SPEC §6.2 — keeps doc and code greppable against each other. */
  readonly spec: number;
  readonly from: string;
  readonly to: string;
  readonly affordance: Affordance;
  readonly destinationRouteId: string;
  readonly note?: string;
}

const ALL: readonly Role[] = [];
const REVIEWERS: readonly Role[] = ["REVIEWER", "ADMIN"];
const LEADERSHIP: readonly Role[] = ["MANAGEMENT", "ADMIN"];
const ADMIN_ONLY: readonly Role[] = ["ADMIN"];

export const ROUTES: readonly RouteDef[] = [
  { id: "login", path: "/login", title: "Sign in", roles: ALL, backPath: null, renders: [] },
  { id: "home", path: "/", title: "Home", roles: ALL, backPath: null, renders: [] },

  { id: "ideas", path: "/ideas", title: "Ideas", roles: ALL, backPath: "/", renders: ["Idea", "IdeaCategory"],
    searchParams: ["status", "department", "category", "q", "sort", "page"] },
  { id: "ideas.new", path: "/ideas/new", title: "Submit an idea", roles: ALL, backPath: "/ideas", renders: ["IdeaVersion", "Attachment"] },
  { id: "me.ideas", path: "/me/ideas", title: "My ideas", roles: ALL, backPath: "/", renders: ["Idea"] },

  { id: "idea.overview", path: "/ideas/:ideaId/overview", title: "Overview", roles: ALL, backPath: "/ideas",
    renders: ["Idea", "IdeaVersion", "AiStructuredProposal", "UseCase", "AiAnalysis"] },
  { id: "idea.analysis", path: "/ideas/:ideaId/analysis", title: "Analysis", roles: ALL, backPath: "/ideas",
    renders: ["ValueFinding", "FeasibilityAssessment", "FeasibilityFinding", "Risk", "Dependency",
              "ImplementationPlan", "ImplementationRequirement", "TimelineEstimate"] },
  { id: "idea.evaluation", path: "/ideas/:ideaId/evaluation", title: "Evaluation", roles: ALL, backPath: "/ideas",
    renders: ["Evaluation", "CriterionScore", "ScoreOverride", "RankingEntry", "RankingExplanation"] },
  { id: "idea.improve", path: "/ideas/:ideaId/improve", title: "Improve", roles: ALL, backPath: "/ideas",
    renders: ["ImprovementRecommendation"] },
  { id: "idea.history", path: "/ideas/:ideaId/history", title: "History", roles: ALL, backPath: "/ideas",
    renders: ["IdeaVersion", "StatusHistory", "Evaluation"], searchParams: ["diff"] },
  { id: "idea.review", path: "/ideas/:ideaId/review", title: "Review", roles: REVIEWERS, backPath: "/review",
    renders: ["Review", "CriterionScore", "ScoreOverride"] },
  { id: "idea.version", path: "/ideas/:ideaId/versions/:versionNo", title: "Version", roles: ALL,
    backPath: "/ideas/:ideaId/history", renders: ["IdeaVersion"] },
  { id: "idea.revise", path: "/ideas/:ideaId/revise", title: "Revise", roles: ALL,
    backPath: "/ideas/:ideaId/improve", renders: ["IdeaVersion"], searchParams: ["rec"] },

  { id: "rankings", path: "/rankings", title: "Rankings", roles: ALL, backPath: "/",
    renders: ["RankingRun", "RankingEntry", "RankingExplanation", "EvaluationProfile"],
    searchParams: ["profile", "department", "category", "status", "from", "to", "rankBand", "sort", "page", "compare"] },
  { id: "rankings.run", path: "/rankings/:runId", title: "Ranking run", roles: ALL, backPath: "/rankings",
    renders: ["RankingRun", "RankingEntry"] },
  { id: "rankings.compare", path: "/rankings/compare", title: "Compare", roles: LEADERSHIP.concat(["REVIEWER"]),
    backPath: "/rankings", renders: ["Evaluation", "CriterionScore"], searchParams: ["ids", "profile"] },

  { id: "review.queue", path: "/review", title: "Review queue", roles: REVIEWERS, backPath: "/",
    renders: ["Idea", "Review"], searchParams: ["status", "department", "sort", "page"] },

  { id: "dashboard", path: "/dashboard", title: "Dashboard", roles: LEADERSHIP, backPath: "/",
    renders: ["Idea", "RankingEntry"], searchParams: ["department", "category", "from", "to", "profile"] },

  { id: "department", path: "/departments/:departmentId", title: "Department", roles: ALL, backPath: "/ideas",
    renders: ["Department", "Idea"] },
  { id: "person", path: "/people/:userId", title: "Person", roles: ALL, backPath: "/ideas",
    renders: ["User", "Idea"] },

  { id: "config.criteria", path: "/config/criteria", title: "Evaluation criteria", roles: ALL, backPath: "/",
    renders: ["EvaluationCriterion"], searchParams: ["criterion"] },
  { id: "config.profiles", path: "/config/profiles", title: "Evaluation profiles", roles: ALL, backPath: "/",
    renders: ["EvaluationProfile", "ProfileWeight"], searchParams: ["criterion"] },

  { id: "admin.users", path: "/admin/users", title: "Users & roles", roles: ADMIN_ONLY, backPath: "/",
    renders: ["User", "UserRole", "Department"], searchParams: ["q", "role", "page"] },
  { id: "admin.audit", path: "/admin/audit", title: "Audit log", roles: ADMIN_ONLY, backPath: "/",
    renders: ["AuditLog", "AiModelRoute"], searchParams: ["entity", "entityId", "actor", "action", "from", "to", "page"] },

  { id: "help.dataAndAi", path: "/help/data-and-ai", title: "Data & AI notice", roles: ALL, backPath: "/", renders: [] },
];

/** The 46 relationships of SPEC §6.2, in order. */
export const RELATIONSHIPS: readonly RelationshipDef[] = [
  { spec: 1,  from: "User",        to: "Idea",              affordance: "nav",   destinationRouteId: "me.ideas" },
  { spec: 2,  from: "IdeaList",    to: "Idea",              affordance: "row",   destinationRouteId: "idea.overview", note: "whole row; back restores filters + scroll" },
  { spec: 3,  from: "Idea",        to: "User",              affordance: "chip",  destinationRouteId: "person" },
  { spec: 4,  from: "Idea",        to: "Department",        affordance: "chip",  destinationRouteId: "department" },
  { spec: 5,  from: "Idea",        to: "IdeaCategory",      affordance: "chip",  destinationRouteId: "ideas" },
  { spec: 6,  from: "Idea",        to: "IdeaTabs",          affordance: "tab",   destinationRouteId: "idea.overview" },
  { spec: 7,  from: "Idea",        to: "AiAnalysis",        affordance: "tab",   destinationRouteId: "idea.analysis" },
  { spec: 8,  from: "AiAnalysis",  to: "UseCase",           affordance: "row",   destinationRouteId: "idea.overview" },
  { spec: 9,  from: "AiAnalysis",  to: "ValueFinding",      affordance: "row",   destinationRouteId: "idea.analysis" },
  { spec: 10, from: "AiAnalysis",  to: "FeasibilityAssessment", affordance: "chip", destinationRouteId: "idea.analysis" },
  { spec: 11, from: "FeasibilityAssessment", to: "FeasibilityFinding", affordance: "row", destinationRouteId: "idea.analysis" },
  { spec: 12, from: "Idea",        to: "Risk",              affordance: "row",   destinationRouteId: "idea.analysis", note: "drawer; Esc closes, focus returns" },
  { spec: 13, from: "Idea",        to: "Dependency",        affordance: "inline", destinationRouteId: "idea.analysis" },
  { spec: 14, from: "Idea",        to: "ImplementationPlan", affordance: "inline", destinationRouteId: "idea.analysis" },
  { spec: 15, from: "ImplementationPlan", to: "ImplementationRequirement", affordance: "inline", destinationRouteId: "idea.analysis" },
  { spec: 16, from: "ImplementationPlan", to: "TimelineEstimate", affordance: "inline", destinationRouteId: "idea.analysis" },
  { spec: 17, from: "Idea",        to: "Evaluation",        affordance: "tab",   destinationRouteId: "idea.evaluation" },
  { spec: 18, from: "Evaluation",  to: "CriterionScore",    affordance: "row",   destinationRouteId: "idea.evaluation" },
  { spec: 19, from: "CriterionScore", to: "EvaluationCriterion", affordance: "link", destinationRouteId: "config.criteria" },
  { spec: 20, from: "CriterionScore", to: "ScoreOverride",  affordance: "chip",  destinationRouteId: "admin.audit" },
  { spec: 21, from: "Evaluation",  to: "EvaluationProfile", affordance: "chip",  destinationRouteId: "config.profiles" },
  { spec: 22, from: "Evaluation",  to: "RankingEntry",      affordance: "chip",  destinationRouteId: "rankings.run" },
  { spec: 23, from: "RankingEntry", to: "RankingExplanation", affordance: "inline", destinationRouteId: "idea.evaluation", note: "P-2: never behind a click" },
  { spec: 24, from: "RankingEntry", to: "Idea",             affordance: "link",  destinationRouteId: "idea.evaluation", note: "peer comparison names are links" },
  { spec: 25, from: "RankingBoard", to: "Idea",             affordance: "row",   destinationRouteId: "idea.evaluation" },
  { spec: 26, from: "RankingBoard", to: "Comparison",       affordance: "button", destinationRouteId: "rankings.compare" },
  { spec: 27, from: "RankingRun",  to: "RankingEntry",      affordance: "link",  destinationRouteId: "rankings.run" },
  { spec: 28, from: "Idea",        to: "ImprovementRecommendation", affordance: "tab", destinationRouteId: "idea.improve" },
  { spec: 29, from: "ImprovementRecommendation", to: "IdeaVersion", affordance: "button", destinationRouteId: "idea.revise" },
  { spec: 30, from: "ImprovementRecommendation", to: "EvaluationCriterion", affordance: "link", destinationRouteId: "idea.evaluation" },
  { spec: 31, from: "Idea",        to: "IdeaVersion",       affordance: "tab",   destinationRouteId: "idea.history" },
  { spec: 32, from: "IdeaVersion", to: "IdeaVersionSnapshot", affordance: "row", destinationRouteId: "idea.version" },
  { spec: 33, from: "IdeaVersion", to: "VersionDiff",       affordance: "button", destinationRouteId: "idea.history" },
  { spec: 34, from: "Idea",        to: "StatusHistory",     affordance: "tab",   destinationRouteId: "idea.history" },
  { spec: 35, from: "Idea",        to: "Review",            affordance: "tab",   destinationRouteId: "idea.review" },
  { spec: 36, from: "ReviewQueue", to: "Idea",              affordance: "row",   destinationRouteId: "idea.review", note: "lands on Review tab; queue position preserved" },
  { spec: 37, from: "Department",  to: "Idea",              affordance: "row",   destinationRouteId: "idea.overview" },
  { spec: 38, from: "Department",  to: "Department",        affordance: "chip",  destinationRouteId: "department" },
  { spec: 39, from: "User",        to: "Idea",              affordance: "row",   destinationRouteId: "idea.overview" },
  { spec: 40, from: "Dashboard",   to: "IdeaList",          affordance: "tile",  destinationRouteId: "ideas", note: "EVERY tile is a link" },
  { spec: 41, from: "Dashboard",   to: "RankingBoard",      affordance: "tile",  destinationRouteId: "rankings" },
  { spec: 42, from: "EvaluationCriterion", to: "EvaluationProfile", affordance: "link", destinationRouteId: "config.profiles" },
  { spec: 43, from: "EvaluationProfile", to: "EvaluationCriterion", affordance: "link", destinationRouteId: "config.criteria" },
  { spec: 44, from: "AuditLog",    to: "AnyEntity",         affordance: "link",  destinationRouteId: "idea.overview" },
  { spec: 45, from: "AiAnalysis",  to: "ProvenanceHelp",    affordance: "chip",  destinationRouteId: "help.dataAndAi" },
  { spec: 46, from: "AnalysisRun", to: "AiAnalysis",        affordance: "chip",  destinationRouteId: "idea.analysis" },
];

/**
 * Entity types that MUST be rendered by at least one route, for at least one role.
 * Reachability is asserted PER ROLE against the SPEC §4.2 matrix (assertion 7) — an
 * entity a role must not see is correctly unreachable for them, and that is not an orphan.
 */
export const M1_ENTITIES: readonly string[] = [
  "User", "UserRole", "Department", "Idea", "IdeaVersion", "IdeaCategory", "Attachment",
  "AiAnalysis", "AiStructuredProposal", "UseCase", "ValueFinding",
  "FeasibilityAssessment", "FeasibilityFinding", "Risk", "Dependency",
  "ImplementationPlan", "ImplementationRequirement", "TimelineEstimate",
  "EvaluationCriterion", "EvaluationProfile", "ProfileWeight", "AiModelRoute",
  "Evaluation", "CriterionScore", "ScoreOverride",
  "RankingRun", "RankingEntry", "RankingExplanation",
  "ImprovementRecommendation", "Review", "StatusHistory", "AuditLog",
];

export function routeById(id: string): RouteDef | undefined {
  return ROUTES.find((r) => r.id === id);
}

/** Breadcrumbs are DERIVED from this map, never hand-written per page (assertion 5). */
export function breadcrumbChain(routeId: string, maxDepth = 6): readonly RouteDef[] {
  const chain: RouteDef[] = [];
  let current = routeById(routeId);
  const seen = new Set<string>();
  while (current && chain.length < maxDepth && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    const parentPath: string | null = current.backPath;
    if (!parentPath) break;
    current = ROUTES.find((r) => r.path === parentPath);
  }
  return chain;
}

/**
 * Which route a concrete pathname belongs to, if any.
 *
 * Added at P9, when the placeholder fallback was removed: without a fallback rendering
 * every route, the catch-all has to tell "this URL is a typo" apart from "this URL is a
 * real page your role may not see". Saying "not found" for the second is a small lie
 * that sends someone hunting for a page that exists.
 *
 * Path knowledge belongs here rather than in the router, because this file is already the
 * authority on what a path means, and the nav test can assert against it.
 */
export function matchRouteId(pathname: string): RouteDef | undefined {
  const normalised = pathname.replace(/\/+$/, "") || "/";
  return ROUTES.find((route) => {
    // `:param` matches one segment and nothing else — `/ideas/a/b` must not match
    // `/ideas/:ideaId`, or a nested typo would report as a permission problem.
    const source = route.path
      .split("/")
      .map((segment) =>
        segment.startsWith(":")
          ? "[^/]+"
          : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      )
      .join("/");
    return new RegExp(`^${source}$`).test(normalised);
  });
}

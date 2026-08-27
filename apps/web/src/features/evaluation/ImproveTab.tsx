import { Link, useParams } from "react-router-dom";
import {
  Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, Provenance,
  Skeleton,
} from "@iep/ui";
import type { ImprovementRecommendation } from "@iep/contracts";
import { IdeaShell } from "../ideas/IdeaShell";
import {
  PRIORITY_LABEL, RANKING_EFFECT_LABEL, RECOMMENDATION_STATE_LABEL, useRecommendations,
} from "./api";

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

/**
 * Improve tab (P5 — FR-15, P-4).
 *
 * The product's answer to "so what do I do about it". Two rules shape this screen:
 *
 *  - **All six parts, always.** The contract makes every part non-nullable, so a
 *    recommendation cannot be half-rendered here either. "Add more detail" is useless;
 *    the six-part structure is what forces something actionable.
 *  - **No promises about rank.** The projected effect is a DIRECTION, never a guarantee —
 *    the engine decides ranks, and an idea that follows every recommendation can still
 *    move down if the cohort moved further.
 */
export function ImproveTab() {
  const { ideaId = "" } = useParams();
  const query = useRecommendations(ideaId);

  return (
    <IdeaShell>
      {(idea) => {
        if (query.isPending) return <Skeleton className="h-96 w-full" aria-busy="true" />;

        if (query.isError) {
          return (
            <ErrorState
              title="Could not load the recommendations"
              description="The idea is fine — this is the improvement view failing to load."
              onRetry={() => void query.refetch()}
              escapeTo={{ label: "Back to the idea", to: `/ideas/${ideaId}/overview` }}
              renderLink={link}
            />
          );
        }

        const open = query.data.items.filter((r) => r.status === "OPEN");
        const closed = query.data.items.filter((r) => r.status !== "OPEN");

        if (query.data.items.length === 0) {
          /**
           * An empty list is a real answer, not a gap (D-13).
           *
           * Recommendations are only generated below the attention threshold, so "nothing
           * here" usually means the idea scored well. Saying that plainly is better than
           * an empty panel that reads like something failed to load.
           */
          return (
            <EmptyState
              title="No recommendations"
              description={
                idea.status === "DRAFT"
                  ? "Submit the idea and the platform will suggest where it could be stronger."
                  : "The platform only writes recommendations for ideas with a clear weak point. This one either scored well or has not been evaluated yet."
              }
              action={{ label: "See the score", to: `/ideas/${ideaId}/evaluation` }}
              renderLink={link}
            />
          );
        }

        return (
          <div className="space-y-6">
            <p className="text-200 text-muted-foreground">
              These come from the criteria that cost this idea the most, on{" "}
              <Link to={`/ideas/${ideaId}/evaluation`}>the Evaluation tab</Link>. Acting on
              them changes the idea; whether it changes the rank depends on the rest of the
              field.
            </p>

            {open.map((r) => (
              <RecommendationCard key={r.id} item={r} ideaId={ideaId} canRevise={idea.permissions.canRevise} />
            ))}

            {closed.length > 0 ? (
              <section>
                <h2 className="text-400 font-medium">Already dealt with</h2>
                <div className="mt-3 space-y-4">
                  {closed.map((r) => (
                    <RecommendationCard key={r.id} item={r} ideaId={ideaId} canRevise={false} />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        );
      }}
    </IdeaShell>
  );
}

function RecommendationCard({
  item, ideaId, canRevise,
}: {
  item: ImprovementRecommendation;
  ideaId: string;
  canRevise: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={item.priority === 1 ? "default" : "outline"}>
            {PRIORITY_LABEL[item.priority] ?? `Priority ${item.priority}`}
          </Badge>
          {item.status !== "OPEN" ? (
            <Badge variant="secondary">{RECOMMENDATION_STATE_LABEL[item.status]}</Badge>
          ) : null}
          {item.resolvedInVersionNo ? (
            <Link to={`/ideas/${ideaId}/versions/${item.resolvedInVersionNo}`} className="text-100">
              Addressed in version {item.resolvedInVersionNo}
            </Link>
          ) : null}
        </div>
        <CardTitle>{item.issue}</CardTitle>
      </CardHeader>

      <CardContent>
        {/* Written by a model, so it wears the AI treatment like everything else (§7.4). */}
        <Provenance state="AI_UNVALIDATED">
          <dl className="space-y-3">
            <Part label="Why it matters" value={item.whyItMatters} />
            <Part label="What to do" value={item.recommendation} />
            <Part label="How to do it" value={item.howToImplement} />
            <Part label="What it should change" value={item.expectedEffect} />
            <Part
              label="Likely effect on the score"
              value={RANKING_EFFECT_LABEL[item.projectedRankingEffect]}
            />
          </dl>

          {item.targetCriterionKey ? (
            <p className="mt-3 text-100 text-muted-foreground">
              Aimed at{" "}
              <Link to={`/config/criteria#${item.targetCriterionKey}`}>
                {item.targetCriterionKey.replace(/_/g, " ")}
              </Link>
              .
            </p>
          ) : null}
        </Provenance>

        {canRevise && item.status === "OPEN" ? (
          <p className="mt-4">
            <Link to={`/ideas/${ideaId}/revise`} className="text-200">
              Revise the idea to address this
            </Link>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Part({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-100 font-medium text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap text-200">{value}</dd>
    </div>
  );
}

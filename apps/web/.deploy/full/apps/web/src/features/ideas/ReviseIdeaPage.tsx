import { useNavigate, useParams, useSearchParams, Link } from "react-router-dom";
import { EmptyState, ErrorState } from "@iep/ui";
import { IdeaForm, type IdeaFormValues } from "./IdeaForm";
import { useCreateVersion, useIdea } from "./api";

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

/** Revision — the improvement loop (FR-16). Creates v(n+1); the previous stays frozen. */
export function ReviseIdeaPage() {
  const { ideaId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const idea = useIdea(ideaId);
  const revise = useCreateVersion(ideaId);

  if (idea.isPending) return <main className="page"><p className="muted">Loading…</p></main>;
  if (idea.isError) {
    return (
      <main className="page">
        <ErrorState
          title="Could not load this idea"
          description="It may have been removed, or you may not have access to it."
          onRetry={() => void idea.refetch()}
          escapeTo={{ label: "Back to my ideas", to: "/me/ideas" }}
          renderLink={link}
        />
      </main>
    );
  }

  if (!idea.data.permissions.canRevise) {
    return (
      <main className="page">
        <EmptyState
          title="This idea cannot be revised yet"
          description="Drafts are edited directly. Revision creates a new version once an idea has been submitted."
          action={{ label: "Open the idea", to: `/ideas/${ideaId}/overview` }}
          renderLink={link}
        />
      </main>
    );
  }

  const v = idea.data.currentVersion;
  const fromRecommendation = params.get("rec");

  const submit = async (values: IdeaFormValues) => {
    await revise.mutateAsync({
      ...values,
      changeSummary: values.changeSummary ?? "",
      addressesRecommendationIds: fromRecommendation ? [fromRecommendation] : [],
    });
    navigate(`/ideas/${ideaId}/history`);
  };

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to={`/ideas/${ideaId}/overview`}>{v.title}</Link>  ›  Revise
      </nav>
      <h1>Create version {idea.data.versionCount + 1}</h1>
      <p className="muted">
        Version {v.versionNo} stays exactly as it is. Changes here are re-evaluated, and
        the history shows what moved.
      </p>
      <IdeaForm
        requireChangeSummary
        submitLabel="Save and re-evaluate"
        onSubmit={submit}
        serverError={revise.error}
        busy={revise.isPending}
        defaultValues={{
          title: v.title, description: v.description, problemStatement: v.problemStatement,
          expectedUsers: v.expectedUsers, expectedOutcome: v.expectedOutcome,
          existingProcess: v.existingProcess ?? "", existingSolutions: v.existingSolutions ?? "",
          suggestedTechnology: v.suggestedTechnology ?? "", expectedBenefits: v.expectedBenefits ?? "",
          estimatedCostNote: v.estimatedCostNote ?? "", references: v.references ?? "",
        }}
      />
    </main>
  );
}

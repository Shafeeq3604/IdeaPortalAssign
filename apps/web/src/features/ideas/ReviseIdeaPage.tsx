import { useNavigate, useParams, useSearchParams, Link } from "react-router-dom";
import { EmptyState, ErrorState, Skeleton } from "@iep/ui";
import { IdeaForm, type IdeaFormValues } from "./IdeaForm";
import { useCreateVersion, useIdea, useUpdateDraft } from "./api";

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

const versionDefaults = (v: {
  title: string; description: string; problemStatement: string; expectedUsers: string;
  expectedOutcome: string; existingProcess: string | null; existingSolutions: string | null;
  suggestedTechnology: string | null; expectedBenefits: string | null;
  estimatedCostNote: string | null; references: string | null; useCases: readonly string[];
}): Partial<IdeaFormValues> => ({
  title: v.title, description: v.description, problemStatement: v.problemStatement,
  expectedUsers: v.expectedUsers, expectedOutcome: v.expectedOutcome,
  existingProcess: v.existingProcess ?? "", existingSolutions: v.existingSolutions ?? "",
  suggestedTechnology: v.suggestedTechnology ?? "", expectedBenefits: v.expectedBenefits ?? "",
  estimatedCostNote: v.estimatedCostNote ?? "", references: v.references ?? "",
  useCases: [...v.useCases],
});

/**
 * Edit (a DRAFT or NEEDS_CLARIFICATION idea in place, `idea:edit`) or Revise (create
 * v(n+1) from an already-submitted idea, `idea:revise`) — one route, because `IdeaShell`
 * always shows exactly one of the two actions for a given idea and both used to point
 * here. Only "Revise" was ever implemented: a draft's "Edit" button landed on this same
 * page, which then refused it outright ("cannot be revised yet... drafts are edited
 * directly") with no page anywhere that actually did that — `updateDraft`
 * (apps/api/src/modules/idea/routes.ts) had no caller in this app at all. This restores
 * the missing half instead of only explaining that it's missing.
 */
export function ReviseIdeaPage() {
  const { ideaId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const idea = useIdea(ideaId);
  const revise = useCreateVersion(ideaId);
  const editDraft = useUpdateDraft(ideaId);

  if (idea.isPending) {
    return (
      <main className="page page--narrow">
        <Skeleton className="mt-6 h-96 w-full" aria-busy="true" />
      </main>
    );
  }
  if (idea.isError) {
    return (
      <main className="page page--narrow">
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

  const { canEdit, canRevise } = idea.data.permissions;
  if (!canEdit && !canRevise) {
    return (
      <main className="page page--narrow">
        <EmptyState
          title="This idea cannot be changed right now"
          description="It has moved past the point where the author can edit or revise it."
          action={{ label: "Open the idea", to: `/ideas/${ideaId}/overview` }}
          renderLink={link}
        />
      </main>
    );
  }

  const v = idea.data.currentVersion;

  if (canEdit) {
    const saveDraft = async (values: IdeaFormValues) => {
      await editDraft.mutateAsync(values);
      navigate(`/ideas/${ideaId}/overview`);
    };

    return (
      <main className="page page--narrow">
        <nav aria-label="Breadcrumb" className="crumbs">
          <Link to={`/ideas/${ideaId}/overview`}>{v.title}</Link>  ›  Edit
        </nav>
        <h1>Edit draft</h1>
        <p className="muted">
          Changes save immediately. Nothing here is analysed until you submit the idea
          from its overview page.
        </p>
        <IdeaForm
          singleAction
          submitLabel="Save changes"
          onSubmit={saveDraft}
          serverError={editDraft.error}
          busy={editDraft.isPending}
          defaultValues={versionDefaults(v)}
        />
      </main>
    );
  }

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
    <main className="page page--narrow">
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
        defaultValues={versionDefaults(v)}
      />
    </main>
  );
}

import { useNavigate } from "react-router-dom";
import { IdeaForm, type IdeaFormValues } from "./IdeaForm";
import { useCreateIdea } from "./api";

/** Idea submission (FR-02). */
export function SubmitIdeaPage() {
  const navigate = useNavigate();
  const create = useCreateIdea();

  const submit = async (values: IdeaFormValues, asDraft: boolean) => {
    const { changeSummary: _ignored, ...fields } = values;
    const result = await create.mutateAsync({ ...fields, submit: !asDraft });
    navigate(`/ideas/${result.ideaId}/overview`);
  };

  return (
    <main className="page">
      <h1>Submit an idea</h1>
      <p className="muted">
        Describe it in your own words. Nothing here needs technical knowledge — the
        platform structures it for you, and a person makes every decision.
      </p>
      <IdeaForm
        submitLabel="Submit for analysis"
        onSubmit={submit}
        serverError={create.error}
        busy={create.isPending}
      />
    </main>
  );
}

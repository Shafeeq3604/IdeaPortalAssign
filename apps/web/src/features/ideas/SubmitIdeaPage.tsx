import { useNavigate } from "react-router-dom";
import { IdeaForm, type IdeaFormValues } from "./IdeaForm";
import { useCreateIdea } from "./api";

/** Idea submission (FR-02). */
export function SubmitIdeaPage() {
  const navigate = useNavigate();
  const create = useCreateIdea();

  const submit = async (values: IdeaFormValues, asDraft: boolean) => {
    // `changeSummary` belongs to revision only (FR-24); a first submission has nothing
    // to summarise, so it is dropped rather than sent as an empty string.
    const fields = { ...values, changeSummary: undefined };
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
      {/*
        Said here because the form cannot offer it: files attach to an idea that exists,
        and this form creates one. Somebody with a document to attach needs to know to
        save a draft first, BEFORE they have filled the whole thing in and pressed submit.
      */}
      <p className="muted">
        Have a document that explains it better? Save this as a draft first — you can
        attach PDF, Word and text files to a draft, then submit it.
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

import { useNavigate } from "react-router-dom";
import { Paperclip, PenSquare } from "lucide-react";
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
      {/* The chip matches "Submit an idea" in the sidebar (Idea Platform Redesign) — the
          destination and the page it lands on read as the same amber thing. */}
      <h1 className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-lg bg-state-warn-bg text-state-warn"
        >
          <PenSquare className="size-4.5" />
        </span>
        Submit an idea
      </h1>
      <p className="muted">
        Describe it in your own words. Nothing here needs technical knowledge — the
        platform structures it for you, and a person makes every decision.
      </p>
      {/*
        Said here because the form cannot offer it: files attach to an idea that exists,
        and this form creates one. Somebody with a document to attach needs to know to
        save a draft first, BEFORE they have filled the whole thing in and pressed submit.

        A tinted callout rather than a second identical grey paragraph — two `.muted`
        lines in a row read as one undifferentiated block, and this is the one piece of
        advice on the page that changes what someone should DO before they start typing.
      */}
      <div className="mb-8 flex items-start gap-3 rounded-xl bg-state-info-bg p-4 ring-1 ring-inset ring-state-info/20">
        <Paperclip aria-hidden className="mt-0.5 size-4.5 shrink-0 text-state-info" />
        <p className="text-200 text-state-info">
          Have a document that explains it better? Save this as a draft first — you can
          attach PDF, Word and text files to a draft, then submit it.
        </p>
      </div>
      <IdeaForm
        submitLabel="Submit for analysis"
        onSubmit={submit}
        serverError={create.error}
        busy={create.isPending}
      />
    </main>
  );
}

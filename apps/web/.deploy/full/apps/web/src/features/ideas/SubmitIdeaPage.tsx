import * as React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FileText, Paperclip, PenSquare, Sparkles, Trash2, Upload } from "lucide-react";
import { Button } from "@iep/ui";
import { ATTACHMENT_TYPES, MAX_ATTACHMENTS_PER_VERSION, MAX_ATTACHMENT_BYTES } from "@iep/contracts";
import type { Attachment } from "@iep/contracts";
import { ApiError, api } from "../../app/api-client";
import { PageHeading } from "../../app/PageHero";
import { IdeaForm, type IdeaFormValues } from "./IdeaForm";
import { useCreateIdea } from "./api";

/** Handed off by the Discovery Agent's "Submit as idea" action (state, not the URL — this
 * is one-time initialization for a form the human still fills in and submits by hand,
 * not filter/tab state that Back should restore). SPC-23: a structured discovery item
 * fills the same three required sections a human would — deliberately never the
 * optional "Anything else" fields, which stay blank for the human to add if they choose. */
interface DiscoveryPrefill {
  readonly title?: string;
  readonly problemStatement?: string;
  readonly description?: string;
  readonly expectedUsers?: string;
  readonly expectedOutcome?: string;
}

const ACCEPT = ATTACHMENT_TYPES.map((t) => `${t.extension},${t.mime}`).join(",");
const TYPE_NAMES = ATTACHMENT_TYPES.map((t) => t.label).join(", ");

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Idea submission (FR-02). */
export function SubmitIdeaPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const prefill = (location.state as { prefill?: DiscoveryPrefill } | null)?.prefill;
  const create = useCreateIdea();
  const [files, setFiles] = React.useState<File[]>([]);
  const [fileProblem, setFileProblem] = React.useState<string | null>(null);
  const [attachError, setAttachError] = React.useState<{ ideaId: string; message: string } | null>(null);
  const [attaching, setAttaching] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    if (picked.length === 0) return;
    setFileProblem(null);

    const room = MAX_ATTACHMENTS_PER_VERSION - files.length;
    if (picked.length > room) {
      setFileProblem(
        room <= 0
          ? `That is the maximum of ${MAX_ATTACHMENTS_PER_VERSION}. Remove one to add another.`
          : `Only ${room} more file(s) fit under the ${MAX_ATTACHMENTS_PER_VERSION}-file limit.`,
      );
      return;
    }
    const tooBig = picked.find((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (tooBig) {
      setFileProblem(
        `${tooBig.name} is ${formatBytes(tooBig.size)}. Files must be ` +
          `${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB or smaller.`,
      );
      return;
    }
    setFiles((prev) => [...prev, ...picked]);
  };

  const submit = async (values: IdeaFormValues, asDraft: boolean) => {
    // `changeSummary` belongs to revision only (FR-24); a first submission has nothing
    // to summarise, so it is dropped rather than sent as an empty string.
    const fields = { ...values, changeSummary: undefined };

    /**
     * With staged files, the idea is always created as a DRAFT first regardless of which
     * button was pressed — attaching is only possible while a version is still a draft
     * (SPEC §4.3, immutability once submitted), so the files have to land before any
     * transition to SUBMITTED, not after. Submitting for analysis then becomes a second,
     * explicit transition call once every file is safely attached.
     *
     * Without staged files this collapses back to the original single-call path — no
     * reason to pay for two round trips when there is nothing to attach.
     */
    if (files.length === 0) {
      const result = await create.mutateAsync({ ...fields, submit: !asDraft });
      navigate(`/ideas/${result.ideaId}/overview`);
      return;
    }

    const result = await create.mutateAsync({ ...fields, submit: false });
    setAttaching(true);
    try {
      for (const file of files) {
        const body = new FormData();
        body.append("file", file);
        // No Content-Type: only the browser knows the multipart boundary it generated.
        await api<Attachment>(`/ideas/${result.ideaId}/attachments`, { method: "POST", body });
      }
    } catch (error) {
      setAttaching(false);
      setAttachError({
        ideaId: result.ideaId,
        message:
          error instanceof ApiError
            ? error.body.message
            : "That upload did not reach the server. Check your connection and try again.",
      });
      return; // idea exists as a draft either way — never resubmit the form from here
    }

    if (!asDraft) {
      // A submitted idea starts analysis; a failure here still leaves a valid, fully
      // attached draft, so it is not treated as fatal to this flow.
      await api(`/ideas/${result.ideaId}/status`, {
        method: "POST",
        body: JSON.stringify({ to: "SUBMITTED" }),
      }).catch(() => undefined);
    }
    setAttaching(false);
    navigate(`/ideas/${result.ideaId}/overview`);
  };

  if (attachError) {
    return (
      <main className="page page--narrow">
        <h1>The idea was saved</h1>
        <p className="muted">
          {attachError.message} The draft itself is safe — you can add the rest of the files,
          or submit it as it is, from its Overview tab.
        </p>
        <Button onClick={() => navigate(`/ideas/${attachError.ideaId}/overview`)}>
          Continue to the idea
        </Button>
      </main>
    );
  }

  return (
    <main className="page page--narrow">
      {/*
        A plain heading, not the gradient hero every page used to open with. Submitting is
        a working action someone lands on to get something specific done, the same as
        Rankings or the Review queue — not an arrival moment like the Dashboard or
        Discover, which keep the hero treatment. The icon still matches "Submit an idea"
        in the sidebar and header, so the destination and the page it lands on read as the
        same thing without needing a banner to say so.
      */}
      <PageHeading
        icon={PenSquare}
        heading="Submit an idea"
        description="Describe it in your own words. Nothing here needs technical knowledge — the platform structures it for you, and a person makes every decision."
      />

      {prefill ? (
        <div className="flex items-start gap-3 rounded-2xl bg-accent-050 p-4 text-200 shadow-e1 ring-1 ring-inset ring-accent-100">
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-accent-600 to-grad-to text-primary-foreground"
          >
            <Sparkles className="size-4" />
          </span>
          <p className="pt-1">
            Pre-filled from a Discovery Agent finding — review it, fill in the rest, and
            submit only once it reads the way you'd actually put it.
          </p>
        </div>
      ) : null}

      <IdeaForm
        defaultValues={prefill}
        submitLabel="Submit for analysis"
        onSubmit={submit}
        serverError={create.error}
        busy={create.isPending || attaching}
        extra={
          /*
            Attach up front, not after: files are staged here as plain File objects and
            only uploaded once the idea exists (an attachment cannot be created without a
            version to belong to — SPEC §4.3), immediately after creation and before either
            "save as draft" or "submit for analysis" completes. From here it looks like one
            step. Placed after the optional fields (References last) — attachments are
            themselves optional supporting material, so they belong with the rest of it,
            not ahead of the six required questions.
          */
          <div className="rounded-2xl bg-card p-4 shadow-e1 ring-1 ring-inset ring-border">
            <p className="flex items-center gap-2 font-medium">
              <span
                aria-hidden
                className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
              >
                <Paperclip className="size-3.5" />
              </span>
              Attachments (optional)
            </p>
            <p className="mt-1 text-200 text-muted-foreground">
              Have a document that explains it better? Add it here — it goes in with the
              idea the moment you save or submit below.
            </p>

            {files.length > 0 ? (
              <ul className="mt-3 divide-y divide-border">
                {files.map((file, i) => (
                  <li key={`${file.name}-${i}`} className="flex items-center gap-3 py-2 first:pt-0">
                    <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{file.name}</span>
                      <span className="text-100 text-muted-foreground">{formatBytes(file.size)}</span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <Trash2 aria-hidden className="size-4" />
                      <span className="sr-only">Remove {file.name}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}

            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPT}
              aria-label="Choose files to attach"
              className="sr-only"
              onChange={(event) => {
                addFiles(event.target.files);
                // Cleared so choosing the same file twice fires change again.
                event.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              disabled={files.length >= MAX_ATTACHMENTS_PER_VERSION}
              onClick={() => inputRef.current?.click()}
            >
              <Upload aria-hidden className="size-4" />
              Add a file
            </Button>
            <p className="mt-2 text-100 text-muted-foreground">
              {TYPE_NAMES}, up to {MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB each,{" "}
              {MAX_ATTACHMENTS_PER_VERSION} at most.
            </p>
            {fileProblem ? (
              <p role="alert" className="mt-2 text-200 text-destructive">
                {fileProblem}
              </p>
            ) : null}
          </div>
        }
      />
    </main>
  );
}

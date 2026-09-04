import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Paperclip, Trash2, Upload } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@iep/ui";
import {
  ATTACHMENT_TYPES, MAX_ATTACHMENTS_PER_VERSION, MAX_ATTACHMENT_BYTES,
} from "@iep/contracts";
import type { Attachment, AttachmentListResponse } from "@iep/contracts";
import { ApiError, api } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";

/**
 * Files on an idea (FR-02, requirements.md §29 "Upload PDF/DOCX/TXT").
 *
 * Attaching is only possible while the idea is a draft, because an attachment is part of
 * the version and a submitted version is immutable (SPEC §4.3). The panel says so rather
 * than hiding — "you cannot do this here, and here is why" beats a control that silently
 * is not there.
 */

const ACCEPT = ATTACHMENT_TYPES.map((t) => `${t.extension},${t.mime}`).join(",");
const TYPE_NAMES = ATTACHMENT_TYPES.map((t) => t.label).join(", ");

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentsPanel({
  ideaId,
  canEdit,
}: {
  ideaId: string;
  /** True only for a draft the signed-in person may change. */
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const key = queryKeys.ideas.attachments(ideaId);
  const [problem, setProblem] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const list = useQuery({
    queryKey: key,
    queryFn: () => api<AttachmentListResponse>(`/ideas/${ideaId}/attachments`),
    enabled: Boolean(ideaId),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("file", file);
      /**
       * No `Content-Type` header. The browser has to set it, because only the browser
       * knows the multipart boundary it generated — setting it by hand produces a body
       * the server cannot parse, with an error that blames the file.
       */
      return api<Attachment>(`/ideas/${ideaId}/attachments`, { method: "POST", body });
    },
    onSuccess: () => {
      setProblem(null);
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error: unknown) => {
      /*
       * The server's own words. It knows whether this was the wrong type, too large, or
       * one file too many, and it phrases each specifically — restating it here would
       * mean two versions of the same rule drifting apart.
       */
      setProblem(
        error instanceof ApiError
          ? error.message
          : "That upload did not reach the server. Check your connection and try again.",
      );
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api<{ id: string }>(`/attachments/${id}`, { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
  });

  const items = list.data?.items ?? [];
  const full = items.length >= MAX_ATTACHMENTS_PER_VERSION;

  const choose = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;

    /**
     * A courtesy check, not the control.
     *
     * The server sniffs the actual bytes and is the only thing that decides. This exists
     * so somebody who picks a 40 MB file is told in the same second rather than after
     * uploading it — and it deliberately does NOT check the type, because a check on the
     * extension here would teach people the extension is what matters.
     */
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setProblem(
        `${file.name} is ${formatBytes(file.size)}. Files must be ` +
          `${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB or smaller.`,
      );
      return;
    }
    upload.mutate(file);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Paperclip aria-hidden className="size-4" />
          Attachments
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-200 text-muted-foreground">
            {canEdit
              ? `Nothing attached. You can add ${TYPE_NAMES.toLowerCase()} files — they are ` +
                "stored with the idea for people to read."
              : "No files were attached to this idea."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 py-2 first:pt-0">
                <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  {/*
                    A plain link, not a fetch-and-blob. The endpoint authorises the
                    request and sets Content-Disposition, so the browser's own download
                    is both correct and the one people expect.
                  */}
                  <a href={item.href} className="block truncate font-medium">
                    {item.filename}
                  </a>
                  <span className="text-100 text-muted-foreground">
                    {formatBytes(item.bytes)} · {item.uploadedBy.displayName}
                  </span>
                </span>
                {canEdit ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(item.id)}
                  >
                    <Trash2 aria-hidden className="size-4" />
                    <span className="sr-only">Remove {item.filename}</span>
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canEdit ? (
          <div className="mt-4">
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              onChange={(event) => {
                choose(event.target.files);
                // Cleared so choosing the same file twice fires change again — otherwise
                // a failed upload cannot be retried without picking something else first.
                event.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={upload.isPending || full}
              onClick={() => inputRef.current?.click()}
            >
              <Upload aria-hidden className="size-4" />
              {upload.isPending ? "Uploading…" : "Add a file"}
            </Button>

            <p className="mt-2 text-100 text-muted-foreground">
              {full
                ? `That is the maximum of ${MAX_ATTACHMENTS_PER_VERSION}. Remove one to add another.`
                : `${TYPE_NAMES}, up to ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB each, ` +
                  `${MAX_ATTACHMENTS_PER_VERSION} at most. Files can be added while this ` +
                  "is a draft; once submitted they are part of what was analysed."}
            </p>

            {problem ? (
              <p role="alert" className="mt-2 text-200 text-destructive">
                {problem}
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

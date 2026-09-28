import * as React from "react";
import { Link, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { EyeOff, MessageSquare, Pencil, Trash2 } from "lucide-react";
import {
  Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  Label, Skeleton, Textarea, cn,
} from "@iep/ui";
import { COMMENT_MAX_LENGTH, type IdeaComment, type PersonRef } from "@iep/contracts";
import { ApiError } from "../../app/api-client";
import { ago } from "../../app/relative-time";
import {
  useComments, useCreateComment, useDeleteComment, useHideComment, usePeopleSearch, useUpdateComment,
} from "./api";

/**
 * P18 — the idea's discussion (D-24). Anyone who can open the idea can read and add to
 * it; the author edits or deletes their own words; an administrator can hide a comment,
 * with a reason the whole thread can read. Conversation only — nothing here is scored.
 *
 * Separate from "Additional feedback" (SignalsPanel), which stays the structured,
 * one-per-reason signal it was built as: this is where people actually talk.
 */

const initials = (name: string) =>
  name.split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase();

export function Discussion({ ideaId, ownerId }: { ideaId: string; ownerId: string }) {
  const comments = useComments(ideaId);
  const { hash } = useLocation();
  const target = hash.startsWith("#comment-") ? hash.slice("#comment-".length) : null;

  // A notification links straight to its comment (`#comment-<id>`): bring it into view
  // once the thread has loaded.
  React.useEffect(() => {
    if (!target || !comments.data) return;
    document.getElementById(`comment-${target}`)?.scrollIntoView({ block: "center" });
  }, [target, comments.data]);

  const items = comments.data?.items ?? [];
  const visible = items.filter((c) => c.state === "VISIBLE").length;

  return (
    <section aria-labelledby="discussion-heading" className="rounded-2xl border border-border bg-card p-5 shadow-e1 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="discussion-heading" className="flex items-center gap-2 text-400 font-extrabold">
          <MessageSquare aria-hidden className="size-5 text-accent-700" />
          Discussion
          {visible > 0 ? <span className="text-300 font-bold text-muted-foreground tabular-nums">{visible}</span> : null}
        </h2>
        <p className="text-100 text-muted-foreground">Everyone who can open this idea can read and join in.</p>
      </div>

      {comments.isPending ? (
        <div className="mt-4 space-y-3" aria-busy="true">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-4/5" />
        </div>
      ) : comments.isError ? (
        <p role="alert" className="mt-4 text-200 text-destructive">The discussion could not be loaded. Reload to try again.</p>
      ) : (
        <>
          {items.length === 0 ? (
            <p className="mt-4 text-200 text-muted-foreground">
              No comments yet. Ask a question, add context, or offer to help — the submitter hears about it.
            </p>
          ) : (
            <ol className="mt-4 flex list-none flex-col gap-3 p-0">
              {items.map((c) => (
                <CommentItem key={c.id} ideaId={ideaId} comment={c} isOwner={c.author.id === ownerId} highlighted={c.id === target} />
              ))}
            </ol>
          )}
          {comments.data.canComment ? (
            <NewComment ideaId={ideaId} />
          ) : (
            <p className="mt-4 text-100 text-muted-foreground">Comments are closed on drafts and archived ideas.</p>
          )}
        </>
      )}
    </section>
  );
}

function CommentItem({
  ideaId, comment, isOwner, highlighted,
}: { ideaId: string; comment: IdeaComment; isOwner: boolean; highlighted: boolean }) {
  const [editing, setEditing] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [hideOpen, setHideOpen] = React.useState(false);
  const update = useUpdateComment(ideaId);
  const remove = useDeleteComment(ideaId);

  if (comment.state !== "VISIBLE") {
    return (
      <li id={`comment-${comment.id}`} className="rounded-xl border border-dashed border-border px-4 py-3 text-200 text-muted-foreground">
        {comment.state === "DELETED" ? (
          <>Comment deleted by {comment.author.displayName}.</>
        ) : (
          <>
            <EyeOff aria-hidden className="mr-1.5 inline size-3.5 align-[-0.125em]" />
            Hidden by a moderator: {comment.hiddenReason}
          </>
        )}
      </li>
    );
  }

  return (
    <li
      id={`comment-${comment.id}`}
      className={cn(
        "rounded-xl border border-border bg-background/60 px-4 py-3 transition-shadow duration-[var(--dur-base)]",
        highlighted && "ring-2 ring-accent-600",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-100 text-100 font-extrabold text-accent-700"
        >
          {initials(comment.author.displayName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-100 text-muted-foreground">
            <Link to={`/people/${comment.author.id}`} className="text-200 font-bold text-foreground hover:text-accent-700">
              {comment.author.displayName}
            </Link>
            {isOwner ? (
              <span className="rounded-full bg-accent-100 px-2 py-0.5 text-100 font-bold text-accent-700">Submitter</span>
            ) : null}
            {comment.author.departmentName ? <span>{comment.author.departmentName}</span> : null}
            <span aria-hidden>·</span>
            <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>
              {ago(comment.createdAt)}
            </time>
            {comment.editedAt ? <span>(edited)</span> : null}
          </p>

          {editing ? (
            <Composer
              ideaId={ideaId}
              label="Edit your comment"
              initialBody={comment.body ?? ""}
              initialMentions={comment.mentions}
              submitLabel="Save"
              autoFocus
              pending={update.isPending}
              error={update.error}
              onCancel={() => setEditing(false)}
              onSubmit={(body, mentionIds) =>
                update.mutate(
                  { commentId: comment.id, body, mentionIds },
                  { onSuccess: () => setEditing(false) },
                )
              }
            />
          ) : (
            <p className="mt-1 whitespace-pre-wrap break-words text-300 leading-relaxed text-foreground">
              <CommentText body={comment.body ?? ""} mentions={comment.mentions} />
            </p>
          )}

          {!editing && (comment.permissions.canEdit || comment.permissions.canDelete || comment.permissions.canHide) ? (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {comment.permissions.canEdit ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
                  <Pencil aria-hidden className="size-3.5" />
                  Edit
                </Button>
              ) : null}
              {comment.permissions.canDelete ? (
                confirmDelete ? (
                  <span className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(comment.id, { onSettled: () => setConfirmDelete(false) })}
                    >
                      Delete comment
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                      Keep
                    </Button>
                  </span>
                ) : (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
                    <Trash2 aria-hidden className="size-3.5" />
                    Delete
                  </Button>
                )
              ) : null}
              {comment.permissions.canHide ? (
                <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setHideOpen(true)}>
                  <EyeOff aria-hidden className="size-3.5" />
                  Hide
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {comment.permissions.canHide ? (
        <HideDialog ideaId={ideaId} comment={comment} open={hideOpen} onOpenChange={setHideOpen} />
      ) : null}
    </li>
  );
}

/** The body, with each picked @mention linked to that person. Plain text otherwise — never HTML. */
function CommentText({ body, mentions }: { body: string; mentions: readonly PersonRef[] }) {
  if (mentions.length === 0) return <>{body}</>;
  const byName = new Map(mentions.map((m) => [`@${m.displayName}`, m]));
  const pattern = new RegExp(
    `(${[...byName.keys()].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "g",
  );
  return (
    <>
      {body.split(pattern).map((part, i) => {
        const person = byName.get(part);
        return person ? (
          <Link key={i} to={`/people/${person.id}`} className="rounded bg-accent-100 px-1 font-semibold text-accent-700 no-underline hover:underline">
            {part}
          </Link>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        );
      })}
    </>
  );
}

function NewComment({ ideaId }: { ideaId: string }) {
  const create = useCreateComment(ideaId);
  const [resetKey, setResetKey] = React.useState(0);
  return (
    <div className="mt-4 border-t border-border pt-4">
      <Composer
        key={resetKey}
        ideaId={ideaId}
        label="Add a comment"
        placeholder="Ask a question, add context, or type @ to bring someone in"
        submitLabel="Post comment"
        pending={create.isPending}
        error={create.error}
        onSubmit={(body, mentionIds) =>
          create.mutate(
            { body, mentionIds },
            {
              onSuccess: () => {
                setResetKey((k) => k + 1);
                toast.success(mentionIds.length > 0 ? "Posted — the people you mentioned were told." : "Posted.");
              },
            },
          )
        }
      />
    </div>
  );
}

/**
 * Textarea + @mention picker. Typing "@" and a few letters lists people who can open the
 * idea; ↑/↓ moves, Enter or Tab picks, Esc closes (the ARIA combobox pattern, driven from
 * the textarea so focus never leaves what you are typing into).
 */
function Composer({
  ideaId, label, placeholder, initialBody = "", initialMentions = [], submitLabel, autoFocus = false, pending, error,
  onSubmit, onCancel,
}: {
  ideaId: string;
  label: string;
  placeholder?: string;
  initialBody?: string;
  initialMentions?: readonly PersonRef[];
  submitLabel: string;
  /** Opening an editor means you are about to type in it: focus it, caret at the end. */
  autoFocus?: boolean;
  pending: boolean;
  error: Error | null;
  onSubmit: (body: string, mentionIds: string[]) => void;
  onCancel?: () => void;
}) {
  const id = React.useId();
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = React.useState(initialBody);
  const [picked, setPicked] = React.useState<Map<string, PersonRef>>(
    () => new Map(initialMentions.map((m) => [m.id, m])),
  );
  const [query, setQuery] = React.useState<{ text: string; start: number } | null>(null);
  const [active, setActive] = React.useState(0);
  const people = usePeopleSearch(query?.text ?? "", ideaId);

  React.useEffect(() => {
    if (!autoFocus || !ref.current) return;
    const end = ref.current.value.length;
    ref.current.focus();
    ref.current.setSelectionRange(end, end);
  }, [autoFocus]);
  const options = query ? (people.data?.items ?? []) : [];
  const open = query !== null && options.length > 0;

  /** Is the caret right after "@something" (start of text or after a space)? */
  const detect = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const m = /(^|\s)@([^\s@][^@\n]{0,30})?$/.exec(before);
    if (!m) return setQuery(null);
    const text = m[2] ?? "";
    setQuery({ text, start: caret - text.length - 1 });
    setActive(0);
  };

  const pick = (person: PersonRef) => {
    if (!query || !ref.current) return;
    const caret = ref.current.selectionStart;
    const insert = `@${person.displayName} `;
    const next = body.slice(0, query.start) + insert + body.slice(caret);
    setBody(next);
    setPicked((prev) => new Map(prev).set(person.id, person));
    setQuery(null);
    const pos = query.start + insert.length;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  };

  const submit = () => {
    const text = body.trim();
    if (!text || pending) return;
    // Only people whose "@Name" is still in the text — deleting the name un-mentions them.
    const mentionIds = [...picked.values()].filter((p) => text.includes(`@${p.displayName}`)).map((p) => p.id);
    onSubmit(text, mentionIds);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      const option = options[active];
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % options.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + options.length) % options.length); return; }
      if ((e.key === "Enter" || e.key === "Tab") && option) { e.preventDefault(); pick(option); return; }
      if (e.key === "Escape") { e.preventDefault(); setQuery(null); return; }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
  };

  const listId = `${id}-people`;
  const remaining = COMMENT_MAX_LENGTH - body.length;

  return (
    <div className="mt-2">
      <Label htmlFor={id} className="sr-only">{label}</Label>
      <div className="relative">
        <Textarea
          ref={ref}
          id={id}
          value={body}
          placeholder={placeholder}
          maxLength={COMMENT_MAX_LENGTH}
          rows={3}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          onChange={(e) => {
            setBody(e.target.value);
            detect(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setQuery(null)}
        />
        {open ? (
          <ul
            id={listId}
            role="listbox"
            aria-label="People you can mention"
            className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 list-none overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-e3"
          >
            {options.map((p, i) => (
              <li
                key={p.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                // mousedown, not click: it fires before the textarea's blur closes the list.
                onMouseDown={(e) => { e.preventDefault(); pick(p); }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-200",
                  i === active ? "bg-accent text-accent-foreground" : "text-foreground",
                )}
              >
                <span className="font-semibold">{p.displayName}</span>
                {p.departmentName ? <span className="text-100 text-muted-foreground">{p.departmentName}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-100 text-muted-foreground" aria-live="polite">
          {remaining < 200 ? `${remaining} characters left` : "Ctrl + Enter to post"}
        </p>
        <div className="flex items-center gap-2">
          {onCancel ? (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          ) : null}
          <Button type="button" size="sm" disabled={!body.trim() || pending} onClick={submit}>
            {pending ? "Posting…" : submitLabel}
          </Button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-200 text-destructive">
          {error instanceof ApiError ? error.message : "That did not go through. Try again."}
        </p>
      ) : null}
    </div>
  );
}

function HideDialog({
  ideaId, comment, open, onOpenChange,
}: { ideaId: string; comment: IdeaComment; open: boolean; onOpenChange: (open: boolean) => void }) {
  const hide = useHideComment(ideaId);
  const [reason, setReason] = React.useState("");
  const id = React.useId();
  const valid = reason.trim().length >= 3;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hide this comment?</DialogTitle>
          <DialogDescription>
            Its text is withheld from everyone. The reason you give is shown in its place, and the
            decision — with the original text — is kept in the audit log.
          </DialogDescription>
        </DialogHeader>
        <blockquote className="max-h-32 overflow-y-auto rounded-lg border border-border bg-muted/50 px-3 py-2 text-200">
          {comment.body}
        </blockquote>
        <div className="grid gap-1.5">
          <Label htmlFor={id}>Reason, shown to everyone</Label>
          <Textarea id={id} value={reason} maxLength={300} rows={2} onChange={(e) => setReason(e.target.value)} />
        </div>
        {hide.error ? (
          <p role="alert" className="text-200 text-destructive">
            {hide.error instanceof ApiError ? hide.error.message : "That did not go through. Try again."}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!valid || hide.isPending}
            onClick={() =>
              hide.mutate(
                { commentId: comment.id, reason: reason.trim() },
                { onSuccess: () => { onOpenChange(false); toast.success("Comment hidden."); } },
              )
            }
          >
            Hide comment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

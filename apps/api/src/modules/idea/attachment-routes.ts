import {
  MAX_ATTACHMENTS_PER_VERSION, MAX_ATTACHMENT_BYTES, can,
} from "@iep/contracts";
import type { Attachment, IdeaStatus } from "@iep/contracts";
import type { Handler } from "../../server.js";
import { requireActor, sendError } from "../../server.js";
import {
  openStored, removeStored, resolveStored, storeUpload, storedExists,
} from "./attachments.js";

/**
 * Attachments (FR-02, SPEC §4.3, requirements.md §29 "Upload PDF/DOCX/TXT").
 *
 * Three rules decide everything here:
 *
 *  1. **You may attach to a version you may still edit.** An idea version is immutable
 *     once superseded or submitted for analysis (§4.3), and an attachment is part of the
 *     version — so adding one afterwards would change an analysed input after the fact.
 *  2. **You may download what you may read.** Authorisation is against the IDEA, checked
 *     on every request. Nothing is served from a static path.
 *  3. **Nothing is trusted.** Not the extension, not the Content-Type, not the filename.
 *     See `attachments.ts` for what each check stops.
 *
 * NOT DONE, and deliberately: nothing extracts text from these files, and no attachment
 * content is sent to the model provider. requirements.md §29 lists "Text extraction" as
 * an MVP platform capability, but SPEC does not specify it, and CLAUDE.md requires a stop
 * before anything new is sent to a provider. The files are stored, listed and downloadable
 * by people; the pipeline does not read them.
 */

/** A version accepts attachments only while its idea is still being written. */
const EDITABLE: readonly IdeaStatus[] = ["DRAFT"];

export function registerAttachmentRoutes(handlers: Map<string, Handler>): void {
  handlers.set("listAttachments", async (request, reply, ctx) => {
    const { ideaId } = request.params as { ideaId: string };
    const idea = await readableIdea(request, ctx, ideaId);
    if (!idea) return sendError(reply, "NOT_FOUND", "No idea with that id");
    if (!idea.currentVersionId) return { items: [] };

    const rows = await ctx.db.attachment.findMany({
      where: { ideaVersionId: idea.currentVersionId },
      orderBy: { createdAt: "asc" },
      // A select, not an include: `include` on `uploadedBy` would pull every user column
      // including the password hash. That bug has shipped here once already.
      select: {
        id: true, filename: true, mime: true, bytes: true, createdAt: true,
        uploadedBy: { select: { id: true, displayName: true, department: { select: { name: true } } } },
      },
    });

    return { items: rows.map(present) };
  });

  handlers.set("uploadAttachment", async (request, reply, ctx) => {
    const { ideaId } = request.params as { ideaId: string };

    /**
     * Three checks, in this order, and the order is the point.
     *
     *  1. Can you SEE it? If not, 404 — existence is not disclosed to a stranger.
     *  2. Is the version still open? If not, 409 with the real reason.
     *  3. Is it yours to change? If not, 403.
     *
     * `can(…, "idea:edit")` folds the lifecycle rule into the permission, so asking it
     * first answers "no" to a submitted idea with ROLE_NOT_PERMITTED — telling the owner
     * of the idea they lack permission on their own idea, when the truth is that the
     * version is finished. Checking status first means the specific reason wins, and the
     * read check before it means nobody learns anything they should not.
     */
    const idea = await readableIdea(request, ctx, ideaId);
    if (!idea) return sendError(reply, "NOT_FOUND", "No idea with that id");

    if (!EDITABLE.includes(idea.status as IdeaStatus)) {
      return sendError(
        reply,
        "IDEA_VERSION_IMMUTABLE",
        "This version has been submitted, so its attachments are fixed. Create a new " +
          "version to add one.",
      );
    }

    const allowed = can(requireActor(request), "idea:edit", {
      ideaId: idea.id,
      submitterId: idea.submitterId,
      status: idea.status as IdeaStatus,
    });
    if (!allowed.allowed) {
      return sendError(reply, "ROLE_NOT_PERMITTED", "You cannot change this idea");
    }

    const versionId = idea.currentVersionId;
    if (!versionId) return sendError(reply, "NOT_FOUND", "This idea has no version yet");

    /**
     * The count cap is checked BEFORE the bytes are read (§4.3, ≤10 attachments).
     *
     * Reading a 10 MB file and then refusing it on a count anyone could have checked
     * first is work done on behalf of an attacker.
     */
    const existing = await ctx.db.attachment.count({ where: { ideaVersionId: versionId } });
    if (existing >= MAX_ATTACHMENTS_PER_VERSION) {
      return sendError(
        reply,
        "VALIDATION_FAILED",
        `An idea can carry ${MAX_ATTACHMENTS_PER_VERSION} files. Remove one first.`,
      );
    }

    const part = await request.file({ limits: { fileSize: MAX_ATTACHMENT_BYTES + 1 } });
    if (!part) return sendError(reply, "VALIDATION_FAILED", "No file was sent.");

    const stored = await storeUpload(ctx.env.ATTACHMENT_STORAGE_DIR, part.filename, part.file);
    if (!stored.ok) {
      request.log.info(
        // The REASON, never the bytes and never the content. A rejected upload is a thing
        // to count, not a thing to log.
        { ideaId, code: stored.code },
        "attachment rejected",
      );
      return sendError(reply, stored.code, stored.reason);
    }

    const row = await ctx.db.attachment.create({
      data: {
        ideaVersionId: versionId,
        // Kept for display only. It is never used to build a path — see `storeUpload`.
        filename: safeLabel(part.filename),
        mime: stored.file.mime,
        bytes: stored.file.bytes,
        storageKey: stored.file.storageKey,
        uploadedById: requireActor(request).userId,
      },
      select: {
        id: true, filename: true, mime: true, bytes: true, createdAt: true,
        uploadedBy: { select: { id: true, displayName: true, department: { select: { name: true } } } },
      },
    });

    return reply.status(201).send(present(row));
  });

  handlers.set("downloadAttachment", async (request, reply, ctx) => {
    const { attachmentId } = request.params as { attachmentId: string };

    const row = await ctx.db.attachment.findUnique({
      where: { id: attachmentId },
      select: {
        filename: true, mime: true, storageKey: true,
        ideaVersion: { select: { idea: { select: { id: true, submitterId: true, status: true } } } },
      },
    });
    // 404 rather than 403 for something you may not see — existence is not disclosed.
    if (!row) return sendError(reply, "NOT_FOUND", "No attachment with that id");

    const idea = row.ideaVersion.idea;
    const allowed = can(requireActor(request), "idea:read", {
      ideaId: idea.id,
      submitterId: idea.submitterId,
      status: idea.status as IdeaStatus,
    });
    if (!allowed.allowed) return sendError(reply, "NOT_FOUND", "No attachment with that id");

    const path = resolveStored(ctx.env.ATTACHMENT_STORAGE_DIR, row.storageKey);
    if (!path || !(await storedExists(path))) {
      return sendError(reply, "NOT_FOUND", "That file is no longer stored");
    }

    /**
     * Served as a download, never as a page (SPEC §4.3).
     *
     * `nosniff` stops a browser deciding a text/plain file is really HTML and running it
     * on this origin; `attachment` stops it rendering inline even if it disagrees. A
     * stored HTML file served inline from the API's own origin is stored XSS, and these
     * two headers are what make that impossible rather than unlikely.
     *
     * The filename is quoted and stripped of quotes and control characters, so it cannot
     * inject a second header parameter.
     */
    void reply
      .header("Content-Type", row.mime)
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; sandbox")
      .header("Content-Disposition", `attachment; filename="${headerSafe(row.filename)}"`);

    return reply.send(openStored(path));
  });

  handlers.set("deleteAttachment", async (request, reply, ctx) => {
    const { attachmentId } = request.params as { attachmentId: string };

    const row = await ctx.db.attachment.findUnique({
      where: { id: attachmentId },
      select: {
        id: true, storageKey: true,
        ideaVersion: { select: { idea: { select: { id: true, submitterId: true, status: true } } } },
      },
    });
    if (!row) return sendError(reply, "NOT_FOUND", "No attachment with that id");

    const idea = row.ideaVersion.idea;

    // Same order as upload: see it, then is it open, then is it yours.
    const visible = can(requireActor(request), "idea:read", {
      ideaId: idea.id,
      submitterId: idea.submitterId,
      status: idea.status as IdeaStatus,
    });
    if (!visible.allowed) return sendError(reply, "NOT_FOUND", "No attachment with that id");

    if (!EDITABLE.includes(idea.status as IdeaStatus)) {
      return sendError(
        reply,
        "IDEA_VERSION_IMMUTABLE",
        "This version has been submitted. Its attachments are part of what was analysed.",
      );
    }

    const allowed = can(requireActor(request), "idea:edit", {
      ideaId: idea.id,
      submitterId: idea.submitterId,
      status: idea.status as IdeaStatus,
    });
    if (!allowed.allowed) return sendError(reply, "NOT_FOUND", "No attachment with that id");

    /**
     * The row goes first, then the bytes.
     *
     * In that order a crash between the two leaves an unreferenced file — waste, and
     * cleanable. The other order leaves a row pointing at nothing, which is a broken
     * download for a user.
     */
    await ctx.db.attachment.delete({ where: { id: attachmentId } });
    const path = resolveStored(ctx.env.ATTACHMENT_STORAGE_DIR, row.storageKey);
    if (path) await removeStored(path);

    return { id: attachmentId };
  });
}

/* ── helpers ── */

function present(row: {
  id: string;
  filename: string;
  mime: string;
  bytes: number;
  createdAt: Date;
  uploadedBy: { id: string; displayName: string; department: { name: string } | null };
}): Attachment {
  return {
    id: row.id,
    filename: row.filename,
    mime: row.mime as Attachment["mime"],
    bytes: row.bytes,
    uploadedBy: {
      id: row.uploadedBy.id,
      displayName: row.uploadedBy.displayName,
      departmentName: row.uploadedBy.department?.name ?? null,
    },
    createdAt: row.createdAt.toISOString(),
    href: `/api/attachments/${row.id}`,
  };
}

/**
 * The filename as a LABEL: no path separators, no control characters, bounded length.
 *
 * This is belt and braces. The name never reaches the filesystem — the storage key is
 * generated — so this exists so the stored string is safe to render and to put in a
 * header, not to make a path safe.
 */
function safeLabel(name: string): string {
  const cleaned = name
    // The control characters are the point of this regex, not a typo -- stripping
    // them is the whole job of safeLabel.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "-")
    .trim();
  return (cleaned || "attachment").slice(0, 200);
}

/** Quotes and backslashes would end the header's quoted-string early. */
function headerSafe(name: string): string {
  return safeLabel(name).replace(/["\\]/g, "");
}

async function readableIdea(
  request: Parameters<Handler>[0],
  ctx: Parameters<Handler>[2],
  ideaId: string,
) {
  const idea = await ctx.db.idea.findUnique({ where: { id: ideaId } });
  if (!idea) return null;
  return can(requireActor(request), "idea:read", {
    ideaId: idea.id,
    submitterId: idea.submitterId,
    status: idea.status as IdeaStatus,
  }).allowed
    ? idea
    : null;
}

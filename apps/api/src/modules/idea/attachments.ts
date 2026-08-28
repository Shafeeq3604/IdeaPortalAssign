import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { MAX_ATTACHMENT_BYTES } from "@iep/contracts";
import type { AttachmentMime } from "@iep/contracts";

/**
 * Attachment storage and type sniffing (FR-02, SPEC §4.3).
 *
 * Everything here is a security control, so each one says what it stops:
 *
 *  - The type comes from the FIRST BYTES, never the extension and never the browser's
 *    `Content-Type`. Both of those are claims made by whoever sent the file.
 *  - The stored name is generated. The uploaded filename is kept as a label and is never
 *    used to build a path, so there is no traversal to defend against rather than a
 *    sanitiser to get right.
 *  - The size cap is enforced while reading, not after. Checking afterwards means the
 *    disk already holds whatever was sent.
 */

/* ── sniffing ──────────────────────────────────────────────────────────── */

const PDF = Buffer.from("%PDF-", "latin1");
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"

/**
 * How much of the file the sniffer needs.
 *
 * A DOCX is a ZIP whose local file headers name the entries. The `word/` entry is not
 * guaranteed to be first, so this reads enough of the front of the archive to find it in
 * every DOCX produced by Word, LibreOffice and the common generators, without holding a
 * large file to inspect it.
 */
const SNIFF_BYTES = 8 * 1024;

export type SniffResult =
  | { ok: true; mime: AttachmentMime }
  | { ok: false; reason: string };

/**
 * Identify a file from its content.
 *
 * SPEC §9.2 makes the adversarial case an acceptance criterion: a `.exe` renamed to
 * `.pdf` must be rejected. It is, because an MZ header is not `%PDF-`.
 */
export function sniff(head: Buffer, claimedName: string): SniffResult {
  if (head.length === 0) return { ok: false, reason: "That file is empty." };

  if (head.subarray(0, PDF.length).equals(PDF)) {
    return { ok: true, mime: "application/pdf" };
  }

  if (head.subarray(0, ZIP.length).equals(ZIP)) {
    /**
     * A ZIP, but which one?
     *
     * DOCX, XLSX, PPTX, JAR, APK and a plain archive of anything all start with these
     * four bytes. An OOXML word document must contain the `word/` directory, so that is
     * what is actually checked. Accepting any ZIP here would mean accepting a JAR.
     */
    const asText = head.toString("latin1");
    if (asText.includes("word/")) {
      return {
        ok: true,
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      };
    }
    return {
      ok: false,
      reason:
        "That looks like a ZIP archive rather than a Word document. Attach the .docx itself.",
    };
  }

  /**
   * Plain text is the awkward one: it has no signature, so it can only be recognised by
   * the absence of anything else. Rather than accept-by-default — which would make every
   * unrecognised binary a "text file" — it must decode as UTF-8 AND contain no control
   * bytes that text does not use.
   *
   * That check is what stops an unknown binary being waved through with a `.txt` name.
   */
  if (looksLikeText(head)) return { ok: true, mime: "text/plain" };

  const named = claimedName.trim() || "That file";
  return {
    ok: false,
    reason:
      `${named} is not a PDF, Word document or plain text file. ` +
      "Its contents do not match any of those, whatever it is named.",
  };
}

function looksLikeText(head: Buffer): boolean {
  // A UTF-8 BOM is text by definition, and its bytes would otherwise look like control
  // characters.
  const body = head.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
    ? head.subarray(3)
    : head;

  for (const byte of body) {
    // Tab, newline, carriage return and form feed are the control codes text uses.
    const allowed = byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === 0x0c;
    if (!allowed && byte < 0x20) return false;
  }

  /**
   * Decode strictly. `toString("utf8")` never fails — it substitutes U+FFFD — so the
   * only way to detect invalid UTF-8 is to look for that substitution, and only when the
   * input did not legitimately contain one.
   */
  const decoded = body.toString("utf8");
  if (decoded.includes("�") && !body.includes(Buffer.from("�", "utf8"))) return false;

  return true;
}

/* ── storage ───────────────────────────────────────────────────────────── */

export interface StoredFile {
  readonly storageKey: string;
  readonly bytes: number;
  readonly mime: AttachmentMime;
  readonly sha256: string;
}

export type StoreResult =
  | { ok: true; file: StoredFile }
  | { ok: false; code: "FILE_TOO_LARGE" | "UNSUPPORTED_FILE_TYPE" | "VALIDATION_FAILED"; reason: string };

/**
 * Read an upload, decide what it is, and write it under a generated name.
 *
 * Buffered rather than streamed to disk, deliberately: at a 10 MB cap the memory cost is
 * bounded and known, and it means an oversized or wrong-typed file is refused having
 * written NOTHING. Streaming first and validating after leaves a rejected file on disk
 * and a cleanup path to get wrong.
 */
export async function storeUpload(
  storageDir: string,
  filename: string,
  stream: AsyncIterable<Buffer>,
): Promise<StoreResult> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of stream) {
    total += chunk.length;
    // Checked as it arrives. A check after the fact has already accepted the bytes.
    if (total > MAX_ATTACHMENT_BYTES) {
      return {
        ok: false,
        code: "FILE_TOO_LARGE",
        reason: `Files must be ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB or smaller.`,
      };
    }
    chunks.push(chunk);
  }

  const buffer = Buffer.concat(chunks);
  if (buffer.length === 0) {
    return { ok: false, code: "VALIDATION_FAILED", reason: "That file is empty." };
  }

  const result = sniff(buffer.subarray(0, SNIFF_BYTES), filename);
  if (!result.ok) {
    return { ok: false, code: "UNSUPPORTED_FILE_TYPE", reason: result.reason };
  }

  /**
   * The name on disk is generated and carries no user input at all.
   *
   * Not a sanitised version of the uploaded name — a new one. `..`, a null byte, a
   * Windows reserved name and a 4,000-character filename are all irrelevant if the
   * filename never reaches the filesystem.
   */
  const storageKey = `${randomUUID()}.bin`;
  await mkdir(storageDir, { recursive: true });
  await writeFile(join(storageDir, storageKey), buffer, { flag: "wx" });

  return {
    ok: true,
    file: {
      storageKey,
      bytes: buffer.length,
      mime: result.mime,
      sha256: createHash("sha256").update(buffer).digest("hex"),
    },
  };
}

/**
 * Resolve a stored key to a path, refusing anything that escapes the storage directory.
 *
 * Keys are generated by `storeUpload`, so in practice nothing malformed can reach this.
 * It is checked anyway: the day someone adds an import path, or a migration, or a fixture
 * that writes this column, the guarantee has to hold at the point of USE rather than
 * depend on every writer having been careful.
 */
export function resolveStored(storageDir: string, storageKey: string): string | null {
  const base = resolve(storageDir);
  const full = resolve(base, storageKey);
  // Strictly INSIDE. An empty or dot key resolves to the directory itself, which is not
  // a file and must not be treated as one.
  return full.startsWith(base + sep) ? full : null;
}

export function openStored(path: string): NodeJS.ReadableStream {
  return createReadStream(path);
}

export async function storedExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function removeStored(path: string): Promise<void> {
  await rm(path, { force: true });
}

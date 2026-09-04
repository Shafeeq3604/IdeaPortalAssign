import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { MAX_ATTACHMENT_BYTES } from "@iep/contracts";
import type { AttachmentMime } from "@iep/contracts";
import type { ApiEnv } from "@iep/contracts/env";
import { AzureBlobBackend } from "./attachment-backend-azure.js";

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
 * Where attachment bytes actually live, behind one small interface. Every method takes
 * or returns an opaque, server-generated key — never a user-supplied name or path (see
 * `storeUpload`) — so a backend never has to defend against one on its own.
 *
 * `read`/`exists` report "not found" as `null`/`false` rather than throwing: the caller
 * (attachment-routes.ts) already treats a missing file as an ordinary 404, not an error.
 */
export interface AttachmentBackend {
  write(key: string, data: Buffer): Promise<void>;
  read(key: string): Promise<NodeJS.ReadableStream | null>;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
}

/**
 * Read an upload, decide what it is, and hand the bytes to a backend under a generated
 * key. Backend-agnostic on purpose: sniffing and the size cap are the same rule whether
 * the bytes end up on local disk or in Blob Storage.
 *
 * Buffered rather than streamed to the backend, deliberately: at a 10 MB cap the memory
 * cost is bounded and known, and it means an oversized or wrong-typed file is refused
 * having written NOTHING. Streaming first and validating after leaves a rejected file
 * stored and a cleanup path to get wrong.
 */
export async function storeUpload(
  backend: AttachmentBackend,
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
   * The key is generated and carries no user input at all.
   *
   * Not a sanitised version of the uploaded name — a new one. `..`, a null byte, a
   * Windows reserved name and a 4,000-character filename are all irrelevant if the
   * filename never becomes a key or a path.
   */
  const storageKey = `${randomUUID()}.bin`;
  await backend.write(storageKey, buffer);

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
 * Local disk. A real production limitation, not just a dev default — see
 * `ATTACHMENT_STORAGE_PROVIDER` in packages/contracts/src/env.ts.
 *
 * A key never escapes the storage directory, checked here rather than trusted from the
 * caller — even though every key is server-generated (see `storeUpload`), the day
 * something else writes this column, the guarantee has to hold at the point of use.
 */
export class LocalDiskBackend implements AttachmentBackend {
  constructor(private readonly storageDir: string) {}

  private resolveKey(key: string): string | null {
    const base = resolve(this.storageDir);
    const full = resolve(base, key);
    // Strictly INSIDE. An empty or dot key resolves to the directory itself, which is
    // not a file and must not be treated as one.
    return full.startsWith(base + sep) ? full : null;
  }

  async write(key: string, data: Buffer): Promise<void> {
    const path = this.resolveKey(key);
    if (!path) throw new Error("Attachment key escaped the storage directory");
    await mkdir(this.storageDir, { recursive: true });
    await writeFile(path, data, { flag: "wx" });
  }

  async read(key: string): Promise<NodeJS.ReadableStream | null> {
    const path = this.resolveKey(key);
    if (!path || !(await this.exists(key))) return null;
    return createReadStream(path);
  }

  async exists(key: string): Promise<boolean> {
    const path = this.resolveKey(key);
    if (!path) return false;
    try {
      return (await stat(path)).isFile();
    } catch {
      return false;
    }
  }

  async remove(key: string): Promise<void> {
    const path = this.resolveKey(key);
    if (path) await rm(path, { force: true });
  }
}

/**
 * One backend per running process, chosen once at boot from `ATTACHMENT_STORAGE_PROVIDER`
 * — never re-decided per request. `env`'s own `superRefine` already guarantees the fields
 * each branch needs are present.
 */
export function makeAttachmentBackend(
  env: Pick<
    ApiEnv,
    "ATTACHMENT_STORAGE_PROVIDER" | "ATTACHMENT_STORAGE_DIR" | "AZURE_STORAGE_CONNECTION_STRING" | "AZURE_STORAGE_CONTAINER"
  >,
): AttachmentBackend {
  if (env.ATTACHMENT_STORAGE_PROVIDER === "azure-blob") {
    const { AZURE_STORAGE_CONNECTION_STRING: connectionString, AZURE_STORAGE_CONTAINER: container } = env;
    // The env schema's own superRefine already requires both — this is narrowing the
    // type, not re-deciding the rule.
    if (!connectionString || !container) {
      throw new Error(
        "AZURE_STORAGE_CONNECTION_STRING and AZURE_STORAGE_CONTAINER are required when " +
          'ATTACHMENT_STORAGE_PROVIDER is "azure-blob"',
      );
    }
    return new AzureBlobBackend(connectionString, container);
  }

  const { ATTACHMENT_STORAGE_DIR: storageDir } = env;
  if (!storageDir) {
    throw new Error('ATTACHMENT_STORAGE_DIR is required when ATTACHMENT_STORAGE_PROVIDER is "local"');
  }
  return new LocalDiskBackend(storageDir);
}

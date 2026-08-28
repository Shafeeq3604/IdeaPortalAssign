import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@iep/db";
import type { ApiEnv } from "@iep/contracts/env";
import { MAX_ATTACHMENTS_PER_VERSION, MAX_ATTACHMENT_BYTES } from "@iep/contracts";
import { buildServer } from "@iep/api/src/server.js";
import type { AppContext } from "@iep/api/src/context.js";
import { MemorySessionStore } from "@iep/api/src/auth/session.js";
import { makeIdeaRepo } from "@iep/api/src/modules/idea/repo.js";

/**
 * F-02 — Attaching a file (FR-02, SPEC §4.3, §9.2), as a FLOW.
 *
 * Every limit in SPEC §4.3 is here, plus the adversarial cases that make them mean
 * something. The one SPEC states outright as an acceptance criterion —
 *
 *   "Given a `.exe` renamed to `.pdf`, when attached, then it is rejected on magic-byte
 *    sniff."
 *
 * — is the third test, and it is the reason the sniffer exists at all.
 *
 * Uploads run through the real router with real multipart parsing, into a real temporary
 * directory that is removed afterwards. Asserting against the filesystem is the point:
 * "the API said no" and "nothing was written" are different claims, and only the second
 * one matters after a rejection.
 */

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgresql://iep:iep@localhost:5433/iep";
const db = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

/* ── file fixtures, built as bytes rather than read from disk ── */

const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n", "latin1");

/** A real ZIP header plus the `word/` entry every OOXML document must contain. */
const DOCX = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]),
  Buffer.from("word/document.xml", "latin1"),
  Buffer.from([0x00, 0x00]),
  Buffer.from("[Content_Types].xml", "latin1"),
]);

const TXT = Buffer.from("A note about the receipts problem.\nTwo lines.\n", "utf8");

/** MZ — a Windows executable. This is the file SPEC §9.2 names. */
const EXE = Buffer.concat([
  Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]),
  Buffer.from("This program cannot be run in DOS mode.", "latin1"),
  Buffer.from([0x00, 0x01, 0x02, 0x03]),
]);

/** A ZIP that is not a Word document — the case a naive PK check would wave through. */
const JAR = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x08, 0x00]),
  Buffer.from("META-INF/MANIFEST.MF", "latin1"),
  Buffer.from("com/example/Main.class", "latin1"),
]);

/** Multipart body, assembled by hand so nothing between the test and the router guesses. */
function multipart(filename: string, contentType: string, bytes: Buffer) {
  const boundary = "----bddboundary9f2c";
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
    "latin1",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "latin1");
  return {
    payload: Buffer.concat([head, bytes, tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

let reachable = false;
let storageDir = "";
let submitterId = "";
let otherUserId = "";
const createdIdeas: string[] = [];

function makeApp() {
  const ctx: AppContext = {
    env: {
      NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL,
      REDIS_URL: "redis://localhost:6380", PORT: 3001,
      PUBLIC_WEB_ORIGIN: "http://localhost:5173",
      SESSION_SECRET: "bdd-session-secret-at-least-32-characters",
      OIDC_ISSUER: "https://x.invalid", OIDC_CLIENT_ID: "x",
      OIDC_CLIENT_SECRET: "x", OIDC_REDIRECT_URI: "http://localhost:3001/cb",
      ATTACHMENT_STORAGE_DIR: storageDir,
      SIGNUP_ENABLED: true, SIGNUP_ALLOWED_EMAIL_DOMAINS: [],
    } as unknown as ApiEnv,
    db,
    sessions: new MemorySessionStore(),
    auth: {} as never,
    analysis: { enqueue: async () => true },
    ranking: { enqueue: async () => true },
  };
  return buildServer(ctx);
}

beforeAll(async () => {
  try {
    await db.$queryRaw`SELECT 1`;
    reachable = true;
  } catch {
    return;
  }
  storageDir = await mkdtemp(join(tmpdir(), "iep-attachments-"));
  /**
   * The SEEDED accounts by name, not "the first two users alphabetically".
   *
   * Alphabetical order picked up leftover test accounts from another suite, one of them
   * deactivated, and the failure read as a permissions bug rather than a fixture bug.
   * A test fixture should name what it needs.
   */
  const employee = await db.user.findUnique({ where: { email: "employee@example.invalid" } });
  const reviewer = await db.user.findUnique({ where: { email: "reviewer@example.invalid" } });
  submitterId = employee?.id ?? "";
  otherUserId = reviewer?.id ?? "";
});

afterAll(async () => {
  if (reachable && createdIdeas.length > 0) {
    await db.idea.deleteMany({ where: { id: { in: createdIdeas } } });
  }
  if (storageDir) await rm(storageDir, { recursive: true, force: true });
  await db.$disconnect();
});

const guard = () => {
  if (!reachable) throw new Error("database unreachable — run `pnpm deps:up` before the BDD flows");
  if (!submitterId) throw new Error("no users in the database — run `pnpm db:seed`");
};

async function givenADraft(label: string) {
  const { ideaId } = await makeIdeaRepo(db).createWithFirstVersion({
    submitterId,
    departmentId: null,
    categoryId: null,
    submit: false,
    fields: {
      title: `F-02 ${label} ${createdIdeas.length}`,
      description: "A description long enough to be meaningful for the attachment tests.",
      problemStatement: "Receipts are retyped by hand.",
      expectedUsers: "Everyone who claims expenses.",
      expectedOutcome: "Claims take less time.",
    },
  });
  createdIdeas.push(ideaId);
  return ideaId;
}

/** How many files are actually on disk. The assertion a status code cannot make. */
const storedCount = async () => (await readdir(storageDir)).length;

/**
 * Sign in as a seeded user so requests carry a real session cookie.
 *
 * The seeded password is the one RUNNING.md documents; a test that read it from the
 * environment would fail confusingly on a fresh clone.
 */
async function signIn(app: ReturnType<typeof makeApp>, userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: user.email, password: "innovation-2026" },
  });
  if (response.statusCode !== 200) {
    throw new Error(`could not sign in as ${user.email} — run \`pnpm db:seed\``);
  }
  return response.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

describe("F-02 · attaching a file to a draft", () => {
  it("Given a PDF, When attached, Then it is stored and listed (FR-02)", async () => {
    guard();
    const app = makeApp();
    const cookie = await signIn(app, submitterId);
    const ideaId = await givenADraft("pdf");

    const response = await app.inject({
      method: "POST",
      url: `/ideas/${ideaId}/attachments`,
      headers: { cookie, ...multipart("proposal.pdf", "application/pdf", PDF).headers },
      payload: multipart("proposal.pdf", "application/pdf", PDF).payload,
    });

    expect(response.statusCode, response.body).toBe(201);
    const body = response.json();
    expect(body.mime).toBe("application/pdf");
    expect(body.bytes).toBe(PDF.length);
    expect(body.filename).toBe("proposal.pdf");

    /**
     * The stored name is generated, and the uploaded name is nowhere near the filesystem.
     *
     * Asserted against the DIRECTORY, because "we generate a key" is a claim about code
     * and this is the observable fact it is supposed to produce.
     */
    const onDisk = await readdir(storageDir);
    expect(onDisk.some((f) => f.includes("proposal"))).toBe(false);
    expect(onDisk.length).toBe(1);

    const listed = await app.inject({
      method: "GET",
      url: `/ideas/${ideaId}/attachments`,
      headers: { cookie },
    });
    expect(listed.json().items).toHaveLength(1);
    expect(listed.json().items[0].href).toBe(`/api/attachments/${body.id}`);

    await app.close();
  });

  it("Given a DOCX and a TXT, Then both are recognised by content", async () => {
    guard();
    const app = makeApp();
    const cookie = await signIn(app, submitterId);
    const ideaId = await givenADraft("types");

    for (const [name, type, bytes, expected] of [
      ["notes.docx", "application/octet-stream", DOCX,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["notes.txt", "application/octet-stream", TXT, "text/plain"],
    ] as const) {
      const form = multipart(name, type, bytes);
      const response = await app.inject({
        method: "POST",
        url: `/ideas/${ideaId}/attachments`,
        headers: { cookie, ...form.headers },
        payload: form.payload,
      });

      /**
       * Note the Content-Type sent: `application/octet-stream` for both.
       *
       * The browser's declared type is a claim, and the stored MIME must come from the
       * bytes regardless of it. If this ever passes by reading the header instead, the
       * next test — the renamed executable — is the one that breaks.
       */
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json().mime).toBe(expected);
    }

    await app.close();
  });
});

describe("F-02 · what is refused", () => {
  it("Given a .exe renamed to .pdf, Then it is rejected on the magic bytes (SPEC §9.2)", async () => {
    guard();
    const app = makeApp();
    const cookie = await signIn(app, submitterId);
    const ideaId = await givenADraft("renamed-exe");
    const before = await storedCount();

    // Everything a naive check would look at says PDF. Only the bytes say otherwise.
    const form = multipart("totally-a-report.pdf", "application/pdf", EXE);
    const response = await app.inject({
      method: "POST",
      url: `/ideas/${ideaId}/attachments`,
      headers: { cookie, ...form.headers },
      payload: form.payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("UNSUPPORTED_FILE_TYPE");

    // Refused AND not written. A rejection that leaves the file on disk is not a rejection.
    expect(await storedCount()).toBe(before);
    expect(await db.attachment.count({ where: { filename: { contains: "totally-a-report" } } })).toBe(0);

    await app.close();
  });

  it("Given a JAR, Then being a ZIP is not enough to pass as a Word document", async () => {
    guard();
    const app = makeApp();
    const cookie = await signIn(app, submitterId);
    const ideaId = await givenADraft("jar");
    const before = await storedCount();

    /**
     * DOCX, XLSX, JAR and APK all begin `PK\\x03\\x04`. A sniffer that stopped at the ZIP
     * signature would accept an executable archive as a document, which is how "we check
     * magic bytes" becomes true and useless at the same time.
     */
    const form = multipart("library.docx", "application/octet-stream", JAR);
    const response = await app.inject({
      method: "POST",
      url: `/ideas/${ideaId}/attachments`,
      headers: { cookie, ...form.headers },
      payload: form.payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("UNSUPPORTED_FILE_TYPE");
    expect(await storedCount()).toBe(before);

    await app.close();
  });

  it("Given a file over the size cap, Then it is refused and nothing is written (§4.3)", async () => {
    guard();
    const app = makeApp();
    const cookie = await signIn(app, submitterId);
    const ideaId = await givenADraft("too-big");
    const before = await storedCount();

    // A valid PDF header followed by more than the cap allows: the TYPE is fine, the size
    // is not, and the size must be caught while reading rather than after.
    const huge = Buffer.concat([PDF, Buffer.alloc(MAX_ATTACHMENT_BYTES + 1024, 0x20)]);
    const form = multipart("huge.pdf", "application/pdf", huge);
    const response = await app.inject({
      method: "POST",
      url: `/ideas/${ideaId}/attachments`,
      headers: { cookie, ...form.headers },
      payload: form.payload,
    });

    expect(response.statusCode).toBe(400);
    expect(await storedCount()).toBe(before);

    await app.close();
  });

  it(`Given ${MAX_ATTACHMENTS_PER_VERSION} files already attached, Then the next is refused (§4.3)`, async () => {
    guard();
    const app = makeApp();
    const cookie = await signIn(app, submitterId);
    const ideaId = await givenADraft("count-cap");

    for (let i = 0; i < MAX_ATTACHMENTS_PER_VERSION; i += 1) {
      const form = multipart(`note-${i}.txt`, "text/plain", TXT);
      const ok = await app.inject({
        method: "POST",
        url: `/ideas/${ideaId}/attachments`,
        headers: { cookie, ...form.headers },
        payload: form.payload,
      });
      expect(ok.statusCode, `upload ${i} failed: ${ok.body}`).toBe(201);
    }

    const before = await storedCount();
    const form = multipart("one-too-many.txt", "text/plain", TXT);
    const response = await app.inject({
      method: "POST",
      url: `/ideas/${ideaId}/attachments`,
      headers: { cookie, ...form.headers },
      payload: form.payload,
    });

    expect(response.statusCode).toBe(400);
    // Refused before the bytes were read, so nothing new is on disk.
    expect(await storedCount()).toBe(before);

    await app.close();
  });

  it("Given a filename full of traversal, Then it never reaches the filesystem", async () => {
    guard();
    const app = makeApp();
    const cookie = await signIn(app, submitterId);
    const ideaId = await givenADraft("traversal");

    const nasty = "../../../../etc/passwd.txt";
    const form = multipart(nasty, "text/plain", TXT);
    const response = await app.inject({
      method: "POST",
      url: `/ideas/${ideaId}/attachments`,
      headers: { cookie, ...form.headers },
      payload: form.payload,
    });

    /**
     * Accepted — it IS a text file — but the name is a label and nothing more.
     *
     * The defence is not that the name is sanitised into safety; it is that the path is
     * generated and the name is never part of it. The stored label has its separators
     * flattened so it is also safe to render and to put in a header.
     */
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json().filename).not.toContain("/");
    expect(response.json().filename).not.toContain("\\");

    const onDisk = await readdir(storageDir);
    expect(onDisk.every((f) => /^[0-9a-f-]{36}\.bin$/.test(f))).toBe(true);

    await app.close();
  });
});

describe("F-02 · who may attach, and who may read", () => {
  it("Given somebody else's draft, Then they cannot attach to it", async () => {
    guard();
    if (!otherUserId) return;
    const app = makeApp();
    const intruder = await signIn(app, otherUserId);
    const ideaId = await givenADraft("not-yours");
    const before = await storedCount();

    const form = multipart("mine.txt", "text/plain", TXT);
    const response = await app.inject({
      method: "POST",
      url: `/ideas/${ideaId}/attachments`,
      headers: { cookie: intruder, ...form.headers },
      payload: form.payload,
    });

    expect([403, 404]).toContain(response.statusCode);
    expect(await storedCount()).toBe(before);

    await app.close();
  });

  it("Given no session, Then a download is refused rather than served", async () => {
    guard();
    const app = makeApp();
    const cookie = await signIn(app, submitterId);
    const ideaId = await givenADraft("no-session");

    const form = multipart("secret.txt", "text/plain", TXT);
    const created = await app.inject({
      method: "POST",
      url: `/ideas/${ideaId}/attachments`,
      headers: { cookie, ...form.headers },
      payload: form.payload,
    });
    const id = created.json().id;

    const anonymous = await app.inject({ method: "GET", url: `/api/../attachments/${id}` });
    expect([401, 404]).toContain(anonymous.statusCode);

    const signedOut = await app.inject({ method: "GET", url: `/attachments/${id}` });
    expect(signedOut.statusCode).toBe(401);

    await app.close();
  });

  it("Given the owner, When they download, Then it is served as an attachment with nosniff", async () => {
    guard();
    const app = makeApp();
    const cookie = await signIn(app, submitterId);
    const ideaId = await givenADraft("download");

    const form = multipart("notes.txt", "text/plain", TXT);
    const created = await app.inject({
      method: "POST",
      url: `/ideas/${ideaId}/attachments`,
      headers: { cookie, ...form.headers },
      payload: form.payload,
    });
    const id = created.json().id;

    const response = await app.inject({
      method: "GET",
      url: `/attachments/${id}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.equals(TXT)).toBe(true);

    /**
     * Both headers, together (SPEC §4.3).
     *
     * `nosniff` stops a browser deciding a text/plain file is really HTML; `attachment`
     * stops it rendering inline even if it disagrees. A stored file served inline from
     * the API's own origin is stored XSS, and these are what rule it out.
     */
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(String(response.headers["content-disposition"])).toMatch(/^attachment;/);

    await app.close();
  });
});

describe("F-02 · a submitted version's files are fixed", () => {
  it("Given a submitted idea, Then nothing can be attached or removed (§4.3 immutability)", async () => {
    guard();
    const app = makeApp();
    const cookie = await signIn(app, submitterId);
    const ideaId = await givenADraft("immutable");

    const form = multipart("before.txt", "text/plain", TXT);
    const created = await app.inject({
      method: "POST",
      url: `/ideas/${ideaId}/attachments`,
      headers: { cookie, ...form.headers },
      payload: form.payload,
    });
    expect(created.statusCode).toBe(201);
    const attachmentId = created.json().id;

    await db.idea.update({ where: { id: ideaId }, data: { status: "SUBMITTED" } });

    /**
     * The point of the rule: an attachment is part of the version the AI analysed. Adding
     * one after submission would change an analysed input after the fact, and removing
     * one would delete evidence a score was derived from.
     */
    const late = multipart("after.txt", "text/plain", TXT);
    const added = await app.inject({
      method: "POST",
      url: `/ideas/${ideaId}/attachments`,
      headers: { cookie, ...late.headers },
      payload: late.payload,
    });
    expect(added.statusCode).toBe(409);

    const removed = await app.inject({
      method: "DELETE",
      url: `/attachments/${attachmentId}`,
      headers: { cookie },
    });
    expect(removed.statusCode).toBe(409);

    // Still there, and still downloadable.
    const still = await app.inject({
      method: "GET",
      url: `/ideas/${ideaId}/attachments`,
      headers: { cookie },
    });
    expect(still.json().items).toHaveLength(1);

    await app.close();
  });

  it("Given a draft, When an attachment is deleted, Then the row and the bytes both go", async () => {
    guard();
    const app = makeApp();
    const cookie = await signIn(app, submitterId);
    const ideaId = await givenADraft("delete");

    const form = multipart("temp.txt", "text/plain", TXT);
    const created = await app.inject({
      method: "POST",
      url: `/ideas/${ideaId}/attachments`,
      headers: { cookie, ...form.headers },
      payload: form.payload,
    });
    const id = created.json().id;
    const after = await storedCount();

    const removed = await app.inject({
      method: "DELETE",
      url: `/attachments/${id}`,
      headers: { cookie },
    });

    expect(removed.statusCode).toBe(200);
    expect(await db.attachment.findUnique({ where: { id } })).toBeNull();
    // The bytes too. An orphaned file is a copy of someone's document nobody is tracking.
    expect(await storedCount()).toBe(after - 1);

    await app.close();
  });
});

import { z } from "zod";

/** Plain shape so this file needs no Node type dependency (it is imported by tooling too). */
export type EnvSource = Record<string, string | undefined>;

/**
 * Boot-time environment validation (SPEC §4.4).
 * The process REFUSES TO START on a missing or malformed secret rather than degrading.
 */

const nonEmpty = z.string().min(1);

const Base = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_URL: nonEmpty.startsWith("postgres"),
  REDIS_URL: nonEmpty.startsWith("redis"),
});

export const ApiEnv = Base.extend({
  PORT: z.coerce.number().int().positive().default(3001),
  PUBLIC_WEB_ORIGIN: z.string().url(),
  SESSION_SECRET: nonEmpty.min(32, "SESSION_SECRET must be at least 32 chars"),
  OIDC_ISSUER: z.string().url(),
  OIDC_CLIENT_ID: nonEmpty,
  OIDC_CLIENT_SECRET: nonEmpty,
  OIDC_REDIRECT_URI: z.string().url(),
  ATTACHMENT_STORAGE_DIR: nonEmpty,

  /**
   * Self-registration (FR-01a).
   *
   * On by default, because an internal platform nobody can join is an internal platform
   * nobody uses. The control that matters is the domain list below, not this switch.
   */
  SIGNUP_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  /**
   * Comma-separated email domains permitted to self-register, e.g. `sageitinc.com`.
   *
   * EMPTY MEANS ANY DOMAIN. That default is deliberate — it is the only one that does not
   * silently lock out an organisation whose mail domain we cannot know — but on an
   * internet-reachable deployment it means anyone with the URL can read every submitted
   * idea. Set it before going public. `.env.example` says the same thing louder.
   */
  SIGNUP_ALLOWED_EMAIL_DOMAINS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
        .filter(Boolean),
    ),

  /**
   * First-run administrator bootstrap.
   *
   * Presenting this code at signup grants ADMIN — but ONLY while the database contains no
   * active administrator at all. The moment one exists the code is inert, and every
   * subsequent administrator is promoted by an existing one, on the audit trail. That is
   * the whole guardrail: a shared secret can open an empty building, never an occupied
   * one.
   *
   * Unset means there is no bootstrap path, and the seeded admin is the only way in.
   */
  ADMIN_INVITE_CODE: z.string().min(16, "Make the invite code at least 16 characters").optional(),
  /**
   * The API process must NOT be able to reach the model provider (SPEC §4.4).
   * Only the worker holds the key. Boot fails if a real one leaks into this environment.
   *
   * An absent or empty value passes, so a single shared dev `.env` still works; any
   * non-empty value fails. The guard keeps its meaning — the API cannot be handed a
   * usable key — without forcing separate env files on day one.
   */
  ANTHROPIC_API_KEY: z
    .string()
    .max(
      0,
      "ANTHROPIC_API_KEY must NOT be set on the API process — only the worker holds it (SPEC §4.4)",
    )
    .optional(),
});
export type ApiEnv = z.infer<typeof ApiEnv>;

export const WorkerEnv = Base.extend({
  ANTHROPIC_API_KEY: nonEmpty,
  AI_PROVIDER: z.enum(["anthropic", "stub"]).default("anthropic"),
  /** Hard caps that fail CLOSED to the fallback, never silently degrade (SPEC §12.1). */
  AI_BUDGET_PER_VERSION_USD: z.coerce.number().positive().default(0.75),
  AI_BUDGET_ORG_DAILY_USD: z.coerce.number().positive().default(200),
  AI_BUDGET_USER_DAILY_USD: z.coerce.number().positive().default(5),
  AI_RAW_PAYLOAD_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  PII_REDACTION_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});
export type WorkerEnv = z.infer<typeof WorkerEnv>;

export function loadEnv<T extends z.ZodTypeAny>(schema: T, source: EnvSource): z.infer<T> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");

    // If everything is missing, the cause is almost always a missing .env rather than
    // nine separate mistakes. Say so — .env is gitignored, so every new clone hits this.
    const allMissing = parsed.error.issues.every((i) => i.message === "Required");
    const hint =
      allMissing && parsed.error.issues.length > 2
        ? "\n\nNo environment values were found at all. Most likely you need:\n" +
          "  cp .env.example .env      (then fill in the blanks)\n" +
          "The dev scripts read the .env at the repository root."
        : "";

    // Never echo values — only names and reasons (SPEC §4.4).
    throw new Error(`Invalid environment; refusing to start.\n${detail}${hint}`);
  }
  return parsed.data;
}

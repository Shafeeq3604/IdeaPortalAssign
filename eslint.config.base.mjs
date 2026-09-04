import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

/**
 * Shared Node/TypeScript ESLint base for every package OTHER than apps/web and
 * packages/ui (both React/browser code with their own config).
 *
 * `pnpm lint` was a real gap: every package but apps/web had a `"lint": "echo ..."`
 * stub, so the API routes, the scoring engine, and the AI provider layer had never
 * actually been linted despite CLAUDE.md documenting `pnpm lint` as real. One shared
 * base, imported by each package's own thin `eslint.config.mjs`, is how ten packages
 * get real linting without ten near-identical copies of the same rule set to drift.
 */
export const base = defineConfig([
  // `.deploy` is a committed `turbo prune` snapshot (apps/api, apps/worker, apps/web —
  // see scripts/prepare-deploy.mjs) that mirrors other workspace packages' source
  // verbatim, relative-path imports included; linting it directly resolves those
  // imports against the wrong depth and fails, e.g. apps/worker/eslint.config.mjs's
  // own `../../eslint.config.base.mjs` import breaking once nested under
  // apps/web/.deploy/full/apps/worker/.
  globalIgnores(["dist", "node_modules", "coverage", "generated", "**/.deploy/**"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // CLAUDE.md: "no `any`, no non-null `!` outside tests." Both are enforced by
      // eye today; this is what makes a regression a lint failure instead of a
      // review miss.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      // Prisma/Fastify payloads are routinely destructured for the one field a
      // handler needs; erroring on the rest would fight the codebase's own style
      // rather than catch a real mistake. Still flags a plain unused local/import.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Non-null assertions and `any` are the test suite's own business (CLAUDE.md
    // says so explicitly): mocking a partial Fastify request or Prisma client
    // honestly needs both sometimes.
    files: ["**/*.test.ts", "**/*.spec.ts", "**/test/**/*.ts", "**/tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
]);

export default base;

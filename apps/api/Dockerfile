# syntax=docker/dockerfile:1.7

# ═══════════════════════════════════════════════════════════════════════════
# IEP API (apps/api) — one of the two deployables in the "modular monolith +
# async worker" architecture (IEP-SPEC.md). Build from the REPO ROOT:
#
#   docker build -f apps/api/Dockerfile -t iep-api .
#
# This runs the real TypeScript source through `tsx`, the same way `pnpm dev`
# does — not `tsc` output. That is not a shortcut taken for convenience:
# `pnpm build` followed by `node dist/main.js` does not work anywhere in this
# workspace today. Every `@iep/*` package's `main`/`exports` field points at
# its own `src/index.ts`, and nothing rewrites those to a `dist/` path for a
# compiled run — verified directly, not assumed: it fails with
# ERR_MODULE_NOT_FOUND the moment `dist/main.js` reaches its first workspace
# import. Running through `tsx` sidesteps that without changing how any
# package resolves imports anywhere else. Fixing the workspace's build output
# so a real compiled artifact could ship is a bigger, separate change.
#
# Every secret and connection string this service needs (SESSION_SECRET,
# OIDC_*, DATABASE_URL, REDIS_URL, PUBLIC_WEB_ORIGIN, ATTACHMENT_STORAGE_DIR)
# has NO default and is required at boot (SPEC §4.4, packages/contracts/src/
# env.ts) — the process refuses to start on a missing one rather than run
# with a guessed value. None is baked into this image; supply them all as
# container env vars.
# ═══════════════════════════════════════════════════════════════════════════

FROM node:22-bookworm-slim AS deps
RUN corepack enable
# Debian slim ships no OpenSSL by default. Without it, Prisma's engine-fetch step cannot
# detect which libssl variant is actually present and silently guesses "openssl-1.1.x" —
# verified directly: the build log shows exactly that warning without this line. Bookworm
# ships OpenSSL 3.0.x, so a guessed 1.1.x engine binary would not match at query time.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# The whole workspace, not just apps/api: pnpm needs every member's
# package.json to resolve the workspace graph, and @iep/api depends on
# @iep/contracts, @iep/db and @iep/evaluation by real source, not a built
# artifact (see above) — that source has to be here for the app to run at
# all, not just to install.
COPY . .

# `--filter "@iep/api..."` installs @iep/api and only the workspace and
# external dependencies it actually needs — apps/web's and the test suites'
# far heavier toolchains (Vite, Playwright, Lighthouse CI) are never
# installed. No `--prod`: tsx itself is a devDependency of @iep/api and is
# what actually runs the server (see above), so devDependencies stay in.
# This also runs @iep/db's `postinstall` (`prisma generate`), producing a
# client whose native query engine matches THIS image, not the host that
# built it.
RUN pnpm install --frozen-lockfile --filter "@iep/api..."

FROM node:22-bookworm-slim AS runtime
RUN corepack enable
# Debian slim ships no OpenSSL by default. Without it, Prisma's engine-fetch step cannot
# detect which libssl variant is actually present and silently guesses "openssl-1.1.x" —
# verified directly: the build log shows exactly that warning without this line. Bookworm
# ships OpenSSL 3.0.x, so a guessed 1.1.x engine binary would not match at query time.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app /app

# Local disk survives a single, never-restarted instance and nothing more —
# fine for a first deploy, wrong the moment there is more than one API
# replica or a redeploy. Moving attachments to shared object storage is a
# tracked, separate gap, not something this Dockerfile can paper over.
RUN mkdir -p /app/apps/api/.storage && chown -R node:node /app/apps/api/.storage
USER node

WORKDIR /app/apps/api

# The default from packages/contracts/src/env.ts — override with $PORT.
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["pnpm", "exec", "tsx", "src/main.ts"]

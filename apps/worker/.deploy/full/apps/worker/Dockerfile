# syntax=docker/dockerfile:1.7

# ═══════════════════════════════════════════════════════════════════════════
# IEP Worker (apps/worker) — the third deployable in the "modular monolith +
# async worker" architecture (IEP-SPEC.md): a BullMQ consumer for the AI
# analysis and ranking-recompute queues, no HTTP surface.
#
# BUILD CONTEXT IS THIS DIRECTORY (apps/worker), NOT THE REPO ROOT — see
# apps/api/Dockerfile's header for the full reasoning (Validra builds each
# service using that service's own directory as context). `.deploy/` is a
# `turbo prune --docker` snapshot committed inside this directory for the same
# reason: it mirrors the repo root's relevant subset so the build never needs to
# reach outside apps/worker.
#
#   docker build -f apps/worker/Dockerfile apps/worker
#
# `.deploy/` is generated, not hand-maintained: run `pnpm run deploy:prune` after
# any change to pnpm-lock.yaml or to a workspace package this app depends on, then
# commit the result. `pnpm run preflight` builds all three services with this
# exact restricted context to catch a stale snapshot before a push.
#
# Mirrors apps/api/Dockerfile deliberately — same base image, same OpenSSL fix,
# same tsx-not-tsc execution, same .deploy snapshot approach — so the two images
# behave the same way under the same operational assumptions. Do not let them
# drift apart.
#
# Runs the real TypeScript source through `tsx`, the same way `pnpm dev` does —
# not `tsc` output. `pnpm build` followed by `node dist/main.js` does not work
# anywhere in this workspace today: every `@iep/*` package's `main`/`exports`
# field points at its own `src/index.ts`, and nothing rewrites those to a `dist/`
# path for a compiled run — verified directly against this exact worker, not
# assumed: it fails with ERR_MODULE_NOT_FOUND the moment `dist/main.js` reaches
# its first workspace import.
#
# `ANTHROPIC_API_KEY` belongs ONLY here — never in the API's environment
# (SPEC §4.4: the API refuses to start if it can see one). `DATABASE_URL`
# and `REDIS_URL` have no defaults either and are required at boot
# (packages/contracts/src/env.ts). None of these are baked into this image;
# supply them all as container env vars.
# ═══════════════════════════════════════════════════════════════════════════

FROM node:22-bookworm-slim AS deps
RUN corepack enable
# Debian slim ships no OpenSSL by default. Without it, Prisma's engine-fetch step cannot
# detect which libssl variant is actually present and silently guesses "openssl-1.1.x" —
# bookworm ships OpenSSL 3.0.x, so a guessed 1.1.x engine binary would not match at query
# time. Same fix as apps/api/Dockerfile, for the same reason: the worker depends on
# @iep/db too.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# The pruned mirror, not the raw directory: it already contains this app's own source
# plus every workspace package it depends on (@iep/ai, @iep/contracts, @iep/db,
# @iep/evaluation, @iep/scoring) at the paths pnpm's workspace resolution expects.
# `turbo prune` writes the pruned lockfile as a SIBLING of full/, not inside it.
COPY .deploy/full/ .
COPY .deploy/pnpm-lock.yaml .

# `--filter "@iep/worker..."` installs @iep/worker and only the workspace and external
# dependencies it actually needs. No `--prod`: tsx itself is a devDependency of
# @iep/worker and is what actually runs it (see above), so devDependencies stay in.
# This also runs @iep/db's `postinstall` (`prisma generate`), producing a client whose
# native query engine matches THIS image, not the host that built it.
RUN pnpm install --frozen-lockfile --filter "@iep/worker..."

FROM node:22-bookworm-slim AS runtime
RUN corepack enable
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app /app
USER node

WORKDIR /app/apps/worker

# No HTTP surface to probe — this consumes queues, it does not serve requests. Liveness
# is "can it reach the Redis it consumes from," checked directly rather than inferred
# from an endpoint that does not exist.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "--input-type=module", "-e", "\
import Redis from 'ioredis';\
const r = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });\
try { await r.connect(); await r.ping(); r.disconnect(); process.exit(0); }\
catch { process.exit(1); }\
"]

CMD ["pnpm", "exec", "tsx", "src/main.ts"]

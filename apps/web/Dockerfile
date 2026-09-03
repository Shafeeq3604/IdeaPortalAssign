# syntax=docker/dockerfile:1.7

# ═══════════════════════════════════════════════════════════════════════════
# IEP Web (apps/web) — the Vite/React SPA. Build from the REPO ROOT, same as
# the other two:
#
#   docker build -f apps/web/Dockerfile -t iep-web .
#
# Unlike apps/api and apps/worker, this one DOES ship a real build: a static
# SPA has no workspace-import problem at runtime, since Vite bundles
# everything into plain JS before nginx ever sees it. The final image carries
# no node_modules, no source, no Node runtime at all — just the built assets
# behind nginx.
#
# The app calls its API at the same-origin path `/api/...` (apps/web/src/app/
# api-client.ts) so the session cookie needs no CORS or SameSite exception —
# in dev that's Vite's own proxy (apps/web/vite.config.ts); here it's nginx,
# reverse-proxying `/api/*` to whatever `$API_UPSTREAM` points at (default
# `http://api:3001`, i.e. a sibling "api" service — override for anything
# else) and stripping the prefix, matching the dev proxy's `rewrite` exactly.
# Get this wrong and the SPA loads but every request silently 404s.
# ═══════════════════════════════════════════════════════════════════════════

FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app

# The whole workspace: pnpm needs every member's package.json to resolve the workspace
# graph, and @iep/web depends on @iep/contracts and @iep/ui by real source.
COPY . .

# `--filter "@iep/web..."` installs @iep/web and only what it actually needs — the API
# and worker's Prisma/BullMQ stack, and the test suites' Playwright/Lighthouse toolchains,
# are never installed here.
RUN pnpm install --frozen-lockfile --filter "@iep/web..."
RUN pnpm --filter @iep/web build

FROM nginx:1.27-alpine AS runtime

# `${API_UPSTREAM}` is filled in by the official image's own envsubst-on-boot templating
# (docker-entrypoint.d), which only substitutes variables that are ACTUALLY set as
# container env vars — nginx's own bare `$host`/`$uri`/`$scheme` etc. below are left
# alone precisely because nothing sets an env var by those names.
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

ENV API_UPSTREAM=http://api:3001
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1/health"]

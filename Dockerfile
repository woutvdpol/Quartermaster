# syntax=docker/dockerfile:1.7
#
# Quartermaster container image.
#
# Targets:
#   runner  (default) – minimal production image running the Next.js standalone server
#   migrate           – one-shot image that runs `prisma migrate deploy` (Compose service /
#                       Kubernetes Job or initContainer). Also able to run `prisma db seed`.
#
#   docker build -t quartermaster:dev .
#   docker build --target migrate -t quartermaster-migrate:dev .
#
# Base image: Debian bookworm-slim (glibc) rather than Alpine (musl). `sharp` (image variants,
# next/image optimisation) ships prebuilt libvips binaries for both, but glibc is its primary,
# best-tested platform and avoids musl allocator/perf quirks; Prisma tooling likewise targets
# glibc first. The size difference is small compared to the risk of native-module surprises.

ARG NODE_IMAGE=node:24-bookworm-slim

# ─── base ────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ─── deps: full dependency tree (incl. dev deps for build + prisma CLI) ──────
FROM base AS deps
# openssl/ca-certificates: used by Prisma tooling and TLS connections to managed Postgres.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Schema + config are needed by the `postinstall` hook (`prisma generate`).
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN --mount=type=cache,target=/root/.npm npm ci

# ─── build: generate Prisma client + Next.js standalone build ────────────────
FROM deps AS build
COPY . .
# Placeholder so modules that read DATABASE_URL at import time can be evaluated during
# `next build`. No connection is made at build time; the real value is runtime config.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    NODE_ENV=production
RUN npx prisma generate && npm run build

# ─── migrate: one-shot `prisma migrate deploy` ───────────────────────────────
# Reuses the full dependency tree (prisma CLI, dotenv, tsx for seeding). Run as a
# Kubernetes Job / initContainer before rolling out a new `runner` image.
FROM deps AS migrate
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false
COPY --from=build /app/src/generated ./src/generated
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
COPY src ./src
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

# ─── runner: production server ───────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    UPLOADS_DIR=/app/uploads

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Non-root runtime user (fixed UID/GID so Kubernetes securityContext / volume perms match).
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs --no-create-home nextjs

COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

# Upload storage (mount a volume / PVC here).
RUN mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads
VOLUME ["/app/uploads"]

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "server.js"]

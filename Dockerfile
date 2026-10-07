# syntax=docker/dockerfile:1.7
#
# Quartermaster container image.
#
# Targets:
#   runner  (default) – minimal production image running the Next.js standalone server
#   migrate           – one-shot image that runs `prisma migrate deploy` (Compose service /
#                       Kubernetes Job). Also able to run `prisma db seed` and the ETL (`npm run etl`).
#   worker            – pg-boss background worker (mail, PDFs, newsletter fan-out, cron); same
#                       contents as `migrate`, different command.
#
#   docker build -t quartermaster:dev .
#   docker build --target migrate -t quartermaster-migrate:dev .
#   docker build --target worker  -t quartermaster-worker:dev .
#
#   Optional: --build-arg NEXT_DEPLOYMENT_ID=<git sha> enables Next.js version-skew protection
#   (clients of an older build do a hard reload instead of calling unknown server actions during a
#   rolling update). Use the same value for every target built from one commit.
#   Optional: --build-arg NEXT_PUBLIC_TURNSTILE_SITE_KEY (fallback only; prefer runtime env TURNSTILE_SITE_KEY).
#
# Base image: Debian bookworm-slim (glibc) rather than Alpine (musl). `sharp` (image variants,
# next/image optimisation) ships prebuilt libvips binaries for both, but glibc is its primary,
# best-tested platform and avoids musl allocator/perf quirks; Prisma tooling likewise targets
# glibc first. The size difference is small compared to the risk of native-module surprises.
#
# All targets run as the same non-root user (UID/GID 1001) so the shared uploads volume has one
# owner, and Kubernetes `runAsUser: 1001` / `fsGroup: 1001` match the image.

ARG NODE_IMAGE=node:24-bookworm-slim

# ─── base ────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# Non-root runtime user (fixed UID/GID so Kubernetes securityContext / volume perms match).
# HOME is a real, writable-by-owner directory so tools that want a cache dir don't hit "/".
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs --home-dir /home/nextjs --create-home nextjs

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
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ─── build: generate Prisma client + Next.js standalone build ────────────────
FROM deps AS build
COPY . .
# Placeholder so modules that read DATABASE_URL at import time can be evaluated during
# `next build`. No connection is made at build time; the real value is runtime config.
ARG NEXT_DEPLOYMENT_ID=""
# NEXT_PUBLIC_* values are inlined into the client bundle at build time — setting them on the
# running container has no effect. The Turnstile site key is public (not a secret); without it the
# widget renders nothing and production DENIES every protected shop form (register, newsletter, …).
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=""
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    NODE_ENV=production \
    NEXT_DEPLOYMENT_ID=${NEXT_DEPLOYMENT_ID} \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY}
# The standalone tracer can pick up a local ./uploads dir; it must never ship in the image.
RUN npx prisma generate && npm run build \
 && rm -rf .next/standalone/uploads

# ─── migrate: one-shot `prisma migrate deploy` ───────────────────────────────
# Reuses the full dependency tree (prisma CLI, dotenv, tsx for seeding/ETL/worker). Run as a
# Kubernetes Job before rolling out a new `runner` image (see docs/deploy.md).
# Binaries are invoked from node_modules/.bin instead of `npx`, so nothing tries to write an npm
# cache — the container works with a read-only root filesystem (tsx only needs a writable /tmp).
FROM deps AS migrate
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PATH=/app/node_modules/.bin:$PATH \
    UPLOADS_DIR=/app/uploads
# src/generated (Prisma client) already exists: `npm ci` ran the `prisma generate` postinstall in
# `deps`. Not depending on the `build` stage keeps these images independent of `next build`.
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json package.json ./
COPY src ./src
COPY scripts ./scripts
RUN mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads
USER nextjs
CMD ["prisma", "migrate", "deploy"]

# ─── worker: pg-boss jobs + cron ─────────────────────────────────────────────
# Needs the uploads volume too (invoice/certificate PDFs, lead-photo cleanup).
FROM migrate AS worker
STOPSIGNAL SIGTERM
CMD ["tsx", "scripts/worker.ts"]

# ─── runner: production server ───────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    UPLOADS_DIR=/app/uploads

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

# Writable runtime dirs. With a read-only root filesystem (Kubernetes) mount volumes here:
# /app/uploads (PVC, shared with the worker) and /app/.next/cache (emptyDir, ISR/image cache).
RUN mkdir -p /app/uploads /app/.next/cache \
 && chown nextjs:nodejs /app/uploads /app/.next/cache
VOLUME ["/app/uploads"]

USER nextjs
EXPOSE 3000
STOPSIGNAL SIGTERM

# Docker/Compose only — Kubernetes ignores HEALTHCHECK and uses the probes in deploy/k8s.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "server.js"]

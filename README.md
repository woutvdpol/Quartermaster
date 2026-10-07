# Quartermaster

Multi-tenant webshop platform for militaria dealers. Successor of **Concept500** (Laravel 12 · Backpack · Livewire), rebuilt on **Next.js** and **Prisma**.

> **Status:** phase 0–2 done — admin (catalog, orders, customers, sourcing, CMS, newsletter, settings, shipping, Mollie, users, platform) is functional. Next: phase 3, the storefront. Plans and decisions in [`docs/`](docs).

## Goals

- **Admin first.** A fast, data-dense back office for stock, orders, customers, purchasing and content.
- **Then the shop.** Catalogue, product pages, 15-minute basket reservations, Mollie checkout.
- **Multi-tenant from day one.** One installation, many shops. `SUPERADMIN` manages the platform; `OWNER` manages their own shop.
- **Fix structural issues** of Concept500 rather than port them (webhook-driven order completion, real stock reservations, server-side authorization, typed settings, country-based shipping zones).

## Planned stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router, React Server Components, Server Actions), TypeScript strict |
| Database | PostgreSQL + Prisma |
| Auth | In-house, built on Node `crypto` (scrypt, DB sessions, optional TOTP 2FA) |
| UI | Tailwind CSS v4, shadcn/ui, TanStack Table, React Hook Form + Zod |
| Media | Local storage behind a `StorageDriver` interface, variants via `sharp` |
| Payments | Mollie |
| Mail / PDF | React Email + SMTP, `@react-pdf/renderer` |
| Jobs | pg-boss (Postgres-backed queue) + cron route handlers |
| Tests | Vitest, Playwright |
| Runtime | Docker Compose locally, Kubernetes later |

## Roadmap

| Phase | Scope |
|---|---|
| 0 · Foundation | Repo, CI, Docker, Prisma schema with tenants, auth + roles, admin shell, audit log |
| 1 · Admin core | Products & photos, categories/tags, orders, customers, stock overview |
| 2 · Admin complete | Dashboard, typed settings, shipping zones, payment methods, block CMS, menus, newsletter, purchasing & margin |
| 3 · Shop | Catalogue & search, product page, wishlist, basket reservations, checkout, Mollie webhooks, mails, account, SEO |
| 4 · Go-live | Migration tooling, end-to-end tests, cut-over |
| 5 · Extras | Facet taxonomy, saved searches & alerts, certificates of authenticity, offers, per-country compliance, … |

Work in progress (modelled, not yet built): shipment tracking, invoices.

## Documentation

| File | Contents |
|---|---|
| [`docs/00-plan.md`](docs/00-plan.md) | Migration plan, architecture, roadmap, risks |
| [`docs/01-vragen.md`](docs/01-vragen.md) | Open questions put to the owner |
| [`docs/02-besluiten.md`](docs/02-besluiten.md) | Owner decisions (take precedence over the plan) and auth design |
| [`docs/analysis/01-admin-inventory.md`](docs/analysis/01-admin-inventory.md) | Full inventory of the Concept500 admin |
| [`docs/analysis/02-data-model.md`](docs/analysis/02-data-model.md) | Current data model, issues, proposed model, migration strategy |
| [`docs/analysis/schema.draft.prisma`](docs/analysis/schema.draft.prisma) | Prisma mapping of the legacy schema (reference only) |
| [`docs/analysis/03-shop-and-integrations.md`](docs/analysis/03-shop-and-integrations.md) | Shop flows, integrations, hosting, SEO, feature ideas |
| [`docs/analysis/04-testdump-bevindingen.md`](docs/analysis/04-testdump-bevindingen.md) | Findings from the Concept500 test-shop dump |
| [`docs/design/`](docs/design) | Admin & shop design mockups (variants A, B, C) |

Docs are written in Dutch; code and code comments will be in English.

## Getting started

Requirements: Node.js 24, npm, Docker (for Postgres).

```bash
cp .env.example .env
# Generate APP_ENCRYPTION_KEY and paste it into .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

npm install          # also runs `prisma generate`
npm run db:up        # Postgres 18 on 127.0.0.1:54329
npm run db:migrate   # prisma migrate dev
npm run db:seed      # local superadmin + demo tenant (credentials from .env)
npm run db:seed:demo # optional: products with photos, orders, customers, zones, page views
npm run dev          # http://localhost:3000
```

Useful checks: `npm run lint`, `npx next typegen && npm run typecheck`, `npm test`, `npm run build`.

## Local data

`.local/` holds private material such as database dumps. It is git-ignored and must never be committed.

## Running with Docker

The `Dockerfile` is multi-stage and builds on `node:24-bookworm-slim` (glibc — the best-supported platform for `sharp` and Prisma tooling):

| Target | Purpose |
|---|---|
| `runner` (default) | Next.js standalone server, non-root user `nextjs` (UID 1001), port `3000`, uploads at `/app/uploads` |
| `migrate` | One-shot `prisma migrate deploy` (full dependency tree, so it can also run `npx prisma db seed`) |

```bash
docker build -t quartermaster:dev .
docker build --target migrate -t quartermaster-migrate:dev .
```

Full stack with Compose (the `app` and `migrate` services sit behind the `app` profile, so `npm run db:up` still starts only Postgres):

```bash
cp .env.example .env   # set APP_ENCRYPTION_KEY; DATABASE_URL is overridden to postgres:5432
docker compose --profile app up -d --build
curl localhost:3000/api/health   # liveness
curl localhost:3000/api/ready    # readiness (checks the database)
docker compose --profile app down
```

Startup order: `postgres` (healthy) → `migrate` (completes) → `app`. Uploads persist in the `uploads` named volume. Stop `npm run dev` first if it already uses port 3000.

Seed inside Compose (optional): `docker compose --profile app run --rm migrate npx prisma db seed`.

## Kubernetes notes

Not deployed yet; the image is prepared for it:

- **Stateless app.** All state lives in Postgres and the uploads volume. Mount a PersistentVolumeClaim at `/app/uploads` (needs `ReadWriteMany` once running more than one replica — or move to object storage behind the `StorageDriver` interface).
- **Probes.** `livenessProbe` → `GET /api/health` (no DB access, so a DB outage never restarts pods); `readinessProbe` → `GET /api/ready` (runs `SELECT 1`, returns 503 when the database is unreachable).
- **Migrations.** Run the `migrate` image as a Job (e.g. Helm pre-upgrade hook / Argo sync wave) or as an `initContainer`, before the new `runner` pods roll out. `prisma migrate deploy` is idempotent and uses an advisory lock, so concurrent runs are safe.
- **Configuration.** Everything is runtime env: `DATABASE_URL`, `APP_ENCRYPTION_KEY`, `PLATFORM_HOST` from a Secret/ConfigMap — one image is promoted across environments. Never bake `.env` into the image (it is excluded by `.dockerignore`).
- **Multiple replicas.** Set the same `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` at build time for all instances, and consider `deploymentId` for version-skew protection (see the Next.js self-hosting guide). The Next.js cache is per pod by default.
- **Security context.** `runAsNonRoot: true`, `runAsUser: 1001`, `fsGroup: 1001`; the root filesystem can be read-only apart from `/app/uploads` and `/app/.next/cache` (mount an `emptyDir` there).
- **Ingress.** Terminate TLS at the ingress/reverse proxy; disable response buffering there so streaming works.

## Background jobs

Mail, newsletter fan-out and recurring maintenance run as [pg-boss](https://pgboss.io) jobs in the
same Postgres database (schema `pgboss`, created automatically). Web code only *queues* work; a separate
worker process executes it.

```bash
npx tsx scripts/worker.ts                 # local worker (reads .env)
docker compose --profile app up -d worker # containerised worker
```

- **Jobs** are defined with `defineJob(name, zodSchema, handler)` and listed in `src/server/jobs/definitions.ts`;
  queue them with `enqueue(name, payload, { tx? })` (`tx` = inside a Prisma transaction). Handlers can be
  run in-process with `runJobNow()` (tests, scripts).
- **Mail** always goes through the `mail.send` job (6 attempts, exponential backoff): `queueMail()`,
  `queueOrderConfirmation(tenantId, orderId)`, `requestPasswordResetEmail()`. Templates are React Email
  components in `src/emails/`. Without `SMTP_URL`, mails are written to `.local/mail/*.eml`.
- **Cron** (UTC, registered by the worker): `reservations.expire` every minute, `rate-limit.prune` hourly.
  Alternatively trigger them externally, e.g. from a Kubernetes CronJob:
  `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/reservations.expire`.
  Set `WORKER_CRON=0` on the worker if only the external trigger should run them.
- **Kubernetes**: run the worker as its own Deployment (any number of replicas; jobs are claimed with
  `SKIP LOCKED`). On SIGTERM it stops fetching and waits up to `WORKER_SHUTDOWN_TIMEOUT_MS` (default 25 s)
  for running jobs — keep `terminationGracePeriodSeconds` above that.
- **Newsletter**: double opt-in (`/api/newsletter/confirm`), HMAC-signed unsubscribe links with RFC 8058
  one-click (`List-Unsubscribe` + `List-Unsubscribe-Post`, `POST /api/newsletter/unsubscribe`), campaigns
  fanned out in batches of 200, monthly quota from `platform.newsletterQuota`.

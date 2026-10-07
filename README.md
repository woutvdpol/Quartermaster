# Quartermaster

Multi-tenant webshop platform for militaria dealers. Successor of **Concept500** (Laravel 12 · Backpack · Livewire), rebuilt on **Next.js** and **Prisma**.

> **Status:** planning & design phase. No application code yet — see [`docs/`](docs).

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

Not yet available — setup instructions will be added in phase 0 (`docker compose up`, `pnpm dev`, `pnpm prisma migrate dev`, seed data).

## Local data

`.local/` holds private material such as database dumps. It is git-ignored and must never be committed.

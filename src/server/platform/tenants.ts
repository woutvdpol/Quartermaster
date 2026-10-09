import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError } from "@/server/context";
import { isPlatformHost } from "@/server/tenant";
import { normalizeDomainHost } from "./hosts";

export { normalizeDomainHost } from "./hosts";
import { isUniqueViolation, parseInput } from "@/server/catalog/errors";
import { SETTINGS_GROUPS, defaultSettings, isValidTimeZone, type SettingsGroup } from "@/server/settings/schema";
import { createOwnerInvite, notifyOwnerInvite } from "@/server/users";
import type { Prisma } from "@/generated/prisma/client";
import type { TenantStatus } from "@/generated/prisma/enums";
import { assertPlatformActor, type PlatformContext } from "./context";

/*
 * Tenant administration for the Quartermaster platform (SUPERADMIN only).
 * - Tenants are never deleted: status ACTIVE / SUSPENDED / ARCHIVED (decision: schema Restrict).
 *   Leaving ACTIVE signs out every user of the tenant (owners + customers); the storefront and
 *   tenant login already stop resolving non-ACTIVE tenants (tenant.ts).
 * - Hosts are stored normalized (lower-case, no scheme/path/trailing dot, port allowed) and are
 *   globally unique. A tenant keeps exactly one primary domain; the primary cannot be removed.
 * - Currency can only change while the tenant has no products and no orders (prices are stored
 *   in the tenant currency without a currency column).
 * - Audit rows for tenant actions carry the tenant's id, so owners see e.g. "domain added" in their log.
 */

const idSchema = z.string().trim().min(1).max(64);
const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lower-case letters, digits and dashes");
const nameSchema = z.string().trim().min(1).max(120);
const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Expected an ISO 4217 code like EUR");
const timezoneSchema = z.string().trim().min(1).max(64).refine(isValidTimeZone, "Unknown time zone");

const hostSchema = z
  .string()
  .max(300)
  .transform((s, ctx) => {
    const host = normalizeDomainHost(s);
    if (!host) {
      ctx.addIssue({ code: "custom", message: "Expected a host name like shop.example.com" });
      return z.NEVER;
    }
    if (isPlatformHost(host)) {
      ctx.addIssue({ code: "custom", message: "This host is reserved for the platform" });
      return z.NEVER;
    }
    return host;
  });

// ─── Queries ────────────────────────────────────────────────────────────────

export type TenantListItem = {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  currency: string;
  timezone: string;
  createdAt: Date;
  primaryHost: string | null;
  /** Opted in to the Quartermaster network (docs/network.md). */
  networkOptIn: boolean;
  ownerCount: number;
  productCount: number;
  activeProductCount: number;
  orders30d: number;
  lastActivityAt: Date | null;
};

const listSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]).optional(),
  search: z.string().trim().max(120).optional(),
});

/**
 * All tenants with stats. `lastActivityAt` = latest of audit entries, orders placed and staff logins.
 */
export async function listTenants(ctx: PlatformContext, query: z.input<typeof listSchema> = {}): Promise<TenantListItem[]> {
  assertPlatformActor(ctx);
  const q = parseInput(listSchema, query);
  const tenants = await db.tenant.findMany({
    where: {
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: "insensitive" } },
              { slug: { contains: q.search, mode: "insensitive" } },
              { domains: { some: { host: { contains: q.search.toLowerCase() } } } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    include: { domains: { where: { isPrimary: true }, select: { host: true } } },
  });
  if (tenants.length === 0) return [];
  const ids = tenants.map((t) => t.id);

  const stats = await db.$queryRaw<
    { id: string; productCount: number; activeProductCount: number; orders30d: number; ownerCount: number; lastActivityAt: Date | null }[]
  >`
    SELECT t.id,
      (SELECT COUNT(*)::int FROM products p WHERE p."tenantId" = t.id) AS "productCount",
      (SELECT COUNT(*)::int FROM products p WHERE p."tenantId" = t.id AND p.status = 'ACTIVE') AS "activeProductCount",
      (SELECT COUNT(*)::int FROM orders o WHERE o."tenantId" = t.id
         AND o."placedAt" >= (now() AT TIME ZONE 'UTC') - interval '30 days') AS "orders30d",
      (SELECT COUNT(*)::int FROM users u WHERE u."tenantId" = t.id AND u.role = 'OWNER') AS "ownerCount",
      GREATEST(
        (SELECT MAX(a."createdAt") FROM audit_logs a WHERE a."tenantId" = t.id),
        (SELECT MAX(o."placedAt") FROM orders o WHERE o."tenantId" = t.id),
        (SELECT MAX(u."lastLoginAt") FROM users u WHERE u."tenantId" = t.id AND u.role = 'OWNER')
      ) AS "lastActivityAt"
    FROM tenants t
    WHERE t.id = ANY(${ids})`;
  const byId = new Map(stats.map((s) => [s.id, s]));

  return tenants.map((t) => {
    const s = byId.get(t.id);
    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      status: t.status,
      currency: t.currency,
      timezone: t.timezone,
      createdAt: t.createdAt,
      primaryHost: t.domains[0]?.host ?? null,
      networkOptIn: t.networkOptIn,
      ownerCount: s?.ownerCount ?? 0,
      productCount: s?.productCount ?? 0,
      activeProductCount: s?.activeProductCount ?? 0,
      orders30d: s?.orders30d ?? 0,
      lastActivityAt: s?.lastActivityAt ?? null,
    };
  });
}

export async function getTenant(ctx: PlatformContext, tenantId: string) {
  assertPlatformActor(ctx);
  const tenant = await db.tenant.findUnique({
    where: { id: parseInput(idSchema, tenantId) },
    include: { domains: { orderBy: [{ isPrimary: "desc" }, { host: "asc" }] } },
  });
  if (!tenant) throw new ServiceError("NOT_FOUND", "Tenant not found");
  return tenant;
}

// ─── Create / update ────────────────────────────────────────────────────────

const createSchema = z.object({
  slug: slugSchema,
  name: nameSchema,
  currency: currencySchema.default("EUR"),
  timezone: timezoneSchema.default("Europe/Amsterdam"),
  primaryHost: hostSchema,
  ownerEmail: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  ownerName: z.string().trim().max(120).optional().nullable(),
});
export type CreateTenantInput = z.input<typeof createSchema>;

/** Initial settings rows: every group's defaults, with the shop name prefilled. */
function initialSettings(name: string): { group: SettingsGroup; data: Prisma.InputJsonValue }[] {
  return SETTINGS_GROUPS.map((group) => {
    const data = defaultSettings(group) as Record<string, unknown>;
    if (group === "general") data.shopName = name;
    return { group, data: data as Prisma.InputJsonValue };
  });
}

/**
 * Creates tenant + primary domain + default settings rows + OWNER invite in one transaction.
 * Returns the invite token once (for the invite link); the invite mail hook is fired after commit.
 */
export async function createTenant(ctx: PlatformContext, input: CreateTenantInput) {
  assertPlatformActor(ctx);
  const data = parseInput(createSchema, input);

  let result;
  try {
    result = await db.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { slug: data.slug, name: data.name, currency: data.currency, timezone: data.timezone },
      });
      const domain = await tx.tenantDomain.create({ data: { tenantId: tenant.id, host: data.primaryHost, isPrimary: true } });
      await tx.setting.createMany({ data: initialSettings(data.name).map((s) => ({ tenantId: tenant.id, ...s })) });
      const invite = await createOwnerInvite(tx, { tenantId: tenant.id, email: data.ownerEmail, name: data.ownerName });
      return { tenant, domain, invite };
    });
  } catch (err) {
    if (isUniqueViolation(err, "slug")) throw new ServiceError("CONFLICT", "This slug is already in use");
    if (isUniqueViolation(err, "host")) throw new ServiceError("CONFLICT", "This host is already in use");
    if (isUniqueViolation(err)) throw new ServiceError("CONFLICT", "Slug or host already in use");
    throw err;
  }

  const { tenant, domain, invite } = result;
  await audit({
    action: "tenant.created",
    tenantId: tenant.id,
    actorId: ctx.actor.id,
    entity: "Tenant",
    entityId: tenant.id,
    data: { slug: tenant.slug, name: tenant.name, host: domain.host, ownerEmail: invite.user.email },
  });
  await audit({
    action: "user.invited",
    tenantId: tenant.id,
    actorId: ctx.actor.id,
    entity: "User",
    entityId: invite.user.id,
    data: { email: invite.user.email },
  });
  await notifyOwnerInvite({
    tenantId: tenant.id,
    userId: invite.user.id,
    email: invite.user.email,
    name: invite.user.name,
    token: invite.token,
    expiresAt: invite.expiresAt,
    invitedBy: { id: ctx.actor.id, email: ctx.actor.email },
  });
  return { tenant, domain, owner: invite.user, inviteToken: invite.token, inviteExpiresAt: invite.expiresAt };
}

const updateSchema = z
  .object({
    slug: slugSchema.optional(),
    name: nameSchema.optional(),
    currency: currencySchema.optional(),
    timezone: timezoneSchema.optional(),
  })
  .strict();

export async function updateTenant(ctx: PlatformContext, tenantId: string, input: z.input<typeof updateSchema>) {
  assertPlatformActor(ctx);
  const id = parseInput(idSchema, tenantId);
  const data = parseInput(updateSchema, input);
  const current = await db.tenant.findUnique({ where: { id } });
  if (!current) throw new ServiceError("NOT_FOUND", "Tenant not found");

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of ["slug", "name", "currency", "timezone"] as const) {
    if (data[key] !== undefined && data[key] !== current[key]) changes[key] = { from: current[key], to: data[key] };
  }
  if (Object.keys(changes).length === 0) return current;

  if (changes.currency) {
    const [products, orders] = await Promise.all([
      db.product.count({ where: { tenantId: id } }),
      db.order.count({ where: { tenantId: id } }),
    ]);
    if (products || orders) throw new ServiceError("CONFLICT", "Currency cannot change once the shop has products or orders");
  }

  let updated;
  try {
    updated = await db.tenant.update({
      where: { id },
      data: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.to])),
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ServiceError("CONFLICT", "This slug is already in use");
    throw err;
  }
  await audit({ action: "tenant.updated", tenantId: id, actorId: ctx.actor.id, entity: "Tenant", entityId: id, data: changes as Prisma.InputJsonValue });
  return updated;
}

const statusSchema = z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]);

/** Changes status (never deletes). Leaving ACTIVE signs out all users of the tenant. */
export async function setTenantStatus(ctx: PlatformContext, tenantId: string, status: TenantStatus) {
  assertPlatformActor(ctx);
  const id = parseInput(idSchema, tenantId);
  const next = parseInput(statusSchema, status);
  const current = await db.tenant.findUnique({ where: { id }, select: { status: true } });
  if (!current) throw new ServiceError("NOT_FOUND", "Tenant not found");
  if (current.status === next) return db.tenant.findUniqueOrThrow({ where: { id } });

  let updated;
  let sessionsRevoked = 0;
  if (next === "ACTIVE") {
    updated = await db.tenant.update({ where: { id }, data: { status: next } });
  } else {
    const [u, s] = await db.$transaction([
      db.tenant.update({ where: { id }, data: { status: next } }),
      db.session.deleteMany({ where: { user: { tenantId: id } } }),
    ]);
    updated = u;
    sessionsRevoked = s.count;
  }
  await audit({
    action: "tenant.status_changed",
    tenantId: id,
    actorId: ctx.actor.id,
    entity: "Tenant",
    entityId: id,
    data: { from: current.status, to: next, sessionsRevoked },
  });
  return updated;
}

// ─── Domains ────────────────────────────────────────────────────────────────

export async function listDomains(ctx: PlatformContext, tenantId: string) {
  assertPlatformActor(ctx);
  return db.tenantDomain.findMany({
    where: { tenantId: parseInput(idSchema, tenantId) },
    orderBy: [{ isPrimary: "desc" }, { host: "asc" }],
  });
}

/** Adds a host. The tenant's first domain (or `primary: true`) becomes the primary one. */
export async function addDomain(ctx: PlatformContext, tenantId: string, input: { host: string; primary?: boolean }) {
  assertPlatformActor(ctx);
  const id = parseInput(idSchema, tenantId);
  const { host, primary } = parseInput(z.object({ host: hostSchema, primary: z.boolean().default(false) }), input);
  const tenant = await db.tenant.findUnique({ where: { id }, select: { id: true } });
  if (!tenant) throw new ServiceError("NOT_FOUND", "Tenant not found");

  let domain;
  try {
    domain = await db.$transaction(async (tx) => {
      const hasPrimary = (await tx.tenantDomain.count({ where: { tenantId: id, isPrimary: true } })) > 0;
      const makePrimary = primary || !hasPrimary;
      if (makePrimary) await tx.tenantDomain.updateMany({ where: { tenantId: id, isPrimary: true }, data: { isPrimary: false } });
      return tx.tenantDomain.create({ data: { tenantId: id, host, isPrimary: makePrimary } });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ServiceError("CONFLICT", "This host is already in use");
    throw err;
  }
  await audit({ action: "domain.added", tenantId: id, actorId: ctx.actor.id, entity: "TenantDomain", entityId: domain.id, data: { host, primary: domain.isPrimary } });
  return domain;
}

/** Removes a non-primary host (set another primary first). */
export async function removeDomain(ctx: PlatformContext, domainId: string) {
  assertPlatformActor(ctx);
  const id = parseInput(idSchema, domainId);
  const domain = await db.tenantDomain.findUnique({ where: { id } });
  if (!domain) throw new ServiceError("NOT_FOUND", "Domain not found");
  if (domain.isPrimary) throw new ServiceError("INVALID", "The primary domain cannot be removed; make another domain primary first");
  await db.tenantDomain.delete({ where: { id } });
  await audit({ action: "domain.removed", tenantId: domain.tenantId, actorId: ctx.actor.id, entity: "TenantDomain", entityId: id, data: { host: domain.host } });
}

export async function setPrimaryDomain(ctx: PlatformContext, domainId: string) {
  assertPlatformActor(ctx);
  const id = parseInput(idSchema, domainId);
  const domain = await db.tenantDomain.findUnique({ where: { id } });
  if (!domain) throw new ServiceError("NOT_FOUND", "Domain not found");
  if (domain.isPrimary) return domain;
  const [, updated] = await db.$transaction([
    db.tenantDomain.updateMany({ where: { tenantId: domain.tenantId, isPrimary: true }, data: { isPrimary: false } }),
    db.tenantDomain.update({ where: { id }, data: { isPrimary: true } }),
  ]);
  await audit({ action: "domain.primary_set", tenantId: domain.tenantId, actorId: ctx.actor.id, entity: "TenantDomain", entityId: id, data: { host: domain.host } });
  return updated;
}

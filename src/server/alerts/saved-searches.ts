import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import { encrypt } from "@/server/auth/encryption";
import { generateToken, hashToken } from "@/server/auth/tokens";
import * as rateLimit from "@/server/auth/rate-limit";
import { queueMail } from "@/server/mail/queue";
import type { Prisma } from "@/generated/prisma/client";
import type { AlertFrequency } from "@/generated/prisma/enums";
import { queryKey, normalizeQuery, type SavedSearchQuery } from "./match";
import { describeQueries, describeQuery, resolveQuery, summarizeDescription, type QueryDescription } from "./query";
import { verifyAlertLink } from "./signing";

/*
 * Saved searches ("notify me when something like this arrives").
 *
 * Lifecycle (derived, no status column):
 *   pending       confirmedAt = null, unsubscribedAt = null   (guest, waits for the double opt-in)
 *   active        confirmedAt set,   unsubscribedAt = null
 *   unsubscribed  unsubscribedAt set (by the person, or disabled by the shop for abuse)
 * Guests confirm by mail (token hash, valid CONFIRM_TTL_DAYS after creation, confirmed only by POST);
 * signed-in customers are confirmed at once. Unconfirmed rows older than the TTL are deleted by the
 * `alerts.scan` cron.
 */

export const CONFIRM_TTL_DAYS = 7;
const CONFIRM_TTL_MS = CONFIRM_TTL_DAYS * 24 * 60 * 60 * 1000;
export const MAX_ACTIVE_PER_EMAIL = 20;
export const FREQUENCIES = ["INSTANT", "DAILY", "WEEKLY"] as const satisfies readonly AlertFrequency[];

/** Per IP: creating searches at all. Per email: confirmation mails (guests) — no mail-bombing. */
export const CREATE_RULES = {
  perIp: { limit: 20, windowMs: 60 * 60 * 1000 },
  perEmail: { limit: 5, windowMs: 60 * 60 * 1000 },
} satisfies Record<string, rateLimit.RateLimitRule>;

export type SavedSearchStatus = "pending" | "active" | "unsubscribed";

export function savedSearchStatus(s: { confirmedAt: Date | null; unsubscribedAt: Date | null }): SavedSearchStatus {
  if (s.unsubscribedAt) return "unsubscribed";
  return s.confirmedAt ? "active" : "pending";
}

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
const nameSchema = z.string().trim().max(120);
const frequencySchema = z.enum(FREQUENCIES);

/** Rows that count towards the per-email limit: active, or pending and not yet expired. */
function liveWhere(tenantId: string, email: string): Prisma.SavedSearchWhereInput {
  return {
    tenantId,
    email,
    unsubscribedAt: null,
    OR: [{ confirmedAt: { not: null } }, { createdAt: { gte: new Date(Date.now() - CONFIRM_TTL_MS) } }],
  };
}

async function assertShopActive(tenantId: string) {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
  if (!t || t.status !== "ACTIVE") throw new ServiceError("NOT_FOUND", "Shop not found");
}

// ─── Create ────────────────────────────────────────────────────────────────

export type CreateSavedSearchInput = {
  /** Required for guests; ignored for customers (their account email is used). */
  email?: string | null;
  /** Signed-in customer of THIS tenant (from the session — never from the client). */
  customerId?: string | null;
  name?: string | null;
  query: unknown;
  frequency?: AlertFrequency;
};

export type CreateSavedSearchResult =
  /** Customer: active at once. */
  | { status: "created"; id: string }
  /** Guest: confirmation mail queued (also returned for an existing identical search, so the form never reveals what exists). */
  | { status: "pending" }
  /** Customer: an identical active search exists. */
  | { status: "duplicate"; id: string }
  | { status: "limit" }
  | { status: "rate_limited" };

export async function createSavedSearch(
  tenantId: string,
  input: CreateSavedSearchInput,
  opts: { ip?: string | null } = {},
): Promise<CreateSavedSearchResult> {
  await assertShopActive(tenantId);
  const frequency = frequencySchema.catch("DAILY").parse(input.frequency ?? "DAILY");
  const nameParsed = nameSchema.safeParse(input.name ?? "");
  if (!nameParsed.success) throw new ServiceError("INVALID", "Name is too long", nameParsed.error.issues);

  let customerId: string | null = null;
  let email: string;
  if (input.customerId) {
    const customer = await db.customer.findFirst({ where: { id: input.customerId, tenantId }, select: { id: true, email: true } });
    if (!customer) throw new ServiceError("NOT_FOUND", "Customer not found");
    customerId = customer.id;
    email = customer.email.toLowerCase();
  } else {
    const parsed = emailSchema.safeParse(input.email ?? "");
    if (!parsed.success) throw new ServiceError("INVALID", "Enter a valid email address", parsed.error.issues);
    email = parsed.data;
  }

  const ipKey = opts.ip ? `alerts.create.ip:${tenantId}:${opts.ip}` : null;
  const emailKey = `alerts.create.email:${tenantId}:${email}`;
  if (ipKey && (await rateLimit.isLimited(ipKey, CREATE_RULES.perIp))) return { status: "rate_limited" };
  if (!customerId && (await rateLimit.isLimited(emailKey, CREATE_RULES.perEmail))) return { status: "rate_limited" };
  if (ipKey) await rateLimit.hit(ipKey);

  const query = await resolveQuery(tenantId, input.query);
  const key = queryKey(query);
  const live = await db.savedSearch.findMany({ where: liveWhere(tenantId, email), select: { id: true, query: true, confirmedAt: true } });
  const same = live.find((s) => queryKey(normalizeQuery(s.query)) === key);
  if (same) {
    if (customerId) {
      if (!same.confirmedAt) {
        await db.savedSearch.update({ where: { id: same.id }, data: { confirmedAt: new Date(), confirmTokenHash: null, customerId } });
      }
      return { status: "duplicate", id: same.id };
    }
    if (same.confirmedAt) return { status: "pending" }; // neutral
  }
  // Guests get the neutral answer: "limit" would confirm that this address already has alerts.
  if (!same && live.length >= MAX_ACTIVE_PER_EMAIL) return customerId ? { status: "limit" } : { status: "pending" };

  const name = nameParsed.data || summarizeDescription(await describeQuery(tenantId, query));
  const now = new Date();

  if (customerId) {
    const row = await db.savedSearch.create({
      data: { tenantId, customerId, email, name, query: query as Prisma.InputJsonObject, frequency, confirmedAt: now },
    });
    await audit({ action: "alerts.search.created", tenantId, entity: "SavedSearch", entityId: row.id, data: { by: "customer" } });
    return { status: "created", id: row.id };
  }

  await rateLimit.hit(emailKey);
  const token = generateToken();
  // Link to the shop's customer record with the same email only once confirmed (proves the address).
  await db.$transaction(async (tx) => {
    const row = same
      ? await tx.savedSearch.update({ where: { id: same.id }, data: { confirmTokenHash: hashToken(token), name, frequency, createdAt: now } })
      : await tx.savedSearch.create({
          data: { tenantId, email, name, query: query as Prisma.InputJsonObject, frequency, confirmTokenHash: hashToken(token) },
        });
    await queueMail({ tenantId, template: "alert-confirm", props: { savedSearchId: row.id, tokenEnc: encrypt(token) } }, { tx });
  });
  return { status: "pending" };
}

// ─── Confirm / unsubscribe (public, token or signed link) ──────────────────

export type ConfirmSavedSearchResult =
  | { ok: true; tenantId: string; savedSearchId: string }
  | { ok: false; error: "invalid" | "expired"; tenantId?: string };

/** Confirms a double-opt-in token. `opts.tenantId` = tenant of the request host (tokens of other shops are invalid). */
export async function confirmSavedSearch(token: string, opts: { tenantId?: string | null } = {}): Promise<ConfirmSavedSearchResult> {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return { ok: false, error: "invalid" };
  const tokenHash = hashToken(token);
  const row = await db.savedSearch.findUnique({ where: { confirmTokenHash: tokenHash } });
  if (!row || (opts.tenantId && row.tenantId !== opts.tenantId)) return { ok: false, error: "invalid" };
  if (row.createdAt.getTime() + CONFIRM_TTL_MS < Date.now()) return { ok: false, error: "expired", tenantId: row.tenantId };
  const customer = await db.customer.findFirst({ where: { tenantId: row.tenantId, email: row.email }, select: { id: true } });
  const res = await db.savedSearch.updateMany({
    where: { id: row.id, confirmTokenHash: tokenHash },
    data: { confirmedAt: new Date(), unsubscribedAt: null, confirmTokenHash: null, ...(row.customerId ? {} : { customerId: customer?.id ?? null }) },
  });
  if (res.count === 0) return { ok: false, error: "invalid" };
  await audit({ action: "alerts.search.confirmed", tenantId: row.tenantId, entity: "SavedSearch", entityId: row.id });
  return { ok: true, tenantId: row.tenantId, savedSearchId: row.id };
}

export type UnsubscribeResult = { ok: true; changed: boolean } | { ok: false; error: "invalid" };

/** Stops one saved search via its signed unsubscribe link. Idempotent; a deleted search counts as done. */
export async function unsubscribeSavedSearchSigned(input: { tenantId: string; savedSearchId: string; sig: string }): Promise<UnsubscribeResult> {
  const { tenantId, savedSearchId, sig } = input;
  if (!verifyAlertLink("unsubscribe", tenantId, savedSearchId, sig) && !verifyAlertLink("manage", tenantId, savedSearchId, sig)) {
    return { ok: false, error: "invalid" };
  }
  return stopSearches(tenantId, { id: savedSearchId }, "link");
}

async function stopSearches(tenantId: string, where: Prisma.SavedSearchWhereInput, via: string): Promise<UnsubscribeResult> {
  const res = await db.savedSearch.updateMany({
    where: { ...where, tenantId, unsubscribedAt: null },
    data: { unsubscribedAt: new Date(), confirmTokenHash: null },
  });
  if (res.count > 0) await audit({ action: "alerts.search.unsubscribed", tenantId, entity: "SavedSearch", data: { count: res.count, via } });
  return { ok: true, changed: res.count > 0 };
}

export type PublicSearchRow = {
  id: string;
  name: string;
  frequency: AlertFrequency;
  status: SavedSearchStatus;
  createdAt: Date;
  lastNotifiedAt: Date | null;
  description: QueryDescription;
};

async function toPublicRows(
  tenantId: string,
  rows: { id: string; name: string; frequency: AlertFrequency; query: Prisma.JsonValue; confirmedAt: Date | null; unsubscribedAt: Date | null; createdAt: Date; lastNotifiedAt: Date | null }[],
): Promise<PublicSearchRow[]> {
  const descriptions = await describeQueries(tenantId, rows.map((r) => r.query));
  return rows.map((r, i) => ({
    id: r.id,
    name: r.name,
    frequency: r.frequency,
    status: savedSearchStatus(r),
    createdAt: r.createdAt,
    lastNotifiedAt: r.lastNotifiedAt,
    description: descriptions[i],
  }));
}

const publicSelect = {
  id: true,
  name: true,
  frequency: true,
  query: true,
  confirmedAt: true,
  unsubscribedAt: true,
  createdAt: true,
  lastNotifiedAt: true,
} as const;

/**
 * Manage page (signed link of any saved search of an address): the address's confirmed searches.
 * Returns null for an invalid link. The email itself is returned masked only.
 */
export async function manageViewSigned(input: { tenantId: string; savedSearchId: string; sig: string }) {
  const { tenantId, savedSearchId, sig } = input;
  if (!verifyAlertLink("manage", tenantId, savedSearchId, sig)) return null;
  const anchor = await db.savedSearch.findFirst({ where: { id: savedSearchId, tenantId }, select: { email: true } });
  if (!anchor) return { email: null, searches: [] as PublicSearchRow[] };
  const rows = await db.savedSearch.findMany({
    where: { tenantId, email: anchor.email, confirmedAt: { not: null }, unsubscribedAt: null },
    select: publicSelect,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return { email: maskEmail(anchor.email), searches: await toPublicRows(tenantId, rows) };
}

/** From the manage page: stop one search (`targetId`) or all (`targetId` null) of the anchor's address. */
export async function stopFromManageLink(input: { tenantId: string; savedSearchId: string; sig: string; targetId: string | null }): Promise<UnsubscribeResult> {
  const { tenantId, savedSearchId, sig, targetId } = input;
  if (!verifyAlertLink("manage", tenantId, savedSearchId, sig)) return { ok: false, error: "invalid" };
  const anchor = await db.savedSearch.findFirst({ where: { id: savedSearchId, tenantId }, select: { email: true } });
  if (!anchor) return { ok: true, changed: false };
  return stopSearches(tenantId, { email: anchor.email, ...(targetId ? { id: targetId } : {}) }, "manage");
}

// ─── Signed-in customer ────────────────────────────────────────────────────

export type CustomerOwner = { tenantId: string; customerId: string };

export async function listCustomerSearches(owner: CustomerOwner): Promise<PublicSearchRow[]> {
  const rows = await db.savedSearch.findMany({
    where: { tenantId: owner.tenantId, customerId: owner.customerId, confirmedAt: { not: null } },
    select: publicSelect,
    orderBy: [{ unsubscribedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
    take: 100,
  });
  return toPublicRows(owner.tenantId, rows);
}

const updateSchema = z.object({
  name: nameSchema.min(1, "Enter a name").optional(),
  frequency: frequencySchema.optional(),
  /** false = pause (unsubscribed), true = resume. */
  active: z.boolean().optional(),
});

export async function updateCustomerSearch(owner: CustomerOwner, id: string, patch: z.input<typeof updateSchema>): Promise<boolean> {
  const parsed = updateSchema.safeParse(patch);
  if (!parsed.success) throw new ServiceError("INVALID", parsed.error.issues[0]?.message ?? "Invalid input", parsed.error.issues);
  const { active, ...rest } = parsed.data;
  if (active === true) {
    const row = await db.savedSearch.findFirst({ where: { id, tenantId: owner.tenantId, customerId: owner.customerId }, select: { email: true, unsubscribedAt: true } });
    if (!row) return false;
    if (row.unsubscribedAt && (await db.savedSearch.count({ where: liveWhere(owner.tenantId, row.email) })) >= MAX_ACTIVE_PER_EMAIL) {
      throw new ServiceError("CONFLICT", `You can have at most ${MAX_ACTIVE_PER_EMAIL} active alerts`);
    }
  }
  const res = await db.savedSearch.updateMany({
    where: { id, tenantId: owner.tenantId, customerId: owner.customerId },
    data: { ...rest, ...(active === undefined ? {} : { unsubscribedAt: active ? null : new Date() }) },
  });
  return res.count > 0;
}

/** Hard delete (the customer's own data; deliveries cascade). */
export async function deleteCustomerSearch(owner: CustomerOwner, id: string): Promise<boolean> {
  const res = await db.savedSearch.deleteMany({ where: { id, tenantId: owner.tenantId, customerId: owner.customerId } });
  if (res.count) await audit({ action: "alerts.search.deleted", tenantId: owner.tenantId, entity: "SavedSearch", entityId: id, data: { by: "customer" } });
  return res.count > 0;
}

// ─── Admin ─────────────────────────────────────────────────────────────────

/** "jan.devries@example.com" → "ja•••••••@example.com" (enough to recognise abuse, not to harvest). */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "•••";
  const local = email.slice(0, at);
  const keep = local.length <= 2 ? 1 : 2;
  return `${local.slice(0, keep)}${"•".repeat(Math.min(8, Math.max(3, local.length - keep)))}${email.slice(at)}`;
}

const adminListSchema = z.object({
  status: z.enum(["active", "pending", "unsubscribed", "all"]).default("active"),
  frequency: frequencySchema.optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type AdminSearchListQuery = z.input<typeof adminListSchema>;

function statusWhere(status: SavedSearchStatus | "all"): Prisma.SavedSearchWhereInput {
  switch (status) {
    case "active":
      return { confirmedAt: { not: null }, unsubscribedAt: null };
    case "pending":
      return { confirmedAt: null, unsubscribedAt: null };
    case "unsubscribed":
      return { unsubscribedAt: { not: null } };
    default:
      return {};
  }
}

export type AdminSearchRow = PublicSearchRow & { emailMasked: string; isCustomer: boolean; deliveries: number };

export async function adminListSavedSearches(ctx: ServiceContext, query: AdminSearchListQuery = {}) {
  const q = adminListSchema.parse(query);
  const where: Prisma.SavedSearchWhereInput = {
    tenantId: ctx.tenantId,
    ...statusWhere(q.status),
    ...(q.frequency ? { frequency: q.frequency } : {}),
    ...(q.search ? { OR: [{ name: { contains: q.search, mode: "insensitive" } }, { email: { contains: q.search.toLowerCase() } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    db.savedSearch.count({ where }),
    db.savedSearch.findMany({
      where,
      select: { ...publicSelect, email: true, customerId: true, _count: { select: { deliveries: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  const base = await toPublicRows(ctx.tenantId, rows);
  const items: AdminSearchRow[] = base.map((r, i) => ({
    ...r,
    emailMasked: maskEmail(rows[i].email),
    isCustomer: !!rows[i].customerId,
    deliveries: rows[i]._count.deliveries,
  }));
  return { items, total, page: q.page, pageSize: q.pageSize };
}

/** Abuse: the shop stops a saved search (shown as unsubscribed). */
export async function adminDisableSavedSearch(ctx: ServiceContext, id: string): Promise<boolean> {
  const res = await db.savedSearch.updateMany({
    where: { id, tenantId: ctx.tenantId, unsubscribedAt: null },
    data: { unsubscribedAt: new Date(), confirmTokenHash: null },
  });
  if (res.count) await audit({ action: "alerts.search.disabled", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "SavedSearch", entityId: id });
  return res.count > 0;
}

export type AlertStats = {
  activeSearches: number;
  pendingSearches: number;
  unsubscribedSearches: number;
  byFrequency: Record<AlertFrequency, number>;
  deliveries30d: { total: number; savedSearch: number; backAvailable: number; priceDrop: number };
  topCategories: { id: string; title: string; count: number }[];
  topFacetValues: { id: string; name: string; facet: string; count: number }[];
};

export async function adminAlertStats(ctx: ServiceContext): Promise<AlertStats> {
  const tenantId = ctx.tenantId;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const active = statusWhere("active");
  const [activeSearches, pendingSearches, unsubscribedSearches, freq, kinds, cats, fvs] = await Promise.all([
    db.savedSearch.count({ where: { tenantId, ...active } }),
    db.savedSearch.count({ where: { tenantId, ...statusWhere("pending") } }),
    db.savedSearch.count({ where: { tenantId, ...statusWhere("unsubscribed") } }),
    db.savedSearch.groupBy({ by: ["frequency"], where: { tenantId, ...active }, _count: { _all: true } }),
    db.alertDelivery.groupBy({ by: ["kind"], where: { tenantId, sentAt: { gte: since } }, _count: { _all: true } }),
    db.$queryRaw<{ id: string; title: string; n: number }[]>`
      SELECT c.id, c.title, count(*)::int AS n
      FROM saved_searches s JOIN categories c ON c.id = s.query->>'categoryId' AND c."tenantId" = s."tenantId"
      WHERE s."tenantId" = ${tenantId} AND s."confirmedAt" IS NOT NULL AND s."unsubscribedAt" IS NULL
      GROUP BY c.id, c.title ORDER BY n DESC, c.title ASC LIMIT 8`,
    db.$queryRaw<{ id: string; name: string; facet: string; n: number }[]>`
      SELECT v.id, v.name, f.name AS facet, count(*)::int AS n
      FROM saved_searches s
      CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(s.query->'facetValueIds') = 'array' THEN s.query->'facetValueIds' ELSE '[]'::jsonb END) AS e(id)
      JOIN facet_values v ON v.id = e.id AND v."tenantId" = s."tenantId"
      JOIN facets f ON f.id = v."facetId"
      WHERE s."tenantId" = ${tenantId} AND s."confirmedAt" IS NOT NULL AND s."unsubscribedAt" IS NULL
      GROUP BY v.id, v.name, f.name ORDER BY n DESC, v.name ASC LIMIT 8`,
  ]);
  const byFrequency: Record<AlertFrequency, number> = { INSTANT: 0, DAILY: 0, WEEKLY: 0 };
  for (const f of freq) byFrequency[f.frequency] = f._count._all;
  const k = Object.fromEntries(kinds.map((r) => [r.kind, r._count._all])) as Partial<Record<string, number>>;
  const savedSearch = k.SAVED_SEARCH ?? 0;
  const backAvailable = k.BACK_AVAILABLE ?? 0;
  const priceDrop = k.PRICE_DROP ?? 0;
  return {
    activeSearches,
    pendingSearches,
    unsubscribedSearches,
    byFrequency,
    deliveries30d: { total: savedSearch + backAvailable + priceDrop, savedSearch, backAvailable, priceDrop },
    topCategories: cats.map((c) => ({ id: c.id, title: c.title, count: c.n })),
    topFacetValues: fvs.map((v) => ({ id: v.id, name: v.name, facet: v.facet, count: v.n })),
  };
}

/** Deletes guest searches that were never confirmed within the TTL. */
export async function purgeExpiredPending(now = new Date()): Promise<number> {
  const res = await db.savedSearch.deleteMany({
    where: { confirmedAt: null, createdAt: { lt: new Date(now.getTime() - CONFIRM_TTL_MS) } },
  });
  return res.count;
}

export type { SavedSearchQuery };

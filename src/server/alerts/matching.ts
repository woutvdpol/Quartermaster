import "server-only";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import type { ServiceContext } from "@/server/context";
import { queueMail } from "@/server/mail/queue";
import { pushRecipients, queueSavedSearchPush } from "@/server/push";
import { MAX_DIGEST_DELIVERIES } from "./mail-contracts";
import { matchesQuery, normalizeQuery, type MatchLookups, type ProductFacts } from "./match";
import { digestSlotDue } from "./schedule";

/*
 * Saved-search matching and delivery.
 *
 *  matchProduct()   a product was published / bumped → write AlertDelivery rows for every matching,
 *                   confirmed, active saved search (unique (savedSearchId, productId) = a search never
 *                   reports the same product twice, bumps included) and queue INSTANT mails at once.
 *  sendDueDigests() hourly: DAILY / WEEKLY searches get one mail with every unsent delivery created
 *                   before their slot (see ./schedule.ts).
 *
 * A product only matches searches created before it was published (publishedAt ≥ search.createdAt)
 * — a new alert reports what arrives from now on, not the existing stock.
 * SAVED_SEARCH deliveries keep customerId NULL so (kind, customerId, productId) never collides when
 * one customer has several searches matching the same product.
 */

/** Public-visibility predicate for "new arrival" products. */
const AVAILABLE = { status: "ACTIVE" as const, quantity: { gt: 0 }, publishedAt: { not: null } };

export async function loadMatchLookups(tenantId: string): Promise<MatchLookups> {
  const [cats, values] = await Promise.all([
    db.category.findMany({ where: { tenantId }, select: { id: true, parentId: true } }),
    db.facetValue.findMany({ where: { tenantId }, select: { id: true, facetId: true, parentId: true } }),
  ]);
  return {
    categoryParent: new Map(cats.map((c) => [c.id, c.parentId])),
    facetValues: new Map(values.map((v) => [v.id, { facetId: v.facetId, parentId: v.parentId }])),
  };
}

async function loadProductFacts(tenantId: string, productId: string) {
  const p = await db.product.findFirst({
    where: { id: productId, tenantId, ...AVAILABLE },
    select: {
      id: true,
      title: true,
      description: true,
      sku: true,
      stockCode: true,
      slug: true,
      price: true,
      categoryId: true,
      publishedAt: true,
      tags: { select: { tagId: true } },
      productFacetValues: { select: { facetValueId: true } },
    },
  });
  if (!p) return null;
  const facts: ProductFacts = {
    title: p.title,
    description: p.description,
    sku: p.sku,
    stockCode: p.stockCode,
    price: p.price,
    categoryId: p.categoryId,
    tagIds: p.tags.map((t) => t.tagId),
    facetValueIds: p.productFacetValues.map((v) => v.facetValueId),
  };
  return { id: p.id, publishedAt: p.publishedAt!, facts, link: { title: p.title, price: p.price, stockCode: p.stockCode, slug: p.slug } };
}

export type MatchResult = { matched: number; created: number; instantMails: number };

/**
 * Matches one product against the tenant's saved searches. Idempotent: re-running (job retry, bump,
 * "Run matching now") never creates a second delivery for the same (search, product).
 */
export async function matchProduct(tenantId: string, productId: string, lookups?: MatchLookups): Promise<MatchResult> {
  const product = await loadProductFacts(tenantId, productId);
  if (!product) return { matched: 0, created: 0, instantMails: 0 };
  const searches = await db.savedSearch.findMany({
    where: { tenantId, confirmedAt: { not: null }, unsubscribedAt: null, createdAt: { lte: product.publishedAt } },
    select: { id: true, query: true, frequency: true, push: true, customerId: true, name: true },
  });
  if (!searches.length) return { matched: 0, created: 0, instantMails: 0 };
  const lk = lookups ?? (await loadMatchLookups(tenantId));
  const hits = searches.filter((s) => matchesQuery(normalizeQuery(s.query), product.facts, lk));
  if (!hits.length) return { matched: 0, created: 0, instantMails: 0 };

  const created = await db.alertDelivery.createManyAndReturn({
    data: hits.map((s) => ({ tenantId, kind: "SAVED_SEARCH" as const, savedSearchId: s.id, productId })),
    skipDuplicates: true,
    select: { id: true, savedSearchId: true },
  });
  const now = new Date();
  if (created.length) {
    await db.savedSearch.updateMany({ where: { id: { in: created.map((d) => d.savedSearchId!) } }, data: { lastMatchedAt: now } });
  }

  // Web push (docs/push.md): a search with `push` goes to the customer's devices right away. With
  // frequency INSTANT the push REPLACES the instant mail (falls back to the mail when the customer has
  // no device / push is off); DAILY / WEEKLY searches with push get the push now and the digest later.
  const byId = new Map(hits.map((s) => [s.id, s]));
  const pushTo = await pushRecipients(tenantId, hits.flatMap((s) => (s.push && s.customerId ? [s.customerId] : [])));
  const currency = pushTo.size ? ((await db.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } }))?.currency ?? "EUR") : "EUR";
  const pushInput = (s: { customerId: string | null; name: string }, deliveryId: string) => ({
    tenantId,
    customerId: s.customerId!,
    deliveryId,
    searchName: s.name,
    product: product.link,
    currency,
  });
  let instantMails = 0;
  for (const d of created) {
    const s = d.savedSearchId ? byId.get(d.savedSearchId) : undefined;
    if (!s) continue;
    const viaPush = s.push && !!s.customerId && pushTo.has(s.customerId);
    if (s.frequency !== "INSTANT") {
      if (viaPush) {
        await db.$transaction((tx) => queueSavedSearchPush(tx, pushInput(s, d.id))).catch((err) => console.error("[alerts] saved-search push failed", err));
      }
      continue;
    }
    const sent = await db.$transaction(async (tx) => {
      const claimed = await tx.alertDelivery.updateMany({ where: { id: d.id, sentAt: null }, data: { sentAt: now } });
      if (!claimed.count) return false;
      await tx.savedSearch.update({ where: { id: s.id }, data: { lastNotifiedAt: now } });
      if (viaPush) {
        await queueSavedSearchPush(tx, pushInput(s, d.id));
        return false;
      }
      await queueMail({ tenantId, template: "alert-new-arrivals", props: { savedSearchId: s.id, deliveryIds: [d.id] } }, { tx });
      return true;
    });
    if (sent) instantMails++;
  }
  return { matched: hits.length, created: created.length, instantMails };
}

/**
 * Matches every available product published in the window (default: last 30 minutes). Used by the
 * `alerts.scan` cron as a safety net for missed hooks, and by "Run matching now" (tests / admin).
 */
export async function matchRecentProducts(tenantId: string, opts: { since?: Date; limit?: number } = {}): Promise<MatchResult & { products: number }> {
  const since = opts.since ?? new Date(Date.now() - 30 * 60 * 1000);
  const products = await db.product.findMany({
    where: { tenantId, ...AVAILABLE, publishedAt: { gte: since } },
    select: { id: true },
    orderBy: { publishedAt: "asc" },
    take: opts.limit ?? 500,
  });
  const total: MatchResult & { products: number } = { matched: 0, created: 0, instantMails: 0, products: products.length };
  if (!products.length) return total;
  const hasSearches = await db.savedSearch.count({ where: { tenantId, confirmedAt: { not: null }, unsubscribedAt: null } });
  if (!hasSearches) return total;
  const lookups = await loadMatchLookups(tenantId);
  for (const p of products) {
    const r = await matchProduct(tenantId, p.id, lookups);
    total.matched += r.matched;
    total.created += r.created;
    total.instantMails += r.instantMails;
  }
  return total;
}

/** Every tenant with active searches (cron). */
export async function matchRecentProductsAllTenants(since?: Date) {
  const tenants = await db.savedSearch.findMany({
    where: { confirmedAt: { not: null }, unsubscribedAt: null, tenant: { status: "ACTIVE" } },
    distinct: ["tenantId"],
    select: { tenantId: true },
  });
  let created = 0;
  for (const t of tenants) created += (await matchRecentProducts(t.tenantId, { since })).created;
  return { tenants: tenants.length, created };
}

/** Admin "Run matching now": products published in the last `days` days (default 7), then due digests. */
export async function runMatchingNow(ctx: ServiceContext, opts: { days?: number } = {}) {
  const days = Math.min(Math.max(Math.trunc(opts.days ?? 7), 1), 90);
  const result = await matchRecentProducts(ctx.tenantId, { since: new Date(Date.now() - days * 24 * 60 * 60 * 1000), limit: 5000 });
  const digests = await sendDueDigests({ tenantId: ctx.tenantId });
  await audit({ action: "alerts.matching.run", tenantId: ctx.tenantId, actorId: ctx.actor.id, data: { days, ...result, digests: digests.mails } });
  return { ...result, digestMails: digests.mails };
}

// ─── Digests ───────────────────────────────────────────────────────────────

/**
 * Sends DAILY / WEEKLY digests whose slot is due. One mail per saved search with every unsent
 * delivery created before the slot (the newest MAX_DIGEST_DELIVERIES are listed; all are marked sent).
 * Claims rows inside the transaction that queues the mail, so concurrent runs never double-send.
 */
export async function sendDueDigests(opts: { now?: Date; tenantId?: string } = {}): Promise<{ searches: number; mails: number }> {
  const now = opts.now ?? new Date();
  const pending = await db.alertDelivery.findMany({
    where: {
      kind: "SAVED_SEARCH",
      sentAt: null,
      ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
      savedSearch: { frequency: { in: ["DAILY", "WEEKLY"] }, confirmedAt: { not: null }, unsubscribedAt: null },
    },
    distinct: ["savedSearchId"],
    select: { savedSearchId: true },
  });
  const ids = pending.map((p) => p.savedSearchId!).filter(Boolean);
  if (!ids.length) return { searches: 0, mails: 0 };
  const searches = await db.savedSearch.findMany({
    where: { id: { in: ids } },
    select: { id: true, tenantId: true, frequency: true, lastNotifiedAt: true, tenant: { select: { timezone: true, status: true } } },
  });
  let mails = 0;
  for (const s of searches) {
    if (s.tenant.status !== "ACTIVE") continue;
    const slot = digestSlotDue(s.frequency, now, s.tenant.timezone, s.lastNotifiedAt);
    if (!slot) continue;
    const sent = await db.$transaction(async (tx) => {
      const rows = await tx.alertDelivery.findMany({
        where: { savedSearchId: s.id, sentAt: null, createdAt: { lt: slot } },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      if (!rows.length) return false;
      const claimed = await tx.alertDelivery.updateManyAndReturn({
        where: { id: { in: rows.map((r) => r.id) }, sentAt: null },
        data: { sentAt: now },
        select: { id: true },
      });
      if (!claimed.length) return false;
      await tx.savedSearch.update({ where: { id: s.id }, data: { lastNotifiedAt: now } });
      await queueMail(
        { tenantId: s.tenantId, template: "alert-new-arrivals", props: { savedSearchId: s.id, deliveryIds: claimed.slice(-MAX_DIGEST_DELIVERIES).map((r) => r.id) } },
        { tx },
      );
      return true;
    });
    if (sent) mails++;
  }
  return { searches: searches.length, mails };
}

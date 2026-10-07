import "server-only";
import { after } from "next/server";
import { db } from "@/server/db";
import { shopCache } from "@/server/storefront/cache";
import { facetValueHref, getProduct, getTaxonomy } from "@/server/storefront-catalog";
import { getPublicProduct, getPublicTaxonomy } from "@/server/storefront-catalog/queries";
import { normalizeRedirectPath, redirectPathOnly } from "./normalize";
import { builtinLegacyTarget, isReservedPath, isSafeRelativeTarget, resolveStoredRedirect, type ResolvedRedirect, type StoredRedirect } from "./rules";

/*
 * Runtime redirect resolution for requests the storefront would otherwise 404 (see runtime.ts).
 *
 * Cost: this module is only reached on a 404, never for pages that render. Lookups go through the
 * shop data cache (positive AND negative results, keyed per tenant + normalised path, tagged
 * `tenant:{id}:redirects`, invalidated by audit() on every `redirect.*` admin action), so a
 * repeatedly requested dead URL costs one indexed unique lookup per cache period.
 * Hits are counted after the response is sent (`after`) and coalesced per process.
 */

export type RedirectDeps = {
  findRow: (tenantId: string, key: string) => Promise<StoredRedirect | null>;
  /** Canonical href of a public product by stockCode, or null. */
  productHref: (tenantId: string, stockCode: number) => Promise<string | null>;
  /** Target for an old /shop/tag/{name} link, or null. */
  tagTarget: (tenantId: string, name: string) => Promise<string | null>;
};

async function findRow(tenantId: string, key: string): Promise<StoredRedirect | null> {
  return db.redirect.findUnique({
    where: { tenantId_fromPath: { tenantId, fromPath: key } },
    select: { id: true, fromPath: true, toPath: true, statusCode: true },
  });
}

/**
 * Old tag pages: a facet value with exactly that name (tags were converted to facet values), else a
 * remaining tag with that name (→ /shop?tag=slug). Ambiguous names (several facet values) → null.
 */
async function tagTargetWith(
  taxonomy: (tenantId: string) => Promise<Awaited<ReturnType<typeof getPublicTaxonomy>>>,
  tenantId: string,
  name: string,
): Promise<string | null> {
  const wanted = name.toLowerCase();
  const tax = await taxonomy(tenantId);
  const values = tax.values.filter((v) => v.name.toLowerCase() === wanted);
  if (values.length === 1) {
    const facet = tax.facets.find((f) => f.id === values[0].facetId);
    return facet ? facetValueHref(facet.slug, values[0].slug) : null;
  }
  if (values.length > 1) return null;
  const tag = await db.tag.findFirst({ where: { tenantId, name: { equals: name, mode: "insensitive" } }, select: { slug: true } });
  return tag ? `/shop?tag=${encodeURIComponent(tag.slug)}` : null;
}

/** Uncached dependencies (tests, scripts). */
export const directRedirectDeps: RedirectDeps = {
  findRow,
  productHref: async (tenantId, code) => (await getPublicProduct(tenantId, code))?.href ?? null,
  tagTarget: (tenantId, name) => tagTargetWith(getPublicTaxonomy, tenantId, name),
};

const cachedFindRow = shopCache("redirect-row", "redirects", findRow);
const cachedTagTarget = shopCache("redirect-tag", "catalog", (tenantId: string, name: string) => tagTargetWith(getTaxonomy, tenantId, name));

/** Request-time dependencies: everything through the shop data cache. */
export const cachedRedirectDeps: RedirectDeps = {
  findRow: cachedFindRow,
  productHref: async (tenantId, code) => (await getProduct(tenantId, code))?.href ?? null,
  tagTarget: cachedTagTarget,
};

/** Static-asset-looking paths never get a lookup (bots probing for files, missing chunks). */
const ASSET_EXT = /\.(?:js|mjs|css|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|eot|txt|xml|json|webmanifest)$/;

/**
 * The redirect for a request path (+ query) on a tenant's shop, or null.
 * Order: stored redirects (exact key, then the path without query; one extra hop flattened),
 * then the built-in Concept500 patterns.
 */
export async function resolveRedirect(tenantId: string, rawPath: string, deps: RedirectDeps = cachedRedirectDeps): Promise<ResolvedRedirect | null> {
  const key = normalizeRedirectPath(rawPath);
  if (!key || key === "/" || isReservedPath(key) || ASSET_EXT.test(redirectPathOnly(key))) return null;

  const stored = await resolveStoredRedirect(key, (k) => deps.findRow(tenantId, k));
  if (stored) return stored;

  const builtin = builtinLegacyTarget(key);
  if (!builtin) return null;
  let target: string | null = null;
  if (builtin.kind === "path") target = builtin.target;
  else if (builtin.kind === "product") target = await deps.productHref(tenantId, builtin.stockCode);
  else if (builtin.kind === "tag") target = await deps.tagTarget(tenantId, builtin.name);
  if (!target || !isSafeRelativeTarget(target) || normalizeRedirectPath(target) === key) return null;
  return { target, statusCode: 301, ids: [] };
}

// ─── Hit counting ───────────────────────────────────────────────────────────

const pendingHits = new Map<string, { count: number; last: Date }>();
/** Flushes run one after another, so a later flush always sees the earlier writes done. */
let flushChain: Promise<void> = Promise.resolve();

async function writePendingHits(): Promise<void> {
  if (pendingHits.size === 0) return;
  const batch = [...pendingHits.entries()];
  pendingHits.clear();
  await Promise.all(
    batch.map(([id, { count, last }]) => db.redirect.updateMany({ where: { id }, data: { hits: { increment: count }, lastHitAt: last } })),
  ).catch((err) => console.error("[redirects] hit counting failed:", err));
}

function flushHits(): Promise<void> {
  flushChain = flushChain.then(writePendingHits);
  return flushChain;
}

/**
 * Counts a served redirect without delaying the response: buffered in memory and written after the
 * response finished (`after`). Concurrent hits on the same row are coalesced into one UPDATE.
 */
export function recordRedirectHits(ids: readonly string[]): void {
  if (!ids.length) return;
  const now = new Date();
  for (const id of ids) {
    const p = pendingHits.get(id);
    pendingHits.set(id, { count: (p?.count ?? 0) + 1, last: now });
  }
  try {
    after(flushHits);
  } catch {
    void flushHits(); // outside a request scope (tests/scripts)
  }
}

/** For tests: write buffered hits now. */
export const flushRedirectHits = flushHits;

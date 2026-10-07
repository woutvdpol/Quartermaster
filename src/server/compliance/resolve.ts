import "server-only";
import { cache } from "react";
import { db } from "@/server/db";
import { shopCache } from "@/server/storefront/cache";
import { notFound } from "@/server/catalog/errors";
import { normalizeCountryCode } from "@/server/shipping/countries";
import type { ServiceContext } from "@/server/context";
import type { ComplianceActionName, ComplianceMatchName } from "./presets";

/*
 * Compliance resolution: which products are hidden / image-blurred / not shippable for a country.
 *
 *  - Rules are compiled per tenant (active rules only; CATEGORY rules expanded to the category and
 *    all its descendants) and cached in the shop data cache under the tenant's `catalog` tag
 *    (audited "compliance.*" and "category.*" changes invalidate it), plus a per-request memo.
 *  - countryCode null/unknown → no geo rules apply (every verdict is clear). The existing
 *    "blur sensitive items for guests" behaviour (Product.blurred) is separate and unaffected.
 *
 * Public API (used by the storefront catalog and by checkout — COMMERCE):
 *   resolveCompliance(tenantId, productIds, countryCode) → Record<productId, ComplianceVerdict>
 *   complianceHideFilter(tenantId, countryCode) → SQL-able description of hidden products, or null
 */

export type ComplianceReason = {
  ruleId: string;
  name: string;
  match: ComplianceMatchName;
  action: ComplianceActionName;
  /** Admin note, e.g. "§86a StGB" (may be shown to customers). */
  note: string | null;
};

export type ComplianceVerdict = {
  /** HIDE_PRODUCT matched: not listed, product page 404s, cannot be bought. */
  hidden: boolean;
  /** BLUR_IMAGES matched: show only blurred images. */
  blurred: boolean;
  /** NO_SHIPPING matched: cannot be shipped to this country (checkout must block). */
  noShipping: boolean;
  /** Every matching rule (any action). */
  reasons: ComplianceReason[];
};

export const CLEAR_VERDICT: ComplianceVerdict = Object.freeze({ hidden: false, blurred: false, noShipping: false, reasons: [] }) as ComplianceVerdict;

export type CompiledRule = {
  id: string;
  name: string;
  match: ComplianceMatchName;
  action: ComplianceActionName;
  note: string | null;
  countries: string[];
  /** CATEGORY rules: the category and all descendants; [] otherwise. */
  categoryIds: string[];
};

export type ComplianceProductFacts = {
  id: string;
  categoryId: string | null;
  restrictedSymbols: boolean;
  ageRestricted: boolean;
  requiresDeactivationCert: boolean;
};

/** Hidden-product predicate for one country (for SQL listing filters). */
export type ComplianceHide = {
  categoryIds: string[];
  restrictedSymbols: boolean;
  ageRestricted: boolean;
  deactivatedWeapons: boolean;
};

// ─── Compilation (uncached) ─────────────────────────────────────────────────

/** Loads the active rules of a tenant and expands CATEGORY rules to their subtree. */
export async function loadCompiledRules(tenantId: string): Promise<CompiledRule[]> {
  const rules = await db.complianceRule.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, name: true, match: true, action: true, note: true, countries: true, categoryId: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  if (!rules.length) return [];
  const needsTree = rules.some((r) => r.match === "CATEGORY");
  const cats = needsTree ? await db.category.findMany({ where: { tenantId }, select: { id: true, parentId: true } }) : [];
  const children = new Map<string, string[]>();
  for (const c of cats) {
    if (!c.parentId) continue;
    children.set(c.parentId, [...(children.get(c.parentId) ?? []), c.id]);
  }
  const subtree = (root: string) => {
    const out: string[] = [];
    const seen = new Set<string>();
    const walk = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      out.push(id);
      for (const c of children.get(id) ?? []) walk(c);
    };
    walk(root);
    return out;
  };
  return rules.flatMap((r) => {
    if (r.match === "CATEGORY" && !r.categoryId) return [];
    return [
      {
        id: r.id,
        name: r.name,
        match: r.match,
        action: r.action,
        note: r.note,
        countries: r.countries.map((c) => c.toUpperCase()),
        categoryIds: r.match === "CATEGORY" && r.categoryId ? subtree(r.categoryId) : [],
      },
    ];
  });
}

const cachedRules = shopCache("compliance-rules", "catalog", loadCompiledRules);

/** Compiled rules: data cache (per tenant) + request memo. Falls back to a direct load outside Next. */
export const getCompiledRules = cache(async (tenantId: string): Promise<CompiledRule[]> => {
  try {
    return await cachedRules(tenantId);
  } catch {
    // Outside a Next request (scripts, worker, tests) unstable_cache has no incremental cache; a real
    // DB error simply surfaces again from the direct load.
    return loadCompiledRules(tenantId);
  }
});

// ─── Evaluation (pure) ──────────────────────────────────────────────────────

function ruleMatches(rule: CompiledRule, p: ComplianceProductFacts): boolean {
  switch (rule.match) {
    case "CATEGORY":
      return p.categoryId !== null && rule.categoryIds.includes(p.categoryId);
    case "RESTRICTED_SYMBOLS":
      return p.restrictedSymbols;
    case "AGE_RESTRICTED":
      return p.ageRestricted;
    case "DEACTIVATED_WEAPON":
      return p.requiresDeactivationCert;
    default:
      return false;
  }
}

/** Verdict for one product under compiled rules for a country (pure). */
export function evaluateCompliance(rules: readonly CompiledRule[], product: ComplianceProductFacts, countryCode: string | null): ComplianceVerdict {
  const country = countryCode ? normalizeCountryCode(countryCode) : null;
  if (!country || !rules.length) return { ...CLEAR_VERDICT, reasons: [] };
  const verdict: ComplianceVerdict = { hidden: false, blurred: false, noShipping: false, reasons: [] };
  for (const rule of rules) {
    if (!rule.countries.includes(country) || !ruleMatches(rule, product)) continue;
    if (rule.action === "HIDE_PRODUCT") verdict.hidden = true;
    else if (rule.action === "BLUR_IMAGES") verdict.blurred = true;
    else if (rule.action === "NO_SHIPPING") verdict.noShipping = true;
    verdict.reasons.push({ ruleId: rule.id, name: rule.name, match: rule.match, action: rule.action, note: rule.note });
  }
  // A product that may not be shown may not be sold there either.
  if (verdict.hidden) verdict.noShipping = true;
  return verdict;
}

/** The hide predicate for a country (null when no HIDE_PRODUCT rule applies) — pure. */
export function hideFilterFor(rules: readonly CompiledRule[], countryCode: string | null): ComplianceHide | null {
  const country = countryCode ? normalizeCountryCode(countryCode) : null;
  if (!country) return null;
  const hide: ComplianceHide = { categoryIds: [], restrictedSymbols: false, ageRestricted: false, deactivatedWeapons: false };
  let any = false;
  for (const r of rules) {
    if (r.action !== "HIDE_PRODUCT" || !r.countries.includes(country)) continue;
    any = true;
    if (r.match === "CATEGORY") hide.categoryIds.push(...r.categoryIds);
    else if (r.match === "RESTRICTED_SYMBOLS") hide.restrictedSymbols = true;
    else if (r.match === "AGE_RESTRICTED") hide.ageRestricted = true;
    else if (r.match === "DEACTIVATED_WEAPON") hide.deactivatedWeapons = true;
  }
  if (!any) return null;
  hide.categoryIds = [...new Set(hide.categoryIds)].sort();
  return hide;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Compliance verdicts for products of a tenant in a country. Every id that exists in the tenant gets
 * an entry (ids of other tenants / unknown ids are omitted). `countryCode` null or unknown → all
 * clear (no geo rules). Safe to call from RSC, server actions, route handlers, jobs and scripts.
 *
 *   const verdicts = await resolveCompliance(tenantId, cartProductIds, shippingCountry);
 *   if (Object.values(verdicts).some((v) => v.noShipping)) …block checkout…
 */
export async function resolveCompliance(tenantId: string, productIds: readonly string[], countryCode: string | null): Promise<Record<string, ComplianceVerdict>> {
  const ids = [...new Set(productIds)];
  if (!ids.length) return {};
  const country = countryCode ? normalizeCountryCode(countryCode) : null;
  const [rules, products] = await Promise.all([
    country ? getCompiledRules(tenantId) : Promise.resolve([] as CompiledRule[]),
    db.product.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, categoryId: true, restrictedSymbols: true, ageRestricted: true, requiresDeactivationCert: true },
    }),
  ]);
  return Object.fromEntries(products.map((p) => [p.id, evaluateCompliance(rules, p, country)]));
}

/** Hide predicate for listings in a country (null = nothing hidden). Uses the cached rules. */
export async function complianceHideFilter(tenantId: string, countryCode: string | null): Promise<ComplianceHide | null> {
  const country = countryCode ? normalizeCountryCode(countryCode) : null;
  if (!country) return null;
  return hideFilterFor(await getCompiledRules(tenantId), country);
}

/** Admin "Test" box: verdict for a stock code in a country, from fresh (uncached) rules. */
export async function testCompliance(ctx: ServiceContext, input: { stockCode: number; countryCode: string }) {
  const country = normalizeCountryCode(input.countryCode);
  const product = await db.product.findFirst({
    where: { tenantId: ctx.tenantId, stockCode: input.stockCode },
    select: { id: true, stockCode: true, title: true, status: true, categoryId: true, restrictedSymbols: true, ageRestricted: true, requiresDeactivationCert: true },
  });
  if (!product) throw notFound("Product");
  const rules = await loadCompiledRules(ctx.tenantId);
  return { product: { id: product.id, stockCode: product.stockCode, title: product.title, status: product.status }, country, verdict: evaluateCompliance(rules, product, country) };
}

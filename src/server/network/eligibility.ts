import { Prisma } from "@/generated/prisma/client";
import type { CompiledRule, ComplianceHide } from "@/server/compliance/resolve";
import { normalizeCountryCode } from "@/server/shipping/countries";
import { fold } from "@/server/search/normalize";

/*
 * Who and what may appear in the Quartermaster network (docs/network.md). Pure: unit-tested.
 *
 * Dealers: ACTIVE, opted in (Tenant.networkOptIn), live (setup wizard finished, or a shop that predates
 * the wizard: setupState null) and reachable (a primary TenantDomain — the result links go there).
 *
 * Products: only what every visitor of the dealer's shop could see and buy, minus everything sensitive:
 *  - status ACTIVE with stock (no RESERVED: the network shows what can be bought now), not on a fair
 *    (fairHoldId null), not blurred (sensitive for guests), not age-restricted;
 *  - restricted symbols are excluded ENTIRELY — whatever the dealer's country rules say. The network is
 *    a cross-border showcase on one host; we do not rely on every dealer having set up rules for every
 *    country (§86a StGB, etc.);
 *  - each dealer's own compliance rules for the visitor's country: any rule that matches the country
 *    (hide, blur images or no shipping) keeps the product out — a network card can neither blur nor
 *    explain "cannot ship to you".
 */

// ─── Dealers ────────────────────────────────────────────────────────────────

/** Prisma filter for network dealers. */
export const NETWORK_TENANT_WHERE = {
  status: "ACTIVE",
  networkOptIn: true,
  OR: [{ setupCompletedAt: { not: null } }, { setupState: { equals: Prisma.DbNull } }],
  domains: { some: { isPrimary: true } },
} satisfies Prisma.TenantWhereInput;

export type TenantEligibilityFacts = {
  status: string;
  networkOptIn: boolean;
  setupState: unknown;
  setupCompletedAt: Date | string | null;
  domains: { isPrimary: boolean }[];
};

/** Same rule as NETWORK_TENANT_WHERE, for a loaded tenant. */
export function isNetworkEligibleTenant(t: TenantEligibilityFacts): boolean {
  const live = t.setupCompletedAt !== null || t.setupState === null || t.setupState === undefined;
  return t.status === "ACTIVE" && t.networkOptIn && live && t.domains.some((d) => d.isPrimary);
}

/** Pure check of one product row (mirrors networkProductWhere minus the per-country rules). */
export function isNetworkEligibleProduct(p: {
  status: string;
  quantity: number;
  fairHoldId: string | null;
  blurred: boolean;
  ageRestricted: boolean;
  restrictedSymbols: boolean;
}): boolean {
  return p.status === "ACTIVE" && p.quantity > 0 && p.fairHoldId === null && !p.blurred && !p.ageRestricted && !p.restrictedSymbols;
}

// ─── Compliance per dealer ──────────────────────────────────────────────────

/**
 * Products of one dealer that must stay out of the network for this visitor country: every rule for
 * the country, whatever its action (hide, blur, no shipping). Null when nothing extra applies.
 * restrictedSymbols / ageRestricted are reported too but are excluded for everyone anyway.
 */
export function networkExclusionFor(rules: readonly CompiledRule[], countryCode: string | null): ComplianceHide | null {
  const country = countryCode ? normalizeCountryCode(countryCode) : null;
  if (!country) return null;
  const hide: ComplianceHide = { categoryIds: [], restrictedSymbols: false, ageRestricted: false, deactivatedWeapons: false };
  let any = false;
  for (const r of rules) {
    if (!r.countries.includes(country)) continue;
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

// ─── Shipping ───────────────────────────────────────────────────────────────

export type ZoneFacts = { countries: string[]; isActive: boolean; isPickup: boolean };

/** Does the dealer ship to this country (an active, non-pickup zone listing it or "*")? */
export function shipsToCountry(zones: readonly ZoneFacts[], countryCode: string | null): boolean {
  const country = countryCode ? normalizeCountryCode(countryCode) : null;
  if (!country) return false;
  return zones.some((z) => z.isActive && !z.isPickup && (z.countries.includes(country) || z.countries.includes("*")));
}

// ─── Period / country across dealers ────────────────────────────────────────

/*
 * Facets are per shop, but PERIOD and COUNTRY values are named alike across shops ("WW2", "Germany").
 * The network offers the top-level value names (folded) of those two kinds, and a selected name matches
 * that value and its descendants in every shop.
 */

export type NetworkFacetKind = "PERIOD" | "COUNTRY";
export type FacetValueFacts = { id: string; tenantId: string; parentId: string | null; name: string; kind: string };
export type NetworkFacetOption = { key: string; label: string; dealers: number };

export const facetKey = (name: string) => fold(name);

/** Top-level value names of a kind, most widely used (by number of dealers) first. */
export function networkFacetOptions(values: readonly FacetValueFacts[], kind: NetworkFacetKind, limit = 12): NetworkFacetOption[] {
  const byKey = new Map<string, { label: string; tenants: Set<string> }>();
  for (const v of values) {
    if (v.kind !== kind || v.parentId !== null) continue;
    const key = facetKey(v.name);
    if (!key) continue;
    const entry = byKey.get(key) ?? { label: v.name.trim(), tenants: new Set<string>() };
    entry.tenants.add(v.tenantId);
    byKey.set(key, entry);
  }
  return [...byKey.entries()]
    .map(([key, e]) => ({ key, label: e.label, dealers: e.tenants.size }))
    .sort((a, b) => b.dealers - a.dealers || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/** Value ids (incl. descendants, per shop) whose top-level name is one of `keys`. Empty keys → null (no filter). */
export function facetValueIdsFor(values: readonly FacetValueFacts[], kind: NetworkFacetKind, keys: readonly string[]): string[] | null {
  if (!keys.length) return null;
  const wanted = new Set(keys);
  const ofKind = values.filter((v) => v.kind === kind);
  const children = new Map<string, string[]>();
  for (const v of ofKind) if (v.parentId) children.set(v.parentId, [...(children.get(v.parentId) ?? []), v.id]);
  const out = new Set<string>();
  const walk = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    for (const c of children.get(id) ?? []) walk(c);
  };
  for (const v of ofKind) if (v.parentId === null && wanted.has(facetKey(v.name))) walk(v.id);
  return [...out].sort();
}

// ─── Product predicate ──────────────────────────────────────────────────────

export type NetworkWhereInput = {
  tenantIds: readonly string[];
  /** Per-dealer exclusions for the visitor's country (networkExclusionFor). */
  exclusions?: Readonly<Record<string, ComplianceHide | null>>;
  /** Facet value id sets (AND across sets, OR within one); null/empty sets are ignored unless explicitly []. */
  facetValueIds?: readonly (readonly string[] | null)[];
};

/** WHERE over `products p` for the network (see the header for the rules). */
export function networkProductWhere(input: NetworkWhereInput): Prisma.Sql {
  if (!input.tenantIds.length) return Prisma.sql`FALSE`;
  const parts: Prisma.Sql[] = [
    Prisma.sql`p."tenantId" = ANY(${[...input.tenantIds]}::text[])`,
    Prisma.sql`p.status = 'ACTIVE' AND p.quantity > 0`,
    Prisma.sql`p."fairHoldId" IS NULL`,
    Prisma.sql`NOT p.blurred AND NOT p."ageRestricted" AND NOT p."restrictedSymbols"`,
  ];
  for (const tenantId of [...input.tenantIds].sort()) {
    const hide = input.exclusions?.[tenantId];
    if (!hide) continue;
    const any: Prisma.Sql[] = [];
    if (hide.categoryIds.length) any.push(Prisma.sql`coalesce(p."categoryId" = ANY(${hide.categoryIds}::text[]), false)`);
    if (hide.deactivatedWeapons) any.push(Prisma.sql`p."requiresDeactivationCert"`);
    if (any.length) parts.push(Prisma.sql`NOT (p."tenantId" = ${tenantId} AND (${Prisma.join(any, " OR ")}))`);
  }
  for (const ids of input.facetValueIds ?? []) {
    if (ids === null) continue;
    parts.push(
      ids.length
        ? Prisma.sql`EXISTS (SELECT 1 FROM product_facet_values pfv WHERE pfv."productId" = p.id AND pfv."facetValueId" = ANY(${[...ids]}::text[]))`
        : Prisma.sql`FALSE`,
    );
  }
  return Prisma.join(parts, " AND ");
}

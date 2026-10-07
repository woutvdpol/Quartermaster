import { descendantIds } from "@/server/facets/tree";
import { facetToken, groupFacetTokens } from "./params";
import type { PublicTaxonomy } from "./types";

/** A facet selection resolved to value ids (each selected value expanded to its descendants). */
export type FacetSelection = { facetId: string; valueIds: string[] };

/** Resolves URL tokens against the taxonomy; unknown facets/values are dropped. Pure. */
export function resolveFacetSelection(tax: PublicTaxonomy, tokens: readonly string[]): FacetSelection[] {
  const out: FacetSelection[] = [];
  for (const [facetSlug, valueSlugs] of groupFacetTokens(tokens)) {
    const facet = tax.facets.find((f) => f.slug === facetSlug);
    if (!facet) continue;
    const own = tax.values.filter((v) => v.facetId === facet.id);
    const ids = new Set<string>();
    for (const slug of valueSlugs) {
      const value = own.find((v) => v.slug === slug);
      if (value) for (const d of descendantIds(own, value.id)) ids.add(d);
    }
    if (ids.size) out.push({ facetId: facet.id, valueIds: [...ids] });
  }
  return out;
}


/** Readable tokens for facet value ids (unknown ids dropped). Pure. */
export function tokensForValueIds(tax: PublicTaxonomy, ids: readonly string[]): string[] {
  return ids.flatMap((id) => {
    const value = tax.values.find((v) => v.id === id);
    const facet = value ? tax.facets.find((f) => f.id === value.facetId) : undefined;
    return value && facet ? [facetToken(facet.slug, value.slug)] : [];
  });
}

/** Ids of the selected values (not expanded to descendants) for tokens + direct ids. Pure. */
export function selectedValueIds(tax: PublicTaxonomy, tokens: readonly string[], ids: readonly string[] = []): string[] {
  const out = new Set<string>(ids.filter((id) => tax.values.some((v) => v.id === id)));
  for (const [facetSlug, valueSlugs] of groupFacetTokens(tokens)) {
    const facet = tax.facets.find((f) => f.slug === facetSlug);
    if (!facet) continue;
    for (const slug of valueSlugs) {
      const value = tax.values.find((v) => v.facetId === facet.id && v.slug === slug);
      if (value) out.add(value.id);
    }
  }
  return [...out];
}

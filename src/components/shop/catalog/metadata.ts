import type { Metadata } from "next";
import { hasActiveFilters, type CatalogParams } from "@/server/storefront-catalog";

/**
 * Metadata for catalog listings. Canonical = the clean path (page 2+ keeps ?page=). Filtered,
 * searched, re-sorted or "load more" views are `noindex, follow` (docs/analysis/03 §8).
 */
export function catalogMetadata({ path, params, title, description }: { path: string; params: CatalogParams; title: string; description: string }): Metadata {
  const variant = hasActiveFilters(params) || params.show !== null || params.view !== null;
  const canonical = params.page > 1 && !variant ? `${path}?page=${params.page}` : path;
  return {
    title: params.page > 1 ? `${title} – page ${params.page}` : title,
    description,
    alternates: { canonical },
    robots: variant ? { index: false, follow: true } : undefined,
    openGraph: { title, description, url: canonical },
  };
}

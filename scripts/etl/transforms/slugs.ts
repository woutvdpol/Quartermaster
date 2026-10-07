import { nextFreeSlug, slugify } from "../../../src/server/catalog/slug";

export type SlugItem = { key: number; slug: string | null | undefined; title: string; fallback: string };
export type SlugCollision = { key: number; wanted: string; assigned: string };

/**
 * Deterministic per-tenant slug assignment for legacy rows (processed in the given order, i.e. by
 * legacy id). The legacy slug is normalised with `slugify` (title as fallback, then `fallback`);
 * duplicates — legacy slugs were not unique — get `-2`, `-3`, … in id order. `reserved` holds slugs
 * that are taken by rows the ETL does not own (or route names) and must be avoided.
 */
export function assignUniqueSlugs(
  items: readonly SlugItem[],
  reserved: Iterable<string> = [],
): { slugs: Map<number, string>; collisions: SlugCollision[] } {
  const taken = new Set(reserved);
  const slugs = new Map<number, string>();
  const collisions: SlugCollision[] = [];
  for (const item of items) {
    const base = slugify(item.slug ?? "") || slugify(item.title) || item.fallback;
    const assigned = nextFreeSlug(base, taken);
    taken.add(assigned);
    slugs.set(item.key, assigned);
    if (assigned !== base) collisions.push({ key: item.key, wanted: base, assigned });
  }
  return { slugs, collisions };
}

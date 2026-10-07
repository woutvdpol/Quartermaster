/** Pure slug helpers (no DB) — shared by products, categories and tags. */

export const MAX_SLUG_LENGTH = 80;

/**
 * URL slug: lower-case ASCII, words joined by "-". Diacritics are stripped ("Überjäger" → "uberjager"),
 * "ß" → "ss", "&" → "and"; anything else non-alphanumeric becomes a separator. Cut at a word boundary
 * near MAX_SLUG_LENGTH. Returns "" when nothing usable remains (callers fall back to a default).
 */
export function slugify(input: string, maxLength = MAX_SLUG_LENGTH): string {
  const ascii = input
    .replace(/ß/g, "ss")
    .replace(/æ/gi, "ae")
    .replace(/ø/gi, "o")
    .replace(/œ/gi, "oe")
    .replace(/&/g, " and ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  let slug = ascii.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug.length > maxLength) {
    slug = slug.slice(0, maxLength);
    const cut = slug.lastIndexOf("-");
    if (cut > maxLength / 2) slug = slug.slice(0, cut);
    slug = slug.replace(/-+$/g, "");
  }
  return slug;
}

/**
 * Picks the first free slug among `base`, `base-2`, `base-3`, … given the slugs already taken
 * (only those equal to base or starting with `base-` matter).
 */
export function nextFreeSlug(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!set.has(candidate)) return candidate;
  }
}

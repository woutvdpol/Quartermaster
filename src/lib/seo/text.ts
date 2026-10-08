/*
 * Text helpers for titles, meta descriptions and machine-readable copy. Pure (server + tests).
 *
 * Lengths follow what search engines actually show: Google truncates titles by pixel width (~600 px,
 * roughly 55–65 characters) and snippets around 150–160 characters. We cut on a word boundary and
 * add an ellipsis so a truncated description never ends mid-word.
 */

/** Characters of a page title before the " · Shop name" suffix. */
export const TITLE_MAX = 70;
/** Characters of a meta description. */
export const DESCRIPTION_MAX = 160;

/** Collapses whitespace (incl. newlines) to single spaces and trims. */
export function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Shortens `text` to at most `max` characters on a word boundary, appending "…" when cut.
 * Words longer than the remaining space are cut hard (better than an empty result).
 */
export function truncate(text: string, max: number): string {
  const s = squash(text);
  if (s.length <= max) return s;
  const room = max - 1; // the ellipsis
  const cut = s.slice(0, room + 1);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace >= Math.floor(room * 0.6) ? cut.slice(0, lastSpace) : s.slice(0, room);
  return `${base.replace(/[\s,;:.\-–—]+$/, "")}…`;
}

/** The first argument that is a non-empty string after squashing, or null. */
export function firstText(...values: (string | null | undefined | false)[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && squash(v)) return squash(v);
  }
  return null;
}

/** Meta description: first non-empty candidate, truncated to DESCRIPTION_MAX. */
export function metaDescription(...candidates: (string | null | undefined | false)[]): string | undefined {
  const text = firstText(...candidates);
  return text ? truncate(text, DESCRIPTION_MAX) : undefined;
}

/** Page title (without the shop-name suffix the layout template adds), truncated to TITLE_MAX. */
export function metaTitle(...candidates: (string | null | undefined | false)[]): string {
  return truncate(firstText(...candidates) ?? "", TITLE_MAX);
}

/** "A, B and C" (English list). */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

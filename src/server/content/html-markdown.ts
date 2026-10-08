/**
 * (Simple) HTML → the Markdown subset of ./markdown.ts (paragraphs, headings, lists, quotes, **bold**,
 * *italic*, [links](url)). Pure, no dependencies. Used by the Concept500 ETL (legacy summernote HTML)
 * and the WooCommerce / Shopify product import (src/server/import).
 *
 * Raw HTML is never kept: the renderer escapes it, so leftover tags would show up as literal text.
 * The output is plain text — safety comes from the Markdown renderer (escapes everything, sanitises
 * link URLs), not from this converter.
 */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", euro: "€", deg: "°", times: "×" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+\d*);/gi, (m, name: string) => {
    const lower = name.toLowerCase();
    if (lower in ENTITIES) return ENTITIES[lower];
    try {
      if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
      if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    } catch {
      return "";
    }
    return m;
  });
}

export function looksLikeHtml(s: string): boolean {
  return /<\/?(p|br|div|span|strong|b|em|i|a|ul|ol|li|h[1-6]|blockquote|table|font)\b[^>]*>/i.test(s);
}

export type HtmlToMarkdownOptions = {
  /** "link" (default) keeps `<img>` as `[image](src)`; "drop" removes them (hot links to another shop). */
  images?: "link" | "drop";
};

/**
 * Converts (simple) HTML to Markdown. `mapHref` may rewrite link targets (legacy absolute → relative);
 * returning null drops the link but keeps its text.
 */
export function htmlToMarkdown(
  html: string,
  mapHref: (href: string) => string | null = (h) => h,
  opts: HtmlToMarkdownOptions = {},
): string {
  let s = html.replace(/\r\n?/g, "\n");
  s = s.replace(/<(script|style|iframe|object|noscript|template)[^>]*>[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  // Links first (their inner HTML is converted with the rest).
  s = s.replace(/<a\b[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_m, _q, href: string, text: string) => {
    const target = mapHref(decodeEntities(href.trim()));
    const label = text.replace(/<[^>]+>/g, "").trim();
    if (!target) return label;
    return `[${label || target}](${target})`;
  });
  s = s.replace(/<img\b[^>]*?src\s*=\s*(["'])(.*?)\1[^>]*>/gi, (_m, _q, src: string) => (opts.images === "drop" ? "" : `[image](${src})`));
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => (inner.trim() ? `**${inner.trim()}**` : ""));
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => (inner.trim() ? `*${inner.trim()}*` : ""));
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => `\n\n${"#".repeat(Math.max(2, Number(level)))} ${inner.trim()}\n\n`);
  // Ordered lists keep their numbers; unordered become "- ".
  s = s.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_m, inner: string) => {
    let n = 0;
    return `\n\n${inner.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_l, item: string) => `\n${++n}. ${item.trim()}`)}\n\n`;
  });
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => `\n- ${inner.trim()}`);
  s = s.replace(/<\/?(ul|ol)\b[^>]*>/gi, "\n\n");
  s = s.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner: string) => `\n\n> ${inner.trim().replace(/\n+/g, " ")}\n\n`);
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<hr\b[^>]*>/gi, "\n\n---\n\n");
  s = s.replace(/<\/(p|div|tr|table|section|article)>/gi, "\n\n");
  s = s.replace(/<(p|div|tr|table|section|article)\b[^>]*>/gi, "\n\n");
  s = s.replace(/<\/?(td|th)\b[^>]*>/gi, " ");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  return tidyMarkdown(s);
}

/** Collapses runs of spaces, trims line ends, max one blank line in a row. */
export function tidyMarkdown(s: string): string {
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Plain text of an HTML snippet (tags removed, entities decoded, whitespace collapsed). */
export function htmlToPlainText(html: string): string {
  return decodeEntities(html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

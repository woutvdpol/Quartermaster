/**
 * Legacy rich text → the Markdown subset of src/server/content/markdown.ts (paragraphs, headings,
 * lists, quotes, **bold**, *italic*, [links](url)). Legacy `contents.content` is HTML from the
 * summernote editor; `content_blocks.content` is Markdown (easymde). Raw HTML is never kept: the new
 * renderer escapes it, so it would show up as literal tags.
 */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+\d*);/gi, (m, name: string) => {
    const lower = name.toLowerCase();
    if (lower in ENTITIES) return ENTITIES[lower];
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return m;
  });
}

export function looksLikeHtml(s: string): boolean {
  return /<\/?(p|br|div|span|strong|b|em|i|a|ul|ol|li|h[1-6]|blockquote|table|font)\b[^>]*>/i.test(s);
}

/**
 * Converts (simple) HTML to Markdown. `mapHref` may rewrite link targets (legacy absolute → relative);
 * returning null drops the link but keeps its text.
 */
export function htmlToMarkdown(html: string, mapHref: (href: string) => string | null = (h) => h): string {
  let s = html.replace(/\r\n?/g, "\n");
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  // Links first (their inner HTML is converted with the rest).
  s = s.replace(/<a\b[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_m, _q, href: string, text: string) => {
    const target = mapHref(decodeEntities(href.trim()));
    const label = text.replace(/<[^>]+>/g, "").trim();
    if (!target) return label;
    return `[${label || target}](${target})`;
  });
  s = s.replace(/<img\b[^>]*?src\s*=\s*(["'])(.*?)\1[^>]*>/gi, (_m, _q, src: string) => `[image](${src})`);
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => (inner.trim() ? `**${inner.trim()}**` : ""));
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => (inner.trim() ? `*${inner.trim()}*` : ""));
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => `\n\n${"#".repeat(Math.max(2, Number(level)))} ${inner.trim()}\n\n`);
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => `\n- ${inner.trim()}`);
  s = s.replace(/<\/?(ul|ol)\b[^>]*>/gi, "\n\n");
  s = s.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner: string) => `\n\n> ${inner.trim().replace(/\n+/g, " ")}\n\n`);
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|table|section|article)>/gi, "\n\n");
  s = s.replace(/<(p|div|tr|table|section|article)\b[^>]*>/gi, "\n\n");
  s = s.replace(/<\/?(td|th)\b[^>]*>/gi, " ");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  return tidy(s);
}

/** Markdown from easymde: drop raw HTML tags, turn images into plain links (the renderer has no images). */
export function cleanMarkdown(md: string, mapHref: (href: string) => string | null = (h) => h): string {
  if (looksLikeHtml(md)) return htmlToMarkdown(md, mapHref);
  let s = md.replace(/\r\n?/g, "\n");
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_m, alt: string, src: string) => `[${alt || "image"}](${src})`);
  s = s.replace(/(?<!!)\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, text: string, href: string) => {
    const target = mapHref(href);
    return target ? `[${text}](${target})` : text;
  });
  return tidy(s);
}

function tidy(s: string): string {
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Counts Markdown images / Cloudflare delivery URLs left in converted text (not migrated). */
export function countCloudflareImageRefs(s: string): number {
  return (s.match(/imagedelivery\.net\//g) ?? []).length;
}

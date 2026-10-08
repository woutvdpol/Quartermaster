/**
 * Legacy rich text → the Markdown subset of src/server/content/markdown.ts (paragraphs, headings,
 * lists, quotes, **bold**, *italic*, [links](url)). Legacy `contents.content` is HTML from the
 * summernote editor; `content_blocks.content` is Markdown (easymde). Raw HTML is never kept: the new
 * renderer escapes it, so it would show up as literal tags.
 */

import { htmlToMarkdown, looksLikeHtml, tidyMarkdown as tidy } from "../../../src/server/content/html-markdown";

// Shared with the WooCommerce / Shopify product import (src/server/content/html-markdown.ts).
export { htmlToMarkdown, looksLikeHtml };

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

/** Counts Markdown images / Cloudflare delivery URLs left in converted text (not migrated). */
export function countCloudflareImageRefs(s: string): number {
  return (s.match(/imagedelivery\.net\//g) ?? []).length;
}

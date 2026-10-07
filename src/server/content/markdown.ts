/**
 * Minimal, safe Markdown for CMS text blocks. Pure (no `server-only`), no dependencies.
 *
 * Why our own: blocks store rich text as a Markdown *string* (easy to edit, diff and migrate from the
 * legacy easymde fields). Full CommonMark allows raw HTML, which we never want from tenant input, and
 * pulling in a parser + sanitizer is a dependency we do not need for what shops actually write.
 *
 * Supported subset:
 *   blocks:  paragraphs (single newlines become <br>), headings `#`..`######` (mapped to h2–h4 — the
 *            page title owns h1), `-`/`*`/`+` bullet lists, `1.`/`1)` numbered lists, `>` quotes, `---`
 *   inline:  **bold**, *italic* / _italic_, [text](url), backslash escapes
 * Everything else is literal text. ALL text is HTML-escaped; raw HTML is shown, never interpreted.
 * Link URLs go through `sanitizeUrl` — unsafe links (javascript:, data:, //host …) render as plain text.
 *
 * Two outputs: `parseMarkdown` → a small AST (render it with React elements, no innerHTML needed) and
 * `renderMarkdown` → an escaped HTML string.
 */
import { isExternalUrl, sanitizeUrl } from "./url";

export const MAX_MARKDOWN_LENGTH = 20_000;

export type MdInline =
  | { type: "text"; value: string }
  | { type: "strong"; children: MdInline[] }
  | { type: "em"; children: MdInline[] }
  | { type: "link"; href: string; external: boolean; children: MdInline[] }
  | { type: "br" };

export type MdBlock =
  | { type: "paragraph"; children: MdInline[] }
  | { type: "heading"; level: 2 | 3 | 4; children: MdInline[] }
  | { type: "list"; ordered: boolean; items: MdInline[][] }
  | { type: "quote"; children: MdInline[] }
  | { type: "rule" };

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const ORDERED = /^\s{0,3}\d{1,9}[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;

export function parseMarkdown(input: string): MdBlock[] {
  const source = (input ?? "").slice(0, MAX_MARKDOWN_LENGTH).replace(/\r\n?/g, "\n");
  const lines = source.split("\n");
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  let quote: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flush = () => {
    if (para.length) blocks.push({ type: "paragraph", children: inlineLines(para) });
    if (quote.length) blocks.push({ type: "quote", children: inlineLines(quote) });
    if (list) blocks.push({ type: "list", ordered: list.ordered, items: list.items.map((i) => parseInline(i)) });
    para = [];
    quote = [];
    list = null;
  };

  for (const line of lines) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push({ type: "rule" });
      continue;
    }
    const h = HEADING.exec(line.trimStart());
    if (h && line.search(/\S/) <= 3) {
      flush();
      const level = Math.min(4, Math.max(2, h[1].length)) as 2 | 3 | 4;
      blocks.push({ type: "heading", level, children: parseInline(h[2]) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const ordered = bullet ? null : ORDERED.exec(line);
    if (bullet || ordered) {
      const isOrdered = !!ordered;
      if (!list || list.ordered !== isOrdered) {
        flush();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push((bullet ?? ordered)![1]);
      continue;
    }
    const q = QUOTE.exec(line);
    if (q) {
      if (!quote.length) flush();
      quote.push(q[1]);
      continue;
    }
    if (list) {
      // Lazy continuation of the last list item.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    if (quote.length) flush();
    para.push(line.trim());
  }
  flush();
  return blocks;
}

function inlineLines(lines: string[]): MdInline[] {
  const out: MdInline[] = [];
  lines.forEach((l, i) => {
    if (i > 0) out.push({ type: "br" });
    out.push(...parseInline(l));
  });
  return out;
}

const ESCAPABLE = new Set("\\`*_{}[]()#+-.!>~|".split(""));

/** Inline parser. `allowLinks` is false inside link text (no nested anchors). */
export function parseInline(src: string, allowLinks = true): MdInline[] {
  const out: MdInline[] = [];
  let text = "";
  const pushText = () => {
    if (text) out.push({ type: "text", value: text });
    text = "";
  };
  // Closers that do not exist anywhere after `i` never need to be searched for (keeps this linear-ish).
  const lastStar = src.lastIndexOf("*");
  const lastUnderscore = src.lastIndexOf("_");
  const lastBracket = src.lastIndexOf("]");
  const lastParen = src.lastIndexOf(")");

  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\" && i + 1 < src.length && ESCAPABLE.has(src[i + 1])) {
      text += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "*" && src[i + 1] === "*" && i + 2 < lastStar) {
      const end = src.indexOf("**", i + 2);
      if (end > i + 2) {
        pushText();
        out.push({ type: "strong", children: parseInline(src.slice(i + 2, end), allowLinks) });
        i = end + 2;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && i < (ch === "*" ? lastStar : lastUnderscore) && src[i + 1] !== ch && src[i + 1] !== " ") {
      // `_` only opens at a word boundary so snake_case_words stay literal.
      const opens = ch === "*" || i === 0 || !/[A-Za-z0-9]/.test(src[i - 1]);
      const end = opens ? findSingleCloser(src, ch, i + 1) : -1;
      if (end > i + 1) {
        pushText();
        out.push({ type: "em", children: parseInline(src.slice(i + 1, end), allowLinks) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "[" && allowLinks && i < lastBracket && i < lastParen) {
      const close = src.indexOf("]", i + 1);
      if (close !== -1 && src[close + 1] === "(") {
        const paren = findLinkEnd(src, close + 2);
        if (paren !== -1) {
          const label = src.slice(i + 1, close);
          const rawUrl = src.slice(close + 2, paren).trim();
          const href = sanitizeUrl(rawUrl);
          const children = parseInline(label, false);
          pushText();
          if (href) out.push({ type: "link", href, external: isExternalUrl(href), children });
          else out.push(...children); // unsafe link: keep the words, drop the target
          i = paren + 1;
          continue;
        }
      }
    }
    text += ch;
    i += 1;
  }
  pushText();
  return out;
}

/** Index of the ")" closing a link destination starting at `from`, allowing balanced parentheses inside. */
function findLinkEnd(src: string, from: number): number {
  let depth = 0;
  for (let j = from; j < src.length; j++) {
    const c = src[j];
    if (c === "\\") j++;
    else if (c === "(") depth++;
    else if (c === ")") {
      if (depth === 0) return j;
      depth--;
    } else if (c === "\n") return -1;
  }
  return -1;
}

function findSingleCloser(src: string, ch: string, from: number): number {
  for (let j = from; j < src.length; j++) {
    if (src[j] === "\\") {
      j++;
      continue;
    }
    if (src[j] !== ch) continue;
    if (src[j + 1] === ch) {
      j++; // skip a "**" pair inside an emphasis
      continue;
    }
    if (src[j - 1] === " ") continue;
    if (ch === "_" && j + 1 < src.length && /[A-Za-z0-9]/.test(src[j + 1])) continue;
    return j;
  }
  return -1;
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

function inlineToHtml(nodes: MdInline[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
          return escapeHtml(n.value);
        case "br":
          return "<br>";
        case "strong":
          return `<strong>${inlineToHtml(n.children)}</strong>`;
        case "em":
          return `<em>${inlineToHtml(n.children)}</em>`;
        case "link": {
          const rel = n.external ? ' rel="noopener noreferrer"' : "";
          return `<a href="${escapeHtml(n.href)}"${rel}>${inlineToHtml(n.children)}</a>`;
        }
      }
    })
    .join("");
}

/** Markdown → escaped HTML string, safe for `dangerouslySetInnerHTML`. */
export function renderMarkdown(input: string): string {
  return parseMarkdown(input)
    .map((b) => {
      switch (b.type) {
        case "paragraph":
          return `<p>${inlineToHtml(b.children)}</p>`;
        case "heading":
          return `<h${b.level}>${inlineToHtml(b.children)}</h${b.level}>`;
        case "quote":
          return `<blockquote><p>${inlineToHtml(b.children)}</p></blockquote>`;
        case "rule":
          return "<hr>";
        case "list": {
          const tag = b.ordered ? "ol" : "ul";
          return `<${tag}>${b.items.map((it) => `<li>${inlineToHtml(it)}</li>`).join("")}</${tag}>`;
        }
      }
    })
    .join("\n");
}

/** Plain text (for meta descriptions / previews): formatting dropped, whitespace collapsed. */
export function markdownToPlainText(input: string): string {
  const text = (nodes: MdInline[]): string =>
    nodes.map((n) => (n.type === "text" ? n.value : n.type === "br" ? " " : text(n.children))).join("");
  return parseMarkdown(input)
    .map((b) => (b.type === "rule" ? "" : b.type === "list" ? b.items.map(text).join(" ") : text(b.children)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

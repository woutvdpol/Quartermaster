/**
 * Minimal, safe Markdown → HTML for newsletter bodies.
 *
 * Safety model: the whole input is HTML-escaped *first*; only the constructs below are turned
 * into tags afterwards, and URLs must be http(s) (images) or http(s)/mailto (links). Raw HTML in the
 * Markdown therefore shows up as text, never as markup — no sanitizer library needed.
 *
 * Supported: # / ## / ### headings, paragraphs (single newline = <br>), - / * / 1. lists, > quotes,
 * --- rules, **bold**, *italic* / _italic_, `code`, [text](url), ![alt](url).
 */

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

const LINK_STYLE = "color:#8b1e1e;text-decoration:underline";
const P_STYLE = "margin:0 0 14px;font-size:15px;line-height:22px";

function safeUrl(escaped: string, allowMailto: boolean): string | null {
  const url = escaped.trim();
  if (/^https?:\/\/[^\s]+$/i.test(url)) return url;
  if (allowMailto && /^mailto:[^\s]+$/i.test(url)) return url;
  return null;
}

/** Inline formatting on already-escaped text. */
function emphasis(text: string): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");
}

function inline(text: string): string {
  // Generated tags are swapped for placeholders so later passes never touch their attributes.
  const tokens: string[] = [];
  const keep = (html: string) => `\u0000${tokens.push(html) - 1}\u0000`;
  let out = text.replace(/\u0000/g, "");
  out = out.replace(/`([^`\n]+)`/g, (_, code: string) =>
    keep(`<code style="font-family:monospace;background:#f2f2f0;padding:1px 4px">${code}</code>`),
  );
  out = out.replace(/!\[([^\]\n]*)\]\(([^)\s]+)\)/g, (_, alt: string, url: string) => {
    const safe = safeUrl(url, false);
    return safe ? keep(`<img src="${safe}" alt="${alt}" style="max-width:100%;height:auto;display:block;margin:8px 0" />`) : alt;
  });
  out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, label: string, url: string) => {
    const safe = safeUrl(url, true);
    return safe ? keep(`<a href="${safe}" style="${LINK_STYLE}">${emphasis(label)}</a>`) : label;
  });
  return emphasis(out).replace(/\u0000(\d+)\u0000/g, (_, i: string) => tokens[Number(i)]);
}

type Block = { kind: "p" | "h" | "ul" | "ol" | "quote" | "hr"; level?: number; lines: string[] };

export function renderMarkdown(markdown: string): string {
  const lines = escapeHtml(markdown.replace(/\r\n?/g, "\n")).split("\n");
  const blocks: Block[] = [];
  let current: Block | null = null;
  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "h", level: heading[1].length, lines: [heading[2]] });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push({ kind: "hr", lines: [] });
      continue;
    }
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const quote = /^&gt;\s?(.*)$/.exec(line);
    const kind: Block["kind"] = ul ? "ul" : ol ? "ol" : quote ? "quote" : "p";
    const content = ul?.[1] ?? ol?.[1] ?? quote?.[1] ?? line;
    if (!current || current.kind !== kind) {
      flush();
      current = { kind, lines: [] };
    }
    current.lines.push(content);
  }
  flush();

  return blocks
    .map((b) => {
      switch (b.kind) {
        case "h": {
          const size = [0, 24, 20, 17][b.level!];
          return `<h${b.level} style="margin:0 0 12px;font-size:${size}px;line-height:1.3">${inline(b.lines[0])}</h${b.level}>`;
        }
        case "hr":
          return `<hr style="border:none;border-top:1px solid #e6e6e3;margin:20px 0" />`;
        case "ul":
        case "ol":
          return `<${b.kind} style="${P_STYLE};padding-left:22px">${b.lines.map((l) => `<li>${inline(l)}</li>`).join("")}</${b.kind}>`;
        case "quote":
          return `<blockquote style="margin:0 0 14px;padding:4px 12px;border-left:3px solid #c2b280;color:#555555">${b.lines.map(inline).join("<br />")}</blockquote>`;
        default:
          return `<p style="${P_STYLE}">${b.lines.map(inline).join("<br />")}</p>`;
      }
    })
    .join("\n");
}

import { parseMarkdown, type MdInline } from "@/server/content/markdown";

/*
 * Plain-text excerpt of Markdown provenance (for the certificate snapshot / PDF, which cannot render
 * Markdown). Pure module.
 */

function inlineText(nodes: MdInline[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
          return n.value;
        case "br":
          return " ";
        default:
          return inlineText(n.children);
      }
    })
    .join("");
}

/** Markdown → plain text paragraphs separated by blank lines. */
export function markdownToPlainText(source: string | null | undefined): string {
  if (!source?.trim()) return "";
  const parts: string[] = [];
  for (const block of parseMarkdown(source)) {
    switch (block.type) {
      case "rule":
        break;
      case "list":
        parts.push(block.items.map((item) => `• ${inlineText(item).trim()}`).join("\n"));
        break;
      default:
        parts.push(inlineText(block.children).replace(/\s+/g, " ").trim());
    }
  }
  return parts.filter(Boolean).join("\n\n");
}

/** At most `max` characters, cut at a word boundary with an ellipsis. */
export function excerpt(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space >= max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s.,;:–-]+$/, "")}…`;
}

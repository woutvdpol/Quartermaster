import type { ReactNode } from "react";

const EMPHASIS = /\*([^*\n]+)\*/g;

/**
 * Tiny, injection-safe emphasis parser for CMS titles: `Original militaria, *honestly* described.`
 * renders the starred part as <em> (inside h1–h3 the theme shows it in the accent serif, see
 * shop.css). Only plain strings and <em> elements are produced, so React escapes everything; no
 * HTML or Markdown is interpreted. Unpaired asterisks stay as typed.
 */
export function emphasis(text: string): ReactNode {
  if (!text.includes("*")) return text;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(EMPHASIS)) {
    const inner = m[1].trim();
    if (!inner) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<em key={m.index}>{m[1]}</em>);
    last = m.index + m[0].length;
  }
  if (!out.length) return text;
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** The title with the emphasis markers removed (for aria labels, alt text, metadata). */
export function stripEmphasis(text: string): string {
  return text.replace(EMPHASIS, "$1");
}

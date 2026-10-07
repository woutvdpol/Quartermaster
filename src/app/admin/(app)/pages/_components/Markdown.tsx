import type { ReactNode } from "react";
import { parseMarkdown, type MdBlock, type MdInline } from "@/server/content/markdown";

/*
 * Renders the safe Markdown subset from the AST of `parseMarkdown` as React elements (no innerHTML).
 * Links are already sanitised by the parser; in the admin preview they are inert (no navigation).
 */

function inline(nodes: MdInline[], keyPrefix: string): ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (n.type) {
      case "text":
        return n.value;
      case "br":
        return <br key={key} />;
      case "strong":
        return <strong key={key}>{inline(n.children, key)}</strong>;
      case "em":
        return <em key={key}>{inline(n.children, key)}</em>;
      case "link":
        return (
          <span key={key} title={n.href} className="text-accent underline underline-offset-2">
            {inline(n.children, key)}
          </span>
        );
    }
  });
}

const headingClass = { 2: "text-[1.25em]", 3: "text-[1.1em]", 4: "text-[1em]" } as const;

function block(b: MdBlock, i: number): ReactNode {
  const key = `b${i}`;
  switch (b.type) {
    case "paragraph":
      return <p key={key}>{inline(b.children, key)}</p>;
    case "heading": {
      const Tag = `h${Math.min(b.level + 1, 6)}` as "h3" | "h4" | "h5";
      return (
        <Tag key={key} className={`type-display ${headingClass[b.level]}`}>
          {inline(b.children, key)}
        </Tag>
      );
    }
    case "list": {
      const Tag = b.ordered ? "ol" : "ul";
      return (
        <Tag key={key} className={b.ordered ? "list-decimal pl-5" : "list-disc pl-5"}>
          {b.items.map((item, j) => (
            <li key={j}>{inline(item, `${key}-${j}`)}</li>
          ))}
        </Tag>
      );
    }
    case "quote":
      return (
        <blockquote key={key} className="border-l-2 border-line-strong pl-3 text-ink-2 italic">
          {inline(b.children, key)}
        </blockquote>
      );
    case "rule":
      return <hr key={key} className="border-line" />;
  }
}

/** Markdown preview. Heading levels are shifted down one so they nest under the preview's own headings. */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source ?? "");
  if (!blocks.length) return null;
  return <div className={`grid gap-2 ${className ?? ""}`}>{blocks.map(block)}</div>;
}

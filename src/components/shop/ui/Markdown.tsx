import Link from "./Link";
import { Fragment, type ReactNode } from "react";
import { parseMarkdown, type MdBlock, type MdInline } from "@/server/content/markdown";
import { cn } from "./cn";

/**
 * Renders the safe Markdown subset (src/server/content/markdown.ts) as React elements — no innerHTML.
 * Links were already sanitised by the parser; external ones get rel="noopener noreferrer".
 * Headings are h2–h4 (the page owns h1). Styled by `.shop-prose` (shop.css).
 */
export function Markdown({ source, className }: { source: string | null | undefined; className?: string }) {
  if (!source?.trim()) return null;
  const blocks = parseMarkdown(source);
  return <div className={cn("shop-prose", className)}>{blocks.map((b, i) => renderBlock(b, i))}</div>;
}

function renderBlock(b: MdBlock, key: number): ReactNode {
  switch (b.type) {
    case "paragraph":
      return <p key={key}>{renderInline(b.children)}</p>;
    case "heading": {
      const H = `h${b.level}` as "h2" | "h3" | "h4";
      return <H key={key}>{renderInline(b.children)}</H>;
    }
    case "quote":
      return (
        <blockquote key={key}>
          <p>{renderInline(b.children)}</p>
        </blockquote>
      );
    case "rule":
      return <hr key={key} />;
    case "list": {
      const L = b.ordered ? "ol" : "ul";
      return (
        <L key={key}>
          {b.items.map((it, i) => (
            <li key={i}>{renderInline(it)}</li>
          ))}
        </L>
      );
    }
  }
}

function renderInline(nodes: MdInline[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.type) {
      case "text":
        return <Fragment key={i}>{n.value}</Fragment>;
      case "br":
        return <br key={i} />;
      case "strong":
        return <strong key={i}>{renderInline(n.children)}</strong>;
      case "em":
        return <em key={i}>{renderInline(n.children)}</em>;
      case "link":
        return n.external || /^mailto:/i.test(n.href) ? (
          <a key={i} href={n.href} rel={n.external ? "noopener noreferrer" : undefined}>
            {renderInline(n.children)}
          </a>
        ) : (
          <Link key={i} href={n.href}>
            {renderInline(n.children)}
          </Link>
        );
    }
  });
}

import Link from "next/link";
import { cn } from "./cn";
import { uiCopy } from "./_copy";

export type Crumb = { label: string; href?: string | null };

/**
 * Breadcrumb trail. The last item is the current page (no link, aria-current).
 * Also emits BreadcrumbList JSON-LD when `jsonLdBase` (absolute origin, e.g. "https://shop.nl") is given.
 */
export function Breadcrumbs({ items, className, jsonLdBase }: { items: Crumb[]; className?: string; jsonLdBase?: string }) {
  const all: Crumb[] = [{ label: uiCopy.breadcrumbs.home, href: "/" }, ...items];
  const ld = jsonLdBase
    ? {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: all.map((c, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: c.label,
          ...(c.href ? { item: new URL(c.href, jsonLdBase).toString() } : {}),
        })),
      }
    : null;
  return (
    <nav aria-label={uiCopy.breadcrumbs.label} className={cn("text-[0.85rem] text-shop-muted", className)}>
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {all.map((c, i) => {
          const last = i === all.length - 1;
          return (
            <li key={`${i}-${c.label}`} className="flex min-w-0 items-center gap-1.5">
              {i > 0 ? <span aria-hidden="true" className="text-shop-line-strong">/</span> : null}
              {c.href && !last ? (
                <Link href={c.href} className="truncate transition-colors hover:text-shop-ink">
                  {c.label}
                </Link>
              ) : (
                <span className={cn("truncate", last && "text-shop-ink-2")} aria-current={last ? "page" : undefined}>
                  {c.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {ld ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(ld) }} /> : null}
    </nav>
  );
}

/** JSON for a <script type="application/ld+json">, with "<" escaped so content cannot close the tag. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

import Link from "@/components/shop/ui/Link";
import type { PublicMenuItem } from "@/server/content/menus";

/** A resolved menu item as a link; external targets get rel="noopener noreferrer". Null without href. */
export function MenuLink({ item, className }: { item: Pick<PublicMenuItem, "href" | "label" | "external">; className?: string }) {
  if (!item.href) return null;
  if (item.external || /^mailto:/i.test(item.href)) {
    return (
      <a href={item.href} className={className} rel={item.external ? "noopener noreferrer" : undefined}>
        {item.label}
      </a>
    );
  }
  return (
    <Link href={item.href} className={className}>
      {item.label}
    </Link>
  );
}

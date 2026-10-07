import { ADMIN_NAV, adminHref } from "@/lib/admin-nav";
import { getDictionary } from "@/lib/i18n";
import type { CommandItem } from "./types";

/* Static palette entries (no server round trip): quick actions and "Go to" navigation. Pure. */

const t = getDictionary();

export function quickActions(opts: { superadmin: boolean; canSwitch: boolean }): CommandItem[] {
  const items: CommandItem[] = [
    { id: "action:new-product", label: "New product", href: "/admin/inventory/new", meta: "Inventory" },
    { id: "action:orders-to-ship", label: "Go to Orders › To ship", href: "/admin/orders?view=toShip", meta: "Orders" },
    { id: "action:shipping-board", label: "Open shipping board", href: "/admin/shipping-board", meta: "Orders" },
  ];
  if (opts.superadmin && opts.canSwitch) items.push({ id: "action:switch-shop", label: "Switch shop…", action: "switch-shop", meta: "Platform" });
  return items;
}

export function navigationItems(superadmin: boolean): CommandItem[] {
  const out: CommandItem[] = [];
  for (const group of ADMIN_NAV) {
    for (const item of group.items) {
      if (item.superadminOnly && !superadmin) continue;
      out.push({ id: `nav:${item.slug}`, label: t.nav.items[item.key], href: adminHref(item), meta: t.nav.groups[group.group] });
    }
  }
  return out;
}

/** Case-insensitive "all words appear" match on label + meta. */
export function matchesQuery(item: CommandItem, query: string): boolean {
  const hay = `${item.label} ${item.meta ?? ""}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

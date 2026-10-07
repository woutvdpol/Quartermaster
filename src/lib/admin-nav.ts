import type { Dictionary } from "@/lib/i18n";

/*
 * Admin navigation structure. Items without `built: true` route to the shared "Not built yet"
 * page (src/app/admin/(app)/[...missing]/page.tsx), which looks the slug up here.
 */

export type NavItemKey = keyof Dictionary["nav"]["items"];
export type NavGroupKey = keyof Dictionary["nav"]["groups"];

export type NavItem = {
  key: NavItemKey;
  /** Path segment under /admin. */
  slug: string;
  built?: boolean;
  wip?: boolean;
};

export const ADMIN_NAV: { group: NavGroupKey; items: NavItem[] }[] = [
  { group: "overview", items: [{ key: "dashboard", slug: "dashboard", built: true }] },
  {
    group: "catalog",
    items: [
      { key: "inventory", slug: "inventory" },
      { key: "categories", slug: "categories" },
      { key: "sourcing", slug: "sourcing" },
    ],
  },
  {
    group: "sales",
    items: [
      { key: "orders", slug: "orders" },
      { key: "shippingBoard", slug: "shipping-board", wip: true },
      { key: "customers", slug: "customers" },
    ],
  },
  {
    group: "website",
    items: [
      { key: "pages", slug: "pages" },
      { key: "menus", slug: "menus" },
      { key: "newsletter", slug: "newsletter" },
    ],
  },
  {
    group: "system",
    items: [
      { key: "shipping", slug: "shipping" },
      { key: "paymentMethods", slug: "payment-methods" },
      { key: "settings", slug: "settings" },
      { key: "users", slug: "users" },
      { key: "auditLog", slug: "audit-log" },
    ],
  },
];

export function adminHref(item: NavItem): string {
  return `/admin/${item.slug}`;
}

export function findNavItemBySlug(slug: string): NavItem | undefined {
  for (const group of ADMIN_NAV) {
    const item = group.items.find((i) => i.slug === slug);
    if (item) return item;
  }
  return undefined;
}

/**
 * Validates a post-login redirect target. Only same-origin relative admin paths are accepted
 * (must start with "/admin", no "//", no scheme, no backslashes, not the login pages themselves);
 * anything else falls back to the dashboard. Prevents open redirects.
 */
export function safeAdminRedirect(next: unknown): string {
  const fallback = "/admin/dashboard";
  if (typeof next !== "string" || next.length === 0 || next.length > 512) return fallback;
  if (!next.startsWith("/admin")) return fallback;
  if (next.startsWith("//") || next.includes("\\") || next.includes("://") || /[\u0000-\u001f]/.test(next)) {
    return fallback;
  }
  // "/admin" must be followed by a segment boundary ("/adminfoo" is not an admin path).
  const rest = next.slice("/admin".length);
  if (rest !== "" && !/^[/?#]/.test(rest)) return fallback;
  if (/^\/admin\/login(?:[/?#]|$)/.test(next)) return fallback;
  return next;
}

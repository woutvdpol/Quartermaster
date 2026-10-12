/*
 * Storefront paths that belong to a paid module (docs/modules.md). Used to drop menu links to a module
 * the shop does not have (those pages 404). Pure, unit tested.
 */
import type { ModuleId } from "./catalog";

const MODULE_PATHS: { prefix: string; module: ModuleId }[] = [
  { prefix: "/auctions", module: "auctions" },
  { prefix: "/sell", module: "leads" },
  { prefix: "/account/alerts", module: "alerts" },
];

/** The module a shop-relative path belongs to (also with a /nl or /de locale prefix), if any. */
export function moduleForPath(href: string): ModuleId | undefined {
  if (!href.startsWith("/")) return undefined;
  const path = href.replace(/^\/(nl|de)(?=\/|$)/, "").split(/[?#]/)[0] || "/";
  return MODULE_PATHS.find((m) => path === m.prefix || path.startsWith(`${m.prefix}/`))?.module;
}

type MenuItem = { href: string | null; external: boolean; children: MenuItem[] };

/** Removes links (and their sub-items) to modules the shop lacks; headings without links stay. */
export function withoutLockedLinks<T extends MenuItem>(items: T[], features: Record<ModuleId, boolean>): T[] {
  return items
    .filter((item) => {
      if (!item.href || item.external) return true;
      const owner = moduleForPath(item.href);
      return !owner || features[owner];
    })
    .map((item) => ({ ...item, children: withoutLockedLinks(item.children as T[], features) }));
}

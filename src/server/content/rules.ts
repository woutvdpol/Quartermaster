/** Content rules shared by services and the admin UI. Pure (no DB, no `server-only`). */

/** Fixed pages every shop has. `ContentPage.systemKey`; legacy ShopPageEnum. */
export const SYSTEM_PAGE_KEYS = ["HOME", "TERMS", "PRIVACY", "CONTACT", "ABOUT"] as const;
export type SystemPageKey = (typeof SYSTEM_PAGE_KEYS)[number];

/** Default slug and title per system page (slug falls back to `<slug>-2`… when taken). */
export const SYSTEM_PAGES: Record<SystemPageKey, { slug: string; title: string }> = {
  HOME: { slug: "home", title: "Home" },
  TERMS: { slug: "terms", title: "Terms and conditions" },
  PRIVACY: { slug: "privacy", title: "Privacy policy" },
  CONTACT: { slug: "contact", title: "Contact" },
  ABOUT: { slug: "about", title: "About us" },
};

/**
 * Slugs a regular page may not take: they collide with app routes (pages are served from `/{slug}`)
 * or with the home page. The first eight are the agreed list; the rest guard routes in the shop plan.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "uploads",
  "product",
  "shop",
  "cart",
  "checkout",
  "account",
  "archive",
  "order",
  "forgot-password",
  "home",
  "pages",
  "products",
  "category",
  "search",
  "wishlist",
  "login",
  "logout",
  "register",
  "newsletter",
  "sitemap",
  "robots",
  "favicon",
  "_next",
]);

export const MAX_PAGE_SLUG_LENGTH = 80;

/** Root items per menu (legacy `MaxMenuItems`): 7 header items, 4 footer columns. */
export const MENU_ROOT_LIMITS = { HEADER: 7, FOOTER: 4 } as const;
/** Links under one header item / footer column. */
export const MENU_CHILD_LIMIT = 12;

/** Fixed storefront routes a menu item can point to (resolved to a path when the menu is read). */
export const SYSTEM_ROUTES = {
  home: { label: "Home", href: "/" },
  shop: { label: "Shop", href: "/shop" },
  cart: { label: "Cart", href: "/cart" },
  account: { label: "My account", href: "/account" },
  wishlist: { label: "Wishlist", href: "/account/wishlist" },
} as const;
export type SystemRouteKey = keyof typeof SYSTEM_ROUTES;
export const SYSTEM_ROUTE_KEYS = Object.keys(SYSTEM_ROUTES) as SystemRouteKey[];

/** Public URL helpers (single place to change when the shop routes land). */
export const contentPageHref = (page: { slug: string; systemKey?: string | null }) => (page.systemKey === "HOME" ? "/" : `/${page.slug}`);
export const categoryHref = (slug: string) => `/shop/category/${slug}`;

# Shop UI primitives

Server-component-friendly building blocks for the storefront. Import from `@/components/shop/ui`
(or the individual file). All styling uses the `shop-*` Tailwind tokens from
`src/app/(shop)/shop.css`, which the shop layout fills from the tenant's appearance settings —
never hardcode colours or fonts.

## Tokens (Tailwind utilities)

`bg-shop-bg` `bg-shop-surface` `bg-shop-sunken` · `text-shop-ink` `text-shop-ink-2` `text-shop-muted` ·
`border-shop-line` `border-shop-line-strong` · `bg-shop-primary` + `text-shop-on-primary`,
`bg-shop-primary-strong`, `bg-shop-primary-soft`, `text-shop-primary` · same for `secondary` and `accent` ·
status `shop-ok|warn|crit` (+ `-soft`) · `font-shop-heading` `font-shop-body` · `rounded-shop` `rounded-shop-sm` ·
`shadow-shop` `shadow-shop-pop`. Helpers: `.shop-prose` (Markdown), `.shop-rail` (scroll-snap row).
h1–h4 inside the shop automatically use the heading font.

## Components

| Component | Props (main) | Notes |
| --- | --- | --- |
| `Container` | `as?`, `size?: "default" \| "narrow" \| "wide"` | 1200 / 760 / 1440 px, responsive padding |
| `Button` | `variant?: primary\|accent\|secondary\|outline\|ghost\|link`, `size?: sm\|md\|lg`, `fullWidth?`, `pending?` + button props | type="button" by default |
| `ButtonLink` | same + `href`, `external?` | next/link; `buttonClasses()` for custom elements |
| `Badge` | `tone?: neutral\|primary\|accent\|sold\|reserved\|ok\|warn` | small uppercase label |
| `Price` | `cents`, `currency`, `display?: {currency, rate} \| null`, `compareAtCents?`, `size?: sm\|md\|lg\|xl` | Indicative "≈ £1,262 · indicative" only when `display.rate > 0` (no rates source yet → pass nothing) |
| `ShopImg` | `image: ShopImage`, `sizes?`, `priority?`, `fill?`, `fit?` | `<img>` with srcSet of stored variants + blur LQIP background |
| `LockedImg` | `blurDataUrl` | blurred placeholder for sensitive items (guests) |
| `ProductCard` | `product: ProductCardData`, `wishlistSlot?`, `priority?`, `display?`, `showStockCode?`, `headingLevel?`, `sizes?` | Sold/Reserved/Sale badges, locked mode, stretched link; slot sits above the link |
| `ProductGrid` | `products`, `columns?: 3\|4`, `wishlistSlot?: (p) => ReactNode`, `priorityCount?`, `display?`, `showStockCode?` | 2 / 3 / `columns` responsive |
| `Breadcrumbs` | `items: {label, href?}[]`, `jsonLdBase?` | "Home" is prepended; last item = current page; emits BreadcrumbList JSON-LD when `jsonLdBase` (shop origin) given |
| `Pagination` | `page`, `pageCount`, `hrefFor(page)` | link-based, ellipses; `pageWindow()` exported |
| `EmptyState` | `title`, `children?`, `action?`, `icon?` | |
| `Skeleton`, `ProductGridSkeleton` | `className` / `count?`, `columns?` | Suspense fallbacks |
| `SectionHeading` | `title`, `eyebrow?`, `intro?`, `action?: {label, href}`, `as?: h1\|h2\|h3`, `align?` | |
| `Markdown` | `source` | Safe subset (src/server/content/markdown.ts) rendered as React, no innerHTML |
| `JsonLd` | `data` | escaped `<script type="application/ld+json">` |
| `Field`, `TextInput` | `id`, `label`, `hint?`, `error?`, `required?` / input props + `invalid?` | form controls |

Utilities: `cn()`, `formatMoney(cents, currency)`, `formatIndicative(cents, from, to, rate)`, `SHOP_LOCALE`.

## Data shapes (`types.ts`)

- `ShopImage { src, srcSet?, blurDataUrl, alt, width?, height? }`
- `ProductCardData { id, stockCode, title, href, priceCents, currency, availability: "available"|"reserved"|"sold", showPrice, onSale, locked, image, eyebrow? }`
- `DisplayCurrency { currency, rate }`

Build `ProductCardData` on the server with `toProductCardData(row, opts)` from
`src/server/storefront/products.ts` (select rows with `productCardSelect`; get live reservations with
`liveReservedIds`). It applies the visibility rules: locked items never carry the real image URL.

## Shop chrome hooks (`@/components/shop/layout`)

- Header counts: `useHeaderCounts()` → `{ counts: {cart, wishlist}, setCounts(patch) }` (client),
  `<SyncHeaderCounts cart={n} wishlist={m} />` (render from any component to sync). The server-side
  source is `getHeaderCounts(tenantId)` in `src/server/storefront/header-counts.ts` — the cart/account
  owners replace its stub body.
- `NewsletterForm`, `SearchBox`.

## Server helpers (`src/server/storefront`)

`getShopContext()` / `requireShop()` (tenant + public settings subset, 404 on non-shop hosts),
`getShopViewer(tenantId)`, `getStorefrontHomePage`, `getStorefrontPage`, `getPublicMenus`,
`getLegalLinks`, product helpers above, `shopCache()` + `shopTag(tenantId, area)` for caching and
`revalidateTag`, `hasConfirmedAge()` / `AGE_COOKIE`.

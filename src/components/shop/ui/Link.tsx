"use client";

import NextLink from "next/link";
import type { ComponentProps } from "react";
import { localizePath } from "@/lib/i18n/shop-locales";
import { useShopLocale } from "@/components/shop/i18n/ShopLocale";

type Props = ComponentProps<typeof NextLink>;

/** Href in a language: strings and `{ pathname }` objects are prefixed, other values pass through. */
function localizeHref(href: Props["href"], locale: ReturnType<typeof useShopLocale>): Props["href"] {
  if (typeof href === "string") return localizePath(href, locale);
  if (href && typeof href === "object" && typeof href.pathname === "string") return { ...href, pathname: localizePath(href.pathname, locale) };
  return href;
}

/**
 * `next/link` for the shop: same-site paths keep the visitor's language ("/cart" → "/de/cart").
 * Data hrefs (productHref, categoryHref, CMS hrefs) stay unprefixed and are localised here.
 * Use this instead of `next/link` in every shop component (docs/i18n.md § Shop-routing).
 */
export default function Link({ href, ...props }: Props) {
  const locale = useShopLocale();
  return <NextLink href={localizeHref(href, locale)} {...props} />;
}

export { Link };

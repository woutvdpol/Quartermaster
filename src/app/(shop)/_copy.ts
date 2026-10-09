import { localized } from "@/lib/i18n/shop-copy";
import { shopPageCopyNl } from "./_copy.nl";
import { shopPageCopyDe } from "./_copy.de";

/** English copy for shop pages owned by the foundation (home, CMS pages, errors). Dutch/German: ./_copy.nl.ts, ./_copy.de.ts. */
export const shopPageCopy = {
  home: {
    fallbackSubtitle: "Browse our latest arrivals.",
    fallbackCta: "Browse the shop",
    newItems: "New arrivals",
    viewAll: "View all",
  },
  notFound: {
    eyebrow: "404",
    title: "Page not found",
    body: "The page you are looking for has moved, sold or never existed. Try the shop or search for it.",
    shop: "Browse the shop",
    home: "Back to home",
  },
  error: {
    title: "Something went wrong",
    body: "We could not load this page. Please try again in a moment.",
    retry: "Try again",
    home: "Back to home",
  },
} as const;

export const shopPageCopies = localized({ en: shopPageCopy, nl: shopPageCopyNl, de: shopPageCopyDe });

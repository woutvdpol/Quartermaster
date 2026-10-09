import { localized } from "@/lib/i18n/shop-copy";
import { recentCopyNl } from "./_copy.nl";
import { recentCopyDe } from "./_copy.de";

export const recentCopy = {
  title: "Recently viewed",
  loading: "Loading recently viewed items…",
} as const;

export const recentCopies = localized({ en: recentCopy, nl: recentCopyNl, de: recentCopyDe });

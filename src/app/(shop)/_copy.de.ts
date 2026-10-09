import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { shopPageCopy } from "./_copy";

export const shopPageCopyDe: CopyShape<typeof shopPageCopy> = {
  home: {
    fallbackSubtitle: "Entdecken Sie unsere Neuzugänge.",
    fallbackCta: "Zum Shop",
    newItems: "Neuzugänge",
    viewAll: "Alle ansehen",
  },
  notFound: {
    eyebrow: "404",
    title: "Seite nicht gefunden",
    body: "Die gesuchte Seite wurde verschoben, verkauft oder hat nie existiert. Versuchen Sie es im Shop oder mit der Suche.",
    shop: "Zum Shop",
    home: "Zur Startseite",
  },
  error: {
    title: "Etwas ist schiefgelaufen",
    body: "Diese Seite konnte nicht geladen werden. Bitte versuchen Sie es gleich noch einmal.",
    retry: "Erneut versuchen",
    home: "Zur Startseite",
  },
};

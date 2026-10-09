import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { shopPageCopy } from "./_copy";

export const shopPageCopyNl: CopyShape<typeof shopPageCopy> = {
  home: {
    fallbackSubtitle: "Bekijk onze nieuwste aanwinsten.",
    fallbackCta: "Naar de winkel",
    newItems: "Nieuw binnen",
    viewAll: "Alles bekijken",
  },
  notFound: {
    eyebrow: "404",
    title: "Pagina niet gevonden",
    body: "De pagina die u zoekt is verplaatst, verkocht of heeft nooit bestaan. Probeer de winkel of zoek ernaar.",
    shop: "Naar de winkel",
    home: "Terug naar home",
  },
  error: {
    title: "Er ging iets mis",
    body: "We konden deze pagina niet laden. Probeer het zo meteen opnieuw.",
    retry: "Opnieuw proberen",
    home: "Terug naar home",
  },
};

import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { alertPagesCopy } from "./_copy";

export const alertPagesCopyNl: CopyShape<typeof alertPagesCopy> = {
  statusTitle: "Meldingen",
  status: {
    confirmed: { title: "Uw melding is actief", body: "We mailen u zodra er een passend item online komt." },
    unsubscribed: { title: "Melding gestopt", body: "U ontvangt deze e-mails niet meer." },
    expired: { title: "Link verlopen", body: "Deze bevestigingslink is verlopen. Maak de melding opnieuw aan." },
    invalid: { title: "Ongeldige link", body: "Deze link is ongeldig of al gebruikt. Gebruik de link uit de meest recente e-mail." },
    unknown: { title: "Meldingen", body: "Stel een melding in vanuit een zoekopdracht of een verkocht item om als eerste te horen over nieuwe aanwinsten." },
  },
  confirmTitle: "Bevestig uw melding",
  confirmIntro: "Druk op de knop om e-mails te ontvangen over nieuwe passende items.",
  confirmButton: "Ja, houd mij op de hoogte",
  confirming: "Bevestigen…",
  missingToken: "Deze link is onvolledig. Gebruik de knop in de e-mail.",
  unsubscribeTitle: "Melding stoppen",
  unsubscribeSearch: (name: string) => `De melding “${name}” stoppen?`,
  unsubscribeSearchGone: "Deze melding bestaat niet meer.",
  thisItem: "dit item",
  unsubscribeWishlist: (title: string) => `“${title}” van uw verlanglijst verwijderen en de e-mails hierover stoppen?`,
  unsubscribeButton: "E-mails stoppen",
  unsubscribing: "Stoppen…",
  manageTitle: "Uw meldingen",
  manageIntro: (email: string) => `Meldingen voor ${email}`,
  manageEmpty: "Er zijn geen actieve meldingen voor dit adres.",
  stop: "Stoppen",
  stopAll: "Alle meldingen stoppen",
  view: "Resultaten bekijken",
  backHome: "Terug naar de shop",
  frequency: { INSTANT: "Direct", DAILY: "Dagelijks", WEEKLY: "Wekelijks" },
};

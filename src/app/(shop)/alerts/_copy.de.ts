import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { alertPagesCopy } from "./_copy";

export const alertPagesCopyDe: CopyShape<typeof alertPagesCopy> = {
  statusTitle: "Benachrichtigungen",
  status: {
    confirmed: { title: "Ihre Benachrichtigung ist aktiv", body: "Wir schreiben Ihnen eine E-Mail, sobald ein passender Artikel eingestellt wird." },
    unsubscribed: { title: "Benachrichtigung beendet", body: "Sie erhalten diese E-Mails nicht mehr." },
    expired: { title: "Link abgelaufen", body: "Dieser Bestätigungslink ist abgelaufen. Bitte erstellen Sie die Benachrichtigung erneut." },
    invalid: { title: "Ungültiger Link", body: "Dieser Link ist ungültig oder wurde bereits verwendet. Bitte nutzen Sie den Link aus der neuesten E-Mail." },
    unknown: { title: "Benachrichtigungen", body: "Richten Sie über eine Suche oder einen verkauften Artikel eine Benachrichtigung ein, um als Erster von Neuzugängen zu erfahren." },
  },
  confirmTitle: "Benachrichtigung bestätigen",
  confirmIntro: "Klicken Sie auf die Schaltfläche, um E-Mails über neue passende Artikel zu erhalten.",
  confirmButton: "Ja, benachrichtigen",
  confirming: "Wird bestätigt…",
  missingToken: "Dieser Link ist unvollständig. Bitte nutzen Sie die Schaltfläche in der E-Mail.",
  unsubscribeTitle: "Benachrichtigung beenden",
  unsubscribeSearch: (name: string) => `Die Benachrichtigung „${name}“ beenden?`,
  unsubscribeSearchGone: "Diese Benachrichtigung existiert nicht mehr.",
  thisItem: "diesen Artikel",
  unsubscribeWishlist: (title: string) => `„${title}“ von Ihrer Merkliste entfernen und keine E-Mails mehr dazu erhalten?`,
  unsubscribeButton: "E-Mails beenden",
  unsubscribing: "Wird beendet…",
  manageTitle: "Ihre Benachrichtigungen",
  manageIntro: (email: string) => `Benachrichtigungen für ${email}`,
  manageEmpty: "Für diese Adresse gibt es keine aktiven Benachrichtigungen.",
  stop: "Beenden",
  stopAll: "Alle Benachrichtigungen beenden",
  view: "Treffer ansehen",
  backHome: "Zurück zum Shop",
  frequency: { INSTANT: "Sofort", DAILY: "Täglich", WEEKLY: "Wöchentlich" },
};

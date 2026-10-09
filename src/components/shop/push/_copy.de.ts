import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { pushUiCopy } from "./_copy";

export const pushUiCopyDe: CopyShape<typeof pushUiCopy> = {
  choice: {
    title: "Suche gespeichert",
    question: (name: string) => `„${name}“ — wie sollen wir Sie über neue Stücke informieren?`,
    pushLabel: "Push-Benachrichtigung auf diesem Telefon",
    pushHint: "Innerhalb einer Minute nach dem Einstellen. Unikate sind schnell weg.",
    emailLabel: "E-Mail",
    emailHint: {
      INSTANT: "Sofort, eine E-Mail pro neuem Artikel.",
      DAILY: "Einmal täglich, alle neuen Treffer zusammen.",
      WEEKLY: "Einmal pro Woche (montags), alle neuen Treffer zusammen.",
    },
    turnOn: "Push-Benachrichtigungen aktivieren",
    keepEmail: "Bei E-Mail bleiben",
    working: "Wird aktiviert…",
    pushOn: "Push-Benachrichtigungen sind aktiv. Wir benachrichtigen dieses Gerät, sobald ein neues Stück passt.",
    emailKept: "Wir informieren Sie per E-Mail über neue Stücke.",
  },
  ios: {
    title: "Legen Sie den Shop zuerst auf Ihren Home-Bildschirm",
    intro: "Auf dem iPhone funktionieren Push-Benachrichtigungen nur über die App auf dem Home-Bildschirm:",
    steps: [
      "Tippen Sie in Safari auf die Teilen-Taste.",
      "Wählen Sie „Zum Home-Bildschirm“.",
      "Öffnen Sie den Shop über Ihren Home-Bildschirm, melden Sie sich an und aktivieren Sie Push unter Kundenkonto › Benachrichtigungen.",
    ],
    hint: "iPhone: Legen Sie den Shop zuerst auf Ihren Home-Bildschirm (Teilen › Zum Home-Bildschirm). Wir zeigen Ihnen, wie.",
  },
  denied: "Benachrichtigungen sind für diese Website blockiert. Erlauben Sie sie in Ihren Browsereinstellungen und versuchen Sie es erneut.",
  unsupported: "Dieser Browser kann keine Push-Benachrichtigungen empfangen. Wir informieren Sie weiterhin per E-Mail.",
  error: "Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.",
  loginAgain: "Bitte melden Sie sich erneut an.",
  close: "Schließen",
  settings: {
    title: "Push-Benachrichtigungen",
    intro: "Push funktioniert auf Android, in Desktop-Browsern und auf dem iPhone (über die App auf dem Home-Bildschirm). Kein App Store nötig.",
    thisDeviceOn: "Push ist auf diesem Gerät aktiv.",
    thisDeviceOff: "Push ist auf diesem Gerät deaktiviert.",
    otherDevices: (n: number) =>
      n === 1 ? "1 Gerät empfängt Push-Benachrichtigungen." : `${n.toLocaleString("de-DE")} Geräte empfangen Push-Benachrichtigungen.`,
    turnOn: "Push auf diesem Gerät aktivieren",
    turnOff: "Push auf diesem Gerät deaktivieren",
    wishlist: "Preissenkungen auf Ihrer Merkliste",
    reservation: "Reservierung läuft ab (etwa 3 Minuten bevor die Reservierung im Warenkorb endet)",
    quiet: "Ruhezeiten",
    quietOff: "Keine",
    quietHint: "Benachrichtigungen warten bis zum Morgen. Reservierungswarnungen entfallen.",
    max: "Höchstens",
    maxOption: (n: number) => (n === 1 ? "1 Push-Benachrichtigung pro Tag" : `${n.toLocaleString("de-DE")} Push-Benachrichtigungen pro Tag`),
    saved: "Gespeichert.",
  },
  delivery: {
    label: "Zustellung",
    push: "Push-Benachrichtigung (sofort)",
  },
};

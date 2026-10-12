import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { auctionErrorCopy } from "./_copy";

export const auctionErrorCopyDe: CopyShape<typeof auctionErrorCopy> = {
  LOT_CLOSED: "Die Gebotsabgabe für dieses Los ist beendet.",
  NOT_OPEN_YET: "Die Gebotsabgabe hat noch nicht begonnen.",
  BELOW_MINIMUM: (minimum: string) => `Ihr Höchstgebot muss mindestens ${minimum} betragen.`,
  BLOCKED: "Sie können an den Auktionen dieses Shops nicht teilnehmen. Bitte kontaktieren Sie uns, falls Sie das für einen Fehler halten.",
  TERMS_REQUIRED: "Bitte akzeptieren Sie vor Ihrem ersten Gebot die Auktionsbedingungen.",
  AGE_RESTRICTED: (age: number) => `Bitte bestätigen Sie, dass Sie mindestens ${age} Jahre alt sind.`,
  COUNTRY_RESTRICTED: "Dieses Los kann nicht in Ihr Land verkauft werden (lokale Vorschriften).",
  STAFF_CANNOT_BID: "Mitarbeiter dieses Shops können nicht an den eigenen Auktionen teilnehmen.",
  NOT_VERIFIED: "Bitte bestätigen Sie vor dem Bieten Ihre E-Mail-Adresse. Wir haben Ihnen einen Link geschickt.",
  RATE_LIMITED: "Sie bieten sehr schnell. Bitte warten Sie einen Moment.",
  generic: "Ihr Gebot konnte nicht abgegeben werden. Bitte versuchen Sie es erneut.",
};

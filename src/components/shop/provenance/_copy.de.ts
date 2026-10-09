import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { provenanceShopCopy } from "./_copy";

export const provenanceShopCopyDe: CopyShape<typeof provenanceShopCopy> = {
  block: {
    title: "Provenienz",
    documents: "Dokumente",
    certificateIncluded: "Echtheitszertifikat inklusive",
    certificateIncludedBody: "Zu diesem Artikel gehört ein nummeriertes Echtheitszertifikat, das jeder online prüfen kann.",
    guaranteed: "Lebenslange Echtheitsgarantie",
    verifyLink: "Zertifikat prüfen",
    kinds: {
      PROVENANCE: "Provenienz",
      DEACTIVATION_CERT: "Deaktivierungsbescheinigung",
      INVOICE_HISTORIC: "Historische Rechnung",
      OTHER: "Dokument",
    },
  },
  verify: {
    title: "Zertifikat prüfen",
    intro: "Geben Sie den Code ein, der auf dem Echtheitszertifikat steht (zum Beispiel QM-7K4P-2XQ9), oder scannen Sie den QR-Code.",
    label: "Zertifikatscode",
    placeholder: "QM-XXXX-XXXX",
    submit: "Prüfen",
    invalidCode: "Das sieht nicht nach einem Zertifikatscode aus. Codes sehen so aus: QM-7K4P-2XQ9.",
    checkAnother: "Weiteres Zertifikat prüfen",
    valid: {
      title: "Gültiges Zertifikat",
      body: (shop: string) => `Dieses Zertifikat wurde von ${shop} ausgestellt und ist gültig.`,
    },
    revoked: {
      title: "Zertifikat widerrufen",
      body: (shop: string) => `Dieses Zertifikat wurde von ${shop} ausgestellt, inzwischen aber widerrufen. Es ist nicht mehr gültig.`,
    },
    unknown: {
      title: "Zertifikat nicht gefunden",
      body: "In diesem Shop wurde kein Zertifikat mit diesem Code gefunden. Prüfen Sie den Code auf Tippfehler; die Buchstaben O und I werden als 0 und 1 gelesen.",
    },
    rateLimited: {
      title: "Zu viele Abfragen",
      body: "Sie haben in kurzer Zeit sehr viele Codes geprüft. Bitte warten Sie einige Minuten und versuchen Sie es erneut.",
    },
    code: "Zertifikat-Nr.",
    item: "Artikel",
    stockCode: "Bestandsnummer",
    issuedOn: "Ausgestellt am",
    revokedOn: "Widerrufen am",
    issuedBy: "Ausgestellt von",
    guaranteed: "Abgedeckt durch eine lebenslange Echtheitsgarantie",
    photoAlt: (title: string) => `Foto von ${title} zum Zeitpunkt der Zertifizierung`,
  },
};

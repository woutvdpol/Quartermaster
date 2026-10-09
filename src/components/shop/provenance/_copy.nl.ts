import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { provenanceShopCopy } from "./_copy";

export const provenanceShopCopyNl: CopyShape<typeof provenanceShopCopy> = {
  block: {
    title: "Herkomst",
    documents: "Documenten",
    certificateIncluded: "Inclusief certificaat van echtheid",
    certificateIncludedBody: "Bij dit item hoort een genummerd certificaat van echtheid dat iedereen online kan controleren.",
    guaranteed: "Levenslange echtheidsgarantie",
    verifyLink: "Een certificaat controleren",
    kinds: {
      PROVENANCE: "Herkomst",
      DEACTIVATION_CERT: "Deactiveringscertificaat",
      INVOICE_HISTORIC: "Historische factuur",
      OTHER: "Document",
    },
  },
  verify: {
    title: "Een certificaat controleren",
    intro: "Voer de code in die op het certificaat van echtheid staat (bijvoorbeeld QM-7K4P-2XQ9), of scan de QR-code.",
    label: "Certificaatcode",
    placeholder: "QM-XXXX-XXXX",
    submit: "Controleren",
    invalidCode: "Dat lijkt geen certificaatcode. Codes zien eruit als QM-7K4P-2XQ9.",
    checkAnother: "Nog een certificaat controleren",
    valid: {
      title: "Geldig certificaat",
      body: (shop: string) => `Dit certificaat is uitgegeven door ${shop} en is geldig.`,
    },
    revoked: {
      title: "Certificaat ingetrokken",
      body: (shop: string) => `Dit certificaat is uitgegeven door ${shop}, maar is inmiddels ingetrokken. Het is niet langer geldig.`,
    },
    unknown: {
      title: "Certificaat niet gevonden",
      body: "We konden in deze winkel geen certificaat met deze code vinden. Controleer de code op typefouten; de letters O en I worden gelezen als 0 en 1.",
    },
    rateLimited: {
      title: "Te veel controles",
      body: "U hebt in korte tijd veel codes gecontroleerd. Wacht een paar minuten en probeer het opnieuw.",
    },
    code: "Certificaatnr.",
    item: "Item",
    stockCode: "Voorraadnummer",
    issuedOn: "Uitgegeven op",
    revokedOn: "Ingetrokken op",
    issuedBy: "Uitgegeven door",
    guaranteed: "Gedekt door een levenslange echtheidsgarantie",
    photoAlt: (title: string) => `Foto van ${title} op het moment van certificering`,
  },
};

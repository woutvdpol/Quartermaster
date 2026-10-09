import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { provenanceCopy } from "./copy";

export const provenanceCopyNl: CopyShape<typeof provenanceCopy> = {
  certificateTitle: "Certificaat van echtheid",
  guaranteeTitle: "Levenslange echtheidsgarantie",
  guaranteeText:
    "Wij garanderen dat dit item een authentiek origineel is zoals beschreven. Mocht een erkende onafhankelijke expert ooit het tegendeel aantonen, dan nemen wij het terug en betalen wij de volledige aankoopprijs terug — zolang u het in bezit hebt.",
  certificateStatement: (shopName: string) =>
    `${shopName} verklaart dat het op dit certificaat beschreven item is onderzocht en naar ons beste weten en vakkundig oordeel een authentiek origineel uit de betreffende periode is, zoals beschreven.`,
  verifyHint: "Scan de code of ga naar het onderstaande adres om dit certificaat online te controleren.",
  signatureLine: "Handtekening",
  issuedOn: "Uitgegeven op",
  certificateNo: "Certificaatnr.",
  stockCode: "Voorraadnummer",
  revokedBanner: "INGETROKKEN — dit certificaat is niet langer geldig",
};

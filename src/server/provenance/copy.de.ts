import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { provenanceCopy } from "./copy";

export const provenanceCopyDe: CopyShape<typeof provenanceCopy> = {
  certificateTitle: "Echtheitszertifikat",
  guaranteeTitle: "Lebenslange Echtheitsgarantie",
  guaranteeText:
    "Wir garantieren, dass dieser Artikel ein authentisches Original wie beschrieben ist. Sollte ein anerkannter unabhängiger Sachverständiger jemals das Gegenteil nachweisen, nehmen wir ihn zurück und erstatten den vollen Kaufpreis — solange er sich in Ihrem Besitz befindet.",
  certificateStatement: (shopName: string) =>
    `${shopName} bestätigt, dass der auf diesem Zertifikat beschriebene Artikel geprüft wurde und nach bestem Wissen und Sachverstand ein authentisches zeitgenössisches Original wie beschrieben ist.`,
  verifyHint: "Scannen Sie den Code oder besuchen Sie die unten stehende Adresse, um dieses Zertifikat online zu prüfen.",
  signatureLine: "Unterschrift",
  issuedOn: "Ausgestellt am",
  certificateNo: "Zertifikat-Nr.",
  stockCode: "Bestandsnummer",
  revokedBanner: "WIDERRUFEN — dieses Zertifikat ist nicht mehr gültig",
};

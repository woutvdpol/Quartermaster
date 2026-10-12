import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { auctionTermsCopy } from "./_copy.terms";

export const auctionTermsCopyDe: CopyShape<typeof auctionTermsCopy> = {
  title: "Auktionsbedingungen",
  metaDescription: (shop: string) => `Die Regeln für das Bieten in den Online-Auktionen von ${shop}.`,
  placeholder: "Vorläufiger Text. Der Shop hat noch keine eigenen Auktionsbedingungen veröffentlicht; dies sind die allgemeinen Regeln des Auktionssystems. Der Shop muss diesen Text durch eigene, rechtlich geprüfte Bedingungen ersetzen.",
  sections: [
    { title: "Gebote sind verbindlich", body: "Jedes Gebot ist ein verbindliches Angebot, das Los zu dem Betrag zu kaufen, den Sie am Ende zahlen. Ein Gebot kann nicht zurückgezogen werden." },
    { title: "Automatisches Bieten", body: "Sie geben den Höchstbetrag ein, den Sie zahlen möchten. Wir bieten Schritt für Schritt für Sie, nur so weit wie nötig, damit Sie führen, bis zu Ihrem Höchstgebot. Haben zwei Bieter dasselbe Höchstgebot, führt, wer zuerst geboten hat." },
    { title: "Bietschritte", body: "Gebote steigen in festen Schritten, die vom aktuellen Gebot abhängen. Das nächste Mindestgebot steht immer beim Gebotsfeld." },
    { title: "Mindestpreis", body: "Ein Los kann einen verdeckten Mindestpreis haben. Darunter wird das Los nicht verkauft. Auf der Losseite sehen Sie, ob der Mindestpreis erreicht ist." },
    { title: "Ende und Verlängerung", body: "Jedes Los hat ein eigenes Ende. Ein Gebot in den letzten Minuten vor dem Ende verlängert nur dieses Los, damit jeder Bieter reagieren kann." },
    { title: "Kein Aufgeld", body: "Sie zahlen den Zuschlagspreis zuzüglich Versand." },
    { title: "Bezahlung", body: "Wer den Zuschlag erhält, bekommt eine E-Mail mit einem persönlichen Zahlungslink und zahlt innerhalb der dort genannten Frist." },
    { title: "Widerrufsrecht", body: "Eine Online-Auktion ist ein Fernabsatzgeschäft. Als Verbraucher behalten Sie nach Erhalt des Stücks das gesetzliche Widerrufsrecht von 14 Tagen." },
    { title: "Gebotsverlauf", body: "Der Gebotsverlauf jedes Loses ist öffentlich. Bieter werden pro Auktion mit einer Nummer angezeigt, nie mit Namen." },
    { title: "Wer bieten darf", body: "Zum Bieten benötigen Sie ein Kundenkonto mit bestätigter E-Mail-Adresse. Mitarbeiter können nicht bieten. Altersgrenzen und Länderbeschränkungen des Shops gelten auch für Gebote." },
  ],
};

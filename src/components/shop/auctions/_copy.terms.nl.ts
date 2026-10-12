import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { auctionTermsCopy } from "./_copy.terms";

export const auctionTermsCopyNl: CopyShape<typeof auctionTermsCopy> = {
  title: "Veilingvoorwaarden",
  metaDescription: (shop: string) => `De regels voor bieden in de online veilingen van ${shop}.`,
  placeholder: "Voorlopige tekst. De winkel heeft nog geen eigen veilingvoorwaarden gepubliceerd; dit zijn de algemene spelregels van het veilingsysteem. De winkel moet deze tekst vervangen door eigen, juridisch gecontroleerde voorwaarden.",
  sections: [
    { title: "Biedingen zijn bindend", body: "Elk bod is een bindend aanbod om de kavel te kopen voor het bedrag dat u uiteindelijk betaalt. Een bod kan niet worden ingetrokken." },
    { title: "Automatisch bieden", body: "U vult het maximum in dat u wilt betalen. Wij bieden stap voor stap voor u, alleen zo ver als nodig om u de leiding te geven, tot uw maximum. Hebben twee bieders hetzelfde maximum, dan leidt wie het eerst bood." },
    { title: "Biedstappen", body: "Biedingen gaan omhoog in vaste stappen die afhangen van het huidige bod. Het volgende minimumbod staat altijd bij het biedvak." },
    { title: "Minimumprijs", body: "Een kavel kan een verborgen minimumprijs hebben. Daaronder wordt de kavel niet verkocht. Op de kavelpagina ziet u of de minimumprijs is gehaald." },
    { title: "Sluiten en verlengen", body: "Elke kavel heeft een eigen sluitingstijd. Een bod in de laatste minuten voor sluiting verlengt alleen die kavel, zodat elke bieder kan reageren." },
    { title: "Geen opgeld", body: "U betaalt de hamerprijs, plus verzending." },
    { title: "Betalen", body: "De winnende bieder krijgt een e-mail met een persoonlijke betaallink en betaalt binnen de termijn die in die e-mail staat." },
    { title: "Herroepingsrecht", body: "Een online veiling is verkoop op afstand. Als consument houdt u na ontvangst van het stuk het wettelijke herroepingsrecht van 14 dagen." },
    { title: "Biedgeschiedenis", body: "De biedgeschiedenis van elke kavel is openbaar. Bieders worden per veiling met een nummer getoond, nooit met naam." },
    { title: "Wie mag bieden", body: "Voor bieden heeft u een klantaccount met een bevestigd e-mailadres nodig. Medewerkers kunnen niet bieden. Leeftijdsgrenzen en landbeperkingen van de winkel gelden ook voor bieden." },
  ],
};

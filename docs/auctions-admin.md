# Veilingen — admin

De admin voor veilingen staat onder **Verkoop › Auctions** (`/admin/auctions`). Spelregels en techniek: `docs/auctions-plan.md`. Ontwerp: `docs/design/auctions/AdminAuction.dc.html` en `AdminResults.dc.html`.

## Een veiling opzetten
1. **New auction** opent een zijpaneel. Kies het type:
   - **Auction day:** een catalogus van kavels die één voor één sluiten.
   - **Single lot:** één stuk met een eigen eindtijd. Je kiest het stuk direct in het paneel; de veiling en de kavel worden in één keer aangemaakt.
2. Vul de titel en de tijden in. Alle tijden zijn in de tijdzone van de shop.

   | Veld | Betekenis |
   |---|---|
   | Bidding opens | Vanaf dit moment kan er geboden worden. |
   | First lot closes | Kavel 1 sluit dan; kavel 2 sluit "gap" later, enzovoort. Bij een losse kavel: de eindtijd. |
   | Gap between lots | Tijd tussen de sluitingen (standaard 1 minuut). |
   | Late-bid extension | Een bod in de laatste minuten verlengt alleen die kavel met deze tijd (standaard 2 minuten). |
   | Pay within | Aantal dagen dat de winnaar heeft om te betalen (standaard 5). |

3. **+ Add lots from inventory** zoekt in de voorraad. Alleen actieve stukken met voorraad kunnen erin. Een stuk dat niet kan, staat grijs met de reden erbij: niet te koop, geen voorraad, op een lopende beurs, in het winkelmandje van een klant, al in een andere veiling of al een kavel in deze veiling.
4. Per kavel kun je de **startprijs** (standaard 60% van de lijstprijs) en de verborgen **minimumprijs** (standaard inkoopprijs + 10%, leeg = geen minimum) aanpassen, tot het eerste bod. De volgorde verander je met slepen of met ↑/↓, tot de veiling live is. Met × haal je een kavel weg; het stuk gaat terug naar de webshop.
5. **Publish** vraagt eerst om bevestiging en zegt wat er gebeurt: de kavels verdwijnen uit de gewone webshop en staan als veilingkavel online; bieden begint op de openingstijd. Tot die tijd kun je de tijden en de kavels nog aanpassen (**Edit schedule**).
6. **Cancel auction** stopt alles: open kavels worden geannuleerd en de stukken gaan terug naar de webshop.

De kaart **Settings** toont ook de biedstappen (de standaardstaffel van de shop, nu alleen te bekijken) en een link naar de veilingvoorwaarden.

## Tijdens de veiling
- De pagina ververst vanzelf via de live-verbinding van de veiling (dezelfde als in de shop). Bij elke kavelupdate haalt de admin de stand opnieuw op, hoogstens één keer per seconde. Valt de verbinding weg, dan ververst de pagina elke 5 seconden ("Updating every few seconds").
- In de kavellijst zie je per kavel het huidige bod (groen = minimum gehaald, oranje = nog niet), het aantal biedingen, de sluittijd (met "+ext" na een verlenging) en wie er leidt: biedernummer, naam en zijn maximum. Dat maximum is alleen voor medewerkers.
- De kaart **Live** telt biedingen, bieders, het huidige totaal en het aantal kavels boven het minimum.
- **Check this** verschijnt als bieders verdacht bieden, bijvoorbeeld vanaf hetzelfde apparaat of netwerk op dezelfde kavels.
  - **Review bids** toont hun biedingen op die kavels. **Void bid** schrapt een bod; de reden is verplicht en wordt gelogd, en de stand van de kavel wordt opnieuw berekend.
  - **Block both** blokkeert de bieders voor alle veilingen van de shop.
- Geblokkeerde bieders staan onder **Blocked bidders** (`/admin/auctions/bidders`), met **Unblock**. Op de klantpagina staat de kaart **Auctions**: blokkeren of deblokkeren en de kavels waarop de klant bood (gewonnen, betaald).
- In de producteditor staat een melding als het stuk een kavel is in een komende of lopende veiling, met een link naar de veiling. Pas dan de start- en minimumprijs aan op de veiling, niet de lijstprijs.

## Na afloop
**Results** (`/admin/auctions/<id>/results`, ook te openen terwijl de veiling loopt) toont:
- **Kerncijfers:** verkocht x/y, hamertotaal, verschil met de lijstprijzen, betaald x/y en hoeveel stukken terug in de shop zijn.
- **Filters:** All, Awaiting payment (inclusief te laat), Overdue (langer dan de betaaltermijn) en Not sold (inclusief geannuleerd).
- **Per kavel:** resultaat, hamerprijs, winnaar (link naar de klant), betaalstatus (link naar de order) en acties:
  - **Send reminder** stuurt de winnaar opnieuw zijn betaallink. De automatische herinnering na 3 dagen blijft gewoon lopen.
  - **Cancel** of **Cancel and block bidder** annuleert de verkoop: de order vervalt, de betaallink werkt niet meer en het stuk gaat terug naar de webshop. Met het vinkje wordt de bieder ook geblokkeerd.
- **Export CSV** downloadt de resultaten (met namen en e-mailadressen van de winnaars). Elke export komt in het auditlog.

Het aanbod aan de op één na hoogste bieder komt in fase 2.

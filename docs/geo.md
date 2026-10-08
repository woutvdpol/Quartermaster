# Land van de bezoeker (geo)

Waar het land van de bezoeker voor gebruikt wordt:

- **Verzendhint op de productpagina:** "Shipping to Netherlands from €6.95".
- **Standaardland in winkelwagen en checkout:** alleen als de bezoeker nog geen land koos en de shop naar dat land verzendt.
- **Geo-compliance:** regels per land, zoals verbergen of blurren in DE/AT.

## Volgorde

1. **Land-header van de edge**, als die er is:
   - `cf-ipcountry` (Cloudflare);
   - `x-vercel-ip-country` (Vercel);
   - `x-country` (eigen nginx/GeoIP).
2. **Client-IP in de lokale IP-landdatabase** (`src/server/geo/ip-country.ts`).
   - Het IP komt uit de vertrouwde proxyketen. Zonder `TRUSTED_PROXY_HOPS` (standaard 0) is er geen IP en wordt deze stap overgeslagen.
3. **Alleen voor de verzendhint:** de regio uit `Accept-Language`, en anders het land van de shop.
4. **Winkelwagen en checkout:** het land dat de bezoeker eerder koos, gaat altijd vóór de herkenning.

Compliance zonder herkend land past **geen** georegels toe, net als voorheen. Het verzendland bij het afrekenen blijft altijd het adres dat de klant invult; de herkenning is alleen een standaardwaarde.

## Database

- **Pakket:** `@ip-location-db/geo-whois-asn-country-mmdb`, een mmdb-bestand van 7,8 MB.
- **Licentie:** CC0. Het pakket bevat ook NRO-statistieken onder CC BY 4.0. We gebruiken de data alleen op de server en verspreiden hem niet.
- **Lezen:** met `mmdb-lib`, in het geheugen. Een lookup duurt microseconden.
- **Privacy:** het IP-adres verlaat de server niet; er is geen externe dienst.
- **Nauwkeurigheid:** goed op landniveau bij gewone internetproviders. Bij een VPN of mobiel roamen telt het land van het uitgangspunt.
- **Updates:** komen mee met het npm-pakket (Dependabot/Renovate).
- **Productie-image:** `next.config.ts` → `outputFileTracingIncludes` neemt het bestand mee in de standalone build.

## Instellingen

| Env | Effect |
|---|---|
| `GEOIP=off` | Geen IP-lookup (alleen headers / Accept-Language). |
| `GEOIP_DB=/pad/naar/bestand.mmdb` | Een ander country-mmdb gebruiken, bijv. MaxMind GeoLite2-Country of DB-IP. |
| `TRUSTED_PROXY_HOPS` | Moet kloppen met het aantal proxies (zie `docs/deploy.md` §9). Anders is er geen client-IP. |

Lokaal (`npm run dev` / `npm run prod:local`) staat `TRUSTED_PROXY_HOPS` op 0. Je ziet dan de terugval op `Accept-Language`. Testen kan met:
```bash
TRUSTED_PROXY_HOPS=1 npm run dev
```
```bash
curl -H "Host: concept.localhost:3000" -H "X-Forwarded-For: 8.8.8.8" http://localhost:3000/product/50172
```

import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { auctionErrorCopy } from "./_copy";

export const auctionErrorCopyNl: CopyShape<typeof auctionErrorCopy> = {
  LOT_CLOSED: "Het bieden op deze kavel is gesloten.",
  NOT_OPEN_YET: "Het bieden is nog niet geopend.",
  BELOW_MINIMUM: (minimum: string) => `Uw maximumbod moet minstens ${minimum} zijn.`,
  BLOCKED: "U kunt niet bieden op de veilingen van deze winkel. Neem contact met ons op als u denkt dat dit niet klopt.",
  TERMS_REQUIRED: "Accepteer eerst de veilingvoorwaarden voordat u voor het eerst biedt.",
  AGE_RESTRICTED: (age: number) => `Bevestig dat u minstens ${age} jaar oud bent.`,
  COUNTRY_RESTRICTED: "Deze kavel kan niet aan uw land worden verkocht (lokale regelgeving).",
  STAFF_CANNOT_BID: "Medewerkers van deze winkel kunnen niet op de eigen veilingen bieden.",
  NOT_VERIFIED: "Bevestig eerst uw e-mailadres voordat u biedt. We hebben u een link gestuurd.",
  RATE_LIMITED: "U biedt erg snel. Wacht even.",
  generic: "Uw bod kon niet worden geplaatst. Probeer het opnieuw.",
};

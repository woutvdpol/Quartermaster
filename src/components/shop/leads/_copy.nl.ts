import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { leadsCopy } from "./_copy";

export const leadsCopyNl: CopyShape<typeof leadsCopy> = {
  title: "Verkoop uw collectie",
  metaDescription: "Militaria verkopen? Beschrijf uw stukken, voeg een paar foto's toe en wij komen bij u terug met een bod.",
  eyebrow: "Wij kopen militaria",
  intro: (shop: string) =>
    `Heeft u één stuk of een complete collectie te koop? Vertel ${shop} wat u heeft, voeg een paar foto's toe en wij nemen contact met u op — geheel vrijblijvend.`,
  steps: [
    { title: "Beschrijf uw stukken", body: "Wat het is, waar het vandaan komt, de staat en eventuele papieren of herkomst." },
    { title: "Voeg foto's toe", body: "Voorkant, achterkant, markeringen en details. Met maximaal 10 foto's kunnen we snel een oordeel vormen." },
    { title: "Wij nemen contact op", body: "We bekijken uw aanvraag en doen u per e-mail of telefoon een voorstel." },
  ],
  fields: {
    name: "Uw naam",
    email: "E-mailadres",
    phone: "Telefoonnummer",
    phoneHint: "Optioneel — handig als u liever gebeld wordt.",
    itemsDescription: "Wat wilt u verkopen?",
    itemsDescriptionHint: "Soort, nationaliteit, periode, staat, markeringen, aantal stukken…",
    message: "Nog iets?",
    messageHint: "Optioneel — bijv. vraagprijs of wanneer u bereikbaar bent.",
    photos: "Foto's",
    photosHint: (max: number, mb: number) => `Maximaal ${max} foto's (JPEG, PNG of WebP, max. ${mb} MB per foto).`,
    addPhotos: "Foto's toevoegen",
    removePhoto: (n: number) => `Foto ${n} verwijderen`,
    uploading: "Bezig met uploaden…",
    photoCount: (n: number, max: number) => `${n} van ${max} foto's`,
    consent: (shop: string) =>
      `Ik ga ermee akkoord dat ${shop} mijn gegevens en foto's bewaart om mijn stukken te beoordelen en daarover contact met mij op te nemen.`,
    privacy: "Privacybeleid",
  },
  submit: "Aanvraag versturen",
  submitting: "Bezig met versturen…",
  waitForUploads: "Wacht tot alle foto's zijn geüpload.",
  done: {
    title: "Bedankt — we hebben uw aanvraag ontvangen",
    body: "We hebben een bevestiging naar uw e-mailadres gestuurd en nemen zo snel mogelijk contact met u op.",
    again: "Terug naar de shop",
  },
  errors: {
    invalid: "Controleer de gemarkeerde velden.",
    expired: "Dit formulier is verlopen. Herlaad de pagina en probeer het opnieuw (uw foto's moeten opnieuw worden toegevoegd).",
    captcha: "We konden niet vaststellen dat u een mens bent. Probeer het opnieuw.",
    rate_limited: "Te veel aanvragen. Probeer het later opnieuw.",
    photos: "Een van de foto's kon niet worden gevonden. Verwijder deze en upload hem opnieuw.",
    duplicate: "Deze aanvraag is al verstuurd. Herlaad de pagina om een nieuwe te versturen.",
    unexpected: "Er ging iets mis. Probeer het opnieuw.",
    tooMany: (max: number) => `U kunt maximaal ${max} foto's toevoegen.`,
    tooLarge: (name: string, mb: number) => `${name} is groter dan ${mb} MB.`,
    wrongType: (name: string) => `${name} is geen JPEG-, PNG- of WebP-afbeelding.`,
    uploadFailed: (name: string) => `${name} kon niet worden geüpload.`,
    thePhoto: "De foto",
  },
};

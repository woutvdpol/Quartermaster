import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { alertsCopy } from "./_copy";

export const alertsCopyNl: CopyShape<typeof alertsCopy> = {
  notify: {
    button: "Houd mij op de hoogte van vergelijkbare items",
    lead: "Ontvang een melding als er een vergelijkbaar item binnenkomt",
    dialogTitle: "Houd mij op de hoogte van vergelijkbare items",
    intro: "Dit stuk is weg, maar er komen regelmatig vergelijkbare stukken binnen. We mailen u zodra er een online staat.",
  },
  save: {
    button: "Zoekopdracht bewaren",
    dialogTitle: "Meldingen voor deze zoekopdracht",
    intro: "We mailen u wanneer nieuwe items aan deze zoekopdracht voldoen.",
  },
  form: {
    name: "Naam van de melding",
    nameHint: "Zodat u hem herkent in uw inbox.",
    email: "E-mailadres",
    frequency: "Hoe vaak",
    frequencies: {
      INSTANT: "Direct (bij elk nieuw item)",
      DAILY: "Dagelijks overzicht",
      WEEKLY: "Wekelijks overzicht (maandag)",
    },
    criteria: "Voorwaarden",
    submit: "Melding aanmaken",
    submitting: "Aanmaken…",
    cancel: "Annuleren",
    close: "Sluiten",
    privacy: "We gebruiken uw e-mailadres alleen voor deze meldingen. Elke e-mail bevat een link om u met één klik af te melden.",
  },
  result: {
    created: "Melding aangemaakt. U kunt hem beheren onder Account › Meldingen.",
    pending: "Bijna klaar — kijk in uw inbox en bevestig uw melding.",
    duplicate: "U heeft deze melding al.",
    limit: "U heeft het maximale aantal meldingen bereikt. Verwijder er eerst een.",
    rate_limited: "Te veel pogingen. Probeer het later opnieuw.",
    invalid: "Controleer het formulier.",
    captcha: "We konden niet vaststellen dat u een mens bent. Probeer het opnieuw.",
    error: "Er ging iets mis. Probeer het opnieuw.",
  },
  account: {
    intro: (max: number) =>
      `We mailen u wanneer nieuwe items overeenkomen. U kunt maximaal ${max.toLocaleString("nl-NL")} actieve meldingen hebben. Voor items op uw verlanglijst krijgt u automatisch een melding als ze weer beschikbaar komen of goedkoper worden.`,
    emptyTitle: "Nog geen meldingen",
    emptyBody: "Gebruik „Zoekopdracht bewaren” bij een zoekopdracht of „Houd mij op de hoogte” bij een verkocht item, dan mailen we u zodra er iets passends binnenkomt.",
    browse: "Bekijk de shop",
    lastAlert: "Laatste melding",
    lastEmail: "Laatste e-mail",
    paused: "Gepauzeerd",
    view: "Resultaten bekijken",
    emailFrequencies: {
      INSTANT: "E-mail: direct (bij elk nieuw item)",
      DAILY: "E-mail: dagelijks overzicht",
      WEEKLY: "E-mail: wekelijks overzicht (maandag)",
    },
    save: "Opslaan",
    pause: "Pauzeren",
    resume: "Hervatten",
    remove: "Verwijderen",
    removeConfirm: "Deze melding verwijderen?",
    saved: "Opgeslagen.",
    notFound: "Melding niet gevonden.",
    loginAgain: "Log opnieuw in.",
  },
  manageLink: "Meldingen beheren",
};

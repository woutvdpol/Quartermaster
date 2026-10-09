import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { leadsCopy } from "./_copy";

export const leadsCopyDe: CopyShape<typeof leadsCopy> = {
  title: "Verkaufen Sie Ihre Sammlung",
  metaDescription: "Militaria verkaufen? Beschreiben Sie Ihre Stücke, fügen Sie einige Fotos hinzu, und wir melden uns mit einem Angebot.",
  eyebrow: "Wir kaufen Militaria",
  intro: (shop: string) =>
    `Sie möchten ein einzelnes Stück oder eine ganze Sammlung verkaufen? Teilen Sie ${shop} mit, was Sie haben, fügen Sie einige Fotos hinzu, und wir melden uns bei Ihnen — unverbindlich.`,
  steps: [
    { title: "Stücke beschreiben", body: "Was es ist, woher es stammt, Zustand sowie eventuelle Dokumente oder Provenienz." },
    { title: "Fotos hinzufügen", body: "Vorderseite, Rückseite, Markierungen und Details. Bis zu 10 Fotos helfen uns bei einer schnellen Einschätzung." },
    { title: "Wir melden uns", body: "Wir prüfen Ihre Anfrage und unterbreiten Ihnen per E-Mail oder Telefon ein Angebot." },
  ],
  fields: {
    name: "Ihr Name",
    email: "E-Mail-Adresse",
    phone: "Telefonnummer",
    phoneHint: "Optional — praktisch, wenn Sie einen Anruf bevorzugen.",
    itemsDescription: "Was möchten Sie verkaufen?",
    itemsDescriptionHint: "Art, Herkunftsland, Zeitraum, Zustand, Markierungen, Anzahl der Stücke…",
    message: "Sonst noch etwas?",
    messageHint: "Optional — z. B. Preisvorstellung oder wann Sie erreichbar sind.",
    photos: "Fotos",
    photosHint: (max: number, mb: number) => `Bis zu ${max} Fotos (JPEG, PNG oder WebP, max. ${mb} MB pro Foto).`,
    addPhotos: "Fotos hinzufügen",
    removePhoto: (n: number) => `Foto ${n} entfernen`,
    uploading: "Wird hochgeladen…",
    photoCount: (n: number, max: number) => `${n} von ${max} Fotos`,
    consent: (shop: string) =>
      `Ich bin damit einverstanden, dass ${shop} meine Angaben und Fotos speichert, um meine Stücke zu bewerten und mich dazu zu kontaktieren.`,
    privacy: "Datenschutzerklärung",
  },
  submit: "Anfrage senden",
  submitting: "Wird gesendet…",
  waitForUploads: "Bitte warten Sie, bis alle Fotos hochgeladen sind.",
  done: {
    title: "Vielen Dank — wir haben Ihre Anfrage erhalten",
    body: "Wir haben Ihnen eine Bestätigung per E-Mail gesendet und melden uns so bald wie möglich.",
    again: "Zurück zum Shop",
  },
  errors: {
    invalid: "Bitte prüfen Sie die markierten Felder.",
    expired: "Dieses Formular ist abgelaufen. Bitte laden Sie die Seite neu und versuchen Sie es erneut (die Fotos müssen erneut hinzugefügt werden).",
    captcha: "Wir konnten nicht bestätigen, dass Sie ein Mensch sind. Bitte versuchen Sie es erneut.",
    rate_limited: "Zu viele Anfragen. Bitte versuchen Sie es später erneut.",
    photos: "Eines der Fotos wurde nicht gefunden. Bitte entfernen Sie es und laden Sie es erneut hoch.",
    duplicate: "Diese Anfrage wurde bereits gesendet. Laden Sie die Seite neu, um eine weitere zu senden.",
    unexpected: "Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.",
    tooMany: (max: number) => `Sie können höchstens ${max} Fotos hinzufügen.`,
    tooLarge: (name: string, mb: number) => `${name} ist größer als ${mb} MB.`,
    wrongType: (name: string) => `${name} ist kein JPEG-, PNG- oder WebP-Bild.`,
    uploadFailed: (name: string) => `${name} konnte nicht hochgeladen werden.`,
    thePhoto: "Das Foto",
  },
};

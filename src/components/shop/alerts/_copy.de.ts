import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { alertsCopy } from "./_copy";

export const alertsCopyDe: CopyShape<typeof alertsCopy> = {
  notify: {
    button: "Bei ähnlichen Artikeln benachrichtigen",
    lead: "Lassen Sie sich benachrichtigen, wenn ein ähnlicher Artikel eintrifft",
    dialogTitle: "Bei ähnlichen Artikeln benachrichtigen",
    intro: "Dieses Stück ist weg, aber ähnliche kommen regelmäßig herein. Wir schreiben Ihnen eine E-Mail, sobald eines eingestellt wird.",
  },
  save: {
    button: "Suche speichern",
    dialogTitle: "Benachrichtigungen für diese Suche",
    intro: "Wir schreiben Ihnen eine E-Mail, wenn neue Artikel zu dieser Suche passen.",
  },
  form: {
    name: "Name der Benachrichtigung",
    nameHint: "Damit Sie sie in Ihrem Postfach wiedererkennen.",
    email: "E-Mail-Adresse",
    frequency: "Wie oft",
    frequencies: {
      INSTANT: "Sofort (bei jedem neuen Artikel)",
      DAILY: "Tägliche Zusammenfassung",
      WEEKLY: "Wöchentliche Zusammenfassung (montags)",
    },
    criteria: "Kriterien",
    submit: "Benachrichtigung erstellen",
    submitting: "Wird erstellt…",
    cancel: "Abbrechen",
    close: "Schließen",
    privacy: "Wir verwenden Ihre E-Mail-Adresse nur für diese Benachrichtigungen. Jede E-Mail enthält einen Link zum Abmelden mit einem Klick.",
  },
  result: {
    created: "Benachrichtigung erstellt. Sie können sie unter Kundenkonto › Benachrichtigungen verwalten.",
    pending: "Fast geschafft — bitte prüfen Sie Ihr Postfach und bestätigen Sie Ihre Benachrichtigung.",
    duplicate: "Diese Benachrichtigung haben Sie bereits.",
    limit: "Sie haben die maximale Anzahl an Benachrichtigungen erreicht. Bitte entfernen Sie zuerst eine.",
    rate_limited: "Zu viele Versuche. Bitte versuchen Sie es später erneut.",
    invalid: "Bitte prüfen Sie das Formular.",
    captcha: "Wir konnten nicht bestätigen, dass Sie ein Mensch sind. Bitte versuchen Sie es erneut.",
    error: "Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.",
  },
  account: {
    intro: (max: number) =>
      `Wir schreiben Ihnen eine E-Mail, wenn neue Artikel passen. Sie können bis zu ${max.toLocaleString("de-DE")} aktive Benachrichtigungen haben. Für Artikel auf Ihrer Merkliste werden Sie automatisch benachrichtigt, wenn sie wieder verfügbar oder günstiger werden.`,
    emptyTitle: "Noch keine Benachrichtigungen",
    emptyBody: "Nutzen Sie „Suche speichern“ bei einer Suche oder „Benachrichtigen“ bei einem verkauften Artikel, und wir schreiben Ihnen eine E-Mail, sobald etwas Passendes eintrifft.",
    browse: "Zum Shop",
    lastAlert: "Letzte Benachrichtigung",
    lastEmail: "Letzte E-Mail",
    paused: "Pausiert",
    view: "Treffer ansehen",
    emailFrequencies: {
      INSTANT: "E-Mail: sofort (bei jedem neuen Artikel)",
      DAILY: "E-Mail: tägliche Zusammenfassung",
      WEEKLY: "E-Mail: wöchentliche Zusammenfassung (montags)",
    },
    save: "Speichern",
    pause: "Pausieren",
    resume: "Fortsetzen",
    remove: "Löschen",
    removeConfirm: "Diese Benachrichtigung löschen?",
    saved: "Gespeichert.",
    notFound: "Benachrichtigung nicht gefunden.",
    loginAgain: "Bitte melden Sie sich erneut an.",
  },
  manageLink: "Benachrichtigungen verwalten",
};

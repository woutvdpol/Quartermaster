import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { verifyCopy } from "./_copy";

export const verifyCopyDe: CopyShape<typeof verifyCopy> = {
  title: "E-Mail-Adresse bestätigen",
  intro: "Ein Klick, um die E-Mail-Adresse Ihres Kundenkontos zu bestätigen.",
  confirm: "E-Mail-Adresse bestätigen",
  confirming: "Wird bestätigt…",
  done: (email: string) => `Vielen Dank — ${email} ist bestätigt.`,
  invalid: "Dieser Link ist ungültig oder abgelaufen. Fordern Sie unten oder in Ihrem Kundenkonto einen neuen an.",
  missing: "Öffnen Sie den Link aus der Bestätigungs-E-Mail, um Ihre Adresse zu bestätigen.",
  resend: "Neue Bestätigungs-E-Mail senden",
  resending: "Wird gesendet…",
  resent: "Wir haben eine neue Bestätigungs-E-Mail gesendet. Bitte prüfen Sie Ihr Postfach (und den Spam-Ordner).",
  alreadyVerified: "Ihre E-Mail-Adresse ist bereits bestätigt.",
  rateLimited: "Sie haben bereits mehrere E-Mails angefordert. Bitte versuchen Sie es später erneut.",
  loginToResend: "Melden Sie sich an, um eine neue Bestätigungs-E-Mail anzufordern.",
  login: "Anmelden",
  account: "Zu Ihrem Kundenkonto",
  unexpected: "Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.",
};

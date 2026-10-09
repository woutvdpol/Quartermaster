import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { verifyCopy } from "./_copy";

export const verifyCopyNl: CopyShape<typeof verifyCopy> = {
  title: "Bevestig uw e-mailadres",
  intro: "Eén klik om het e-mailadres van uw account te bevestigen.",
  confirm: "E-mailadres bevestigen",
  confirming: "Bevestigen…",
  done: (email: string) => `Bedankt — ${email} is bevestigd.`,
  invalid: "Deze link is ongeldig of verlopen. Vraag hieronder of via uw account een nieuwe aan.",
  missing: "Open de link uit de bevestigingsmail om uw adres te bevestigen.",
  resend: "Nieuwe bevestigingsmail versturen",
  resending: "Versturen…",
  resent: "We hebben een nieuwe bevestigingsmail gestuurd. Kijk in uw inbox (en uw spammap).",
  alreadyVerified: "Uw e-mailadres is al bevestigd.",
  rateLimited: "U heeft al meerdere e-mails aangevraagd. Probeer het later opnieuw.",
  loginToResend: "Log in om een nieuwe bevestigingsmail aan te vragen.",
  login: "Inloggen",
  account: "Naar uw account",
  unexpected: "Er ging iets mis. Probeer het opnieuw.",
};

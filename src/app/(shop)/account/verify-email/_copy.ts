/* Copy for /account/verify-email. Dutch and German: _copy.nl.ts / _copy.de.ts (bundle `verifyCopies`). */
import { localized } from "@/lib/i18n/shop-copy";
import { verifyCopyNl } from "./_copy.nl";
import { verifyCopyDe } from "./_copy.de";

export const verifyCopy = {
  title: "Confirm your email",
  intro: "One click to confirm the email address of your account.",
  confirm: "Confirm email address",
  confirming: "Confirming…",
  done: (email: string) => `Thanks — ${email} is confirmed.`,
  invalid: "This link is invalid or has expired. Request a new one below or from your account.",
  missing: "Open the link from the confirmation email to confirm your address.",
  resend: "Send a new confirmation email",
  resending: "Sending…",
  resent: "We sent a new confirmation email. Check your inbox (and spam folder).",
  alreadyVerified: "Your email address is already confirmed.",
  rateLimited: "You requested several emails already. Please try again later.",
  loginToResend: "Log in to request a new confirmation email.",
  login: "Log in",
  account: "Go to your account",
  unexpected: "Something went wrong. Please try again.",
};

export const verifyCopies = localized({ en: verifyCopy, nl: verifyCopyNl, de: verifyCopyDe });

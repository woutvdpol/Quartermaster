// Storefront copy for web push alerts (docs/push.md). English; Dutch and German in _copy.nl.ts / _copy.de.ts (bundle `pushUiCopies`).
import { localized } from "@/lib/i18n/shop-copy";
import { pushUiCopyNl } from "./_copy.nl";
import { pushUiCopyDe } from "./_copy.de";

export const pushUiCopy = {
  choice: {
    title: "Search saved",
    question: (name: string) => `“${name}” — how should we tell you about new pieces?`,
    pushLabel: "Push alert on this phone",
    pushHint: "Within a minute of listing. Unique pieces go fast.",
    emailLabel: "E-mail",
    emailHint: {
      INSTANT: "Right away, one e-mail per new item.",
      DAILY: "Once a day, all new matches together.",
      WEEKLY: "Once a week (Mondays), all new matches together.",
    },
    turnOn: "Turn on push alerts",
    keepEmail: "Keep e-mail",
    working: "Turning on…",
    pushOn: "Push alerts are on. We'll notify this device when a new piece matches.",
    emailKept: "We'll e-mail you about new pieces.",
  },
  ios: {
    title: "Add the shop to your home screen first",
    intro: "On iPhone, push alerts only work from the home-screen app:",
    steps: ["Tap the Share button in Safari.", "Choose “Add to Home Screen”.", "Open the shop from your home screen, log in and turn on push under Account › Alerts."],
    hint: "iPhone: first add the shop to your home screen (Share › Add to Home Screen). We show you how.",
  },
  denied: "Notifications are blocked for this site. Allow them in your browser settings and try again.",
  unsupported: "This browser can't receive push alerts. We'll keep e-mailing you.",
  error: "Something went wrong. Please try again.",
  loginAgain: "Please log in again.",
  close: "Close",
  settings: {
    title: "Push alerts",
    intro: "Push works on Android, desktop browsers and iPhone (from the home-screen app). No app store needed.",
    thisDeviceOn: "Push is on for this device.",
    thisDeviceOff: "Push is off on this device.",
    otherDevices: (n: number) => (n === 1 ? "1 device receives push alerts." : `${n} devices receive push alerts.`),
    turnOn: "Turn on push on this device",
    turnOff: "Turn off push on this device",
    wishlist: "Wishlist price drops",
    reservation: "Reservation ending (about 3 minutes before your cart hold lapses)",
    quiet: "Quiet hours",
    quietOff: "None",
    quietHint: "Alerts wait until the morning. Reservation warnings are skipped.",
    max: "At most",
    maxOption: (n: number) => (n === 1 ? "1 push alert per day" : `${n} push alerts per day`),
    saved: "Saved.",
  },
  delivery: {
    label: "Deliver",
    push: "Push alert (right away)",
  },
} as const;

export const pushUiCopies = localized({ en: pushUiCopy, nl: pushUiCopyNl, de: pushUiCopyDe });

/* Copy for the /alerts pages. Dutch and German: _copy.nl.ts / _copy.de.ts (bundle `alertPagesCopies`). */
import { localized } from "@/lib/i18n/shop-copy";
import { alertPagesCopyNl } from "./_copy.nl";
import { alertPagesCopyDe } from "./_copy.de";

export const alertPagesCopy = {
  statusTitle: "Alerts",
  status: {
    confirmed: { title: "Your alert is active", body: "We'll email you when a matching item is listed." },
    unsubscribed: { title: "Alert stopped", body: "You won't receive these emails anymore." },
    expired: { title: "Link expired", body: "This confirmation link has expired. Please create the alert again." },
    invalid: { title: "Invalid link", body: "This link is invalid or was already used. Please use the link from the most recent email." },
    unknown: { title: "Alerts", body: "Set up an alert from any search or sold item to hear about new arrivals first." },
  },
  confirmTitle: "Confirm your alert",
  confirmIntro: "Press the button to start receiving emails about new matching items.",
  confirmButton: "Yes, notify me",
  confirming: "Confirming…",
  missingToken: "This link is incomplete. Please use the button in the email.",
  unsubscribeTitle: "Stop alert",
  unsubscribeSearch: (name: string) => `Stop the alert “${name}”?`,
  unsubscribeSearchGone: "This alert no longer exists.",
  thisItem: "this item",
  unsubscribeWishlist: (title: string) => `Remove “${title}” from your wishlist and stop emails about it?`,
  unsubscribeButton: "Stop emails",
  unsubscribing: "Stopping…",
  manageTitle: "Your alerts",
  manageIntro: (email: string) => `Alerts for ${email}`,
  manageEmpty: "There are no active alerts for this address.",
  stop: "Stop",
  stopAll: "Stop all alerts",
  view: "View matches",
  backHome: "Back to the shop",
  frequency: { INSTANT: "Right away", DAILY: "Daily", WEEKLY: "Weekly" },
} as const;

export const alertPagesCopies = localized({ en: alertPagesCopy, nl: alertPagesCopyNl, de: alertPagesCopyDe });

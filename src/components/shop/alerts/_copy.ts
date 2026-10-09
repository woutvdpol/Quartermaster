// Storefront copy for alerts ("notify me"). English; Dutch and German in _copy.nl.ts / _copy.de.ts (bundle `alertsCopies`).
import { localized } from "@/lib/i18n/shop-copy";
import { alertsCopyNl } from "./_copy.nl";
import { alertsCopyDe } from "./_copy.de";

export const alertsCopy = {
  notify: {
    button: "Notify me about similar items",
    lead: "Get notified when a similar item arrives",
    dialogTitle: "Notify me about similar items",
    intro: "This piece is gone, but similar ones come in regularly. We'll email you when one is listed.",
  },
  save: {
    button: "Save search",
    dialogTitle: "Get alerts for this search",
    intro: "We'll email you when new items match this search.",
  },
  form: {
    name: "Alert name",
    nameHint: "So you recognise it in your inbox.",
    email: "Email address",
    frequency: "How often",
    frequencies: {
      INSTANT: "Right away (each new item)",
      DAILY: "Daily summary",
      WEEKLY: "Weekly summary (Mondays)",
    },
    criteria: "Matches",
    submit: "Create alert",
    submitting: "Creating…",
    cancel: "Cancel",
    close: "Close",
    privacy: "We only use your email for these alerts. Every email has a one-click unsubscribe link.",
  },
  result: {
    created: "Alert created. You can manage it under Account › Alerts.",
    pending: "Almost done — check your inbox and confirm your alert.",
    duplicate: "You already have this alert.",
    limit: "You have reached the maximum number of alerts. Remove one first.",
    rate_limited: "Too many attempts. Please try again later.",
    invalid: "Please check the form.",
    captcha: "We could not verify that you are human. Please try again.",
    error: "Something went wrong. Please try again.",
  },
  /** Account › Alerts page. */
  account: {
    intro: (max: number) =>
      `We email you when new items match. You can have up to ${max} active alerts. Wishlist items notify you automatically when they become available again or get cheaper.`,
    emptyTitle: "No alerts yet",
    emptyBody: "Use “Save search” on any search, or “Notify me” on a sold item, and we'll email you when something matching arrives.",
    browse: "Browse the shop",
    lastAlert: "Last alert",
    lastEmail: "Last email",
    paused: "Paused",
    view: "View matches",
    emailFrequencies: {
      INSTANT: "E-mail: right away (each new item)",
      DAILY: "E-mail: daily summary",
      WEEKLY: "E-mail: weekly summary (Mondays)",
    },
    save: "Save",
    pause: "Pause",
    resume: "Resume",
    remove: "Delete",
    removeConfirm: "Delete this alert?",
    saved: "Saved.",
    notFound: "Alert not found.",
    loginAgain: "Please log in again.",
  },
  manageLink: "Manage alerts",
} as const;

export const alertsCopies = localized({ en: alertsCopy, nl: alertsCopyNl, de: alertsCopyDe });

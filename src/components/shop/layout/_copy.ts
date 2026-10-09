import { localized } from "@/lib/i18n/shop-copy";
import { layoutCopyDe } from "./_copy.de";
import { layoutCopyNl } from "./_copy.nl";

/** English copy for the shop chrome (header, footer, age gate, newsletter; Dutch/German: ./_copy.nl.ts, ./_copy.de.ts). */
export const layoutCopy = {
  skipToContent: "Skip to content",
  header: {
    homeLabel: "home",
    mainNav: "Main",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    menu: "Menu",
    search: "Search",
    searchPlaceholder: "Search the shop…",
    searchLabel: "Search products",
    account: "Account",
    wishlist: "Wishlist",
    cart: "Cart",
    cartCount: (n: number) => (n === 1 ? "1 item in cart" : `${n} items in cart`),
    wishlistCount: (n: number) => (n === 1 ? "1 saved item" : `${n} saved items`),
    shop: "Shop",
  },
  miniCart: {
    label: "Cart preview",
    title: (n: number) => (n === 1 ? "1 item in your cart" : `${n} items in your cart`),
    reserved: (min: number) => (min <= 1 ? "Reserved for <1 min" : `Reserved for ${min} min`),
    empty: "Your cart is empty",
    emptyHint: "Every piece is unique — add it before someone else does.",
    browse: "Browse the shop",
    taken: "Reserved by someone else",
    unavailable: "No longer available",
    more: (n: number) => `+ ${n} more in your cart`,
    subtotal: "Subtotal",
    viewCart: "View cart",
    checkout: "Checkout",
  },
  footer: {
    navLabel: "Footer",
    newsletterTitle: "Newsletter",
    newsletterText: "New arrivals and stories from the collection, straight to your inbox.",
    contact: "Contact",
    poweredBy: "Powered by",
    soldArchive: "Sold archive",
    legal: "Legal",
    rights: "All rights reserved.",
  },
  newsletter: {
    emailLabel: "Email address",
    placeholder: "you@example.com",
    submit: "Subscribe",
    submitting: "Subscribing…",
    success: "Thanks! Check your inbox to confirm your subscription.",
    invalid: "Enter a valid email address.",
    unavailable: "Signing up is not possible right now. Please try again later.",
    tooMany: "Too many attempts. Please try again later.",
    captcha: "We could not verify that you are human. Please try again.",
    honeypot: "Leave this field empty",
  },
  openingSoon: {
    eyebrow: "Opening soon",
    body: "We are preparing our shop. Please come back soon.",
    notify: "Leave your email and we let you know when we open.",
    questions: "Questions?",
  },
  ageGate: {
    title: (age: number) => `Are you ${age} or older?`,
    body: (shop: string, age: number) =>
      `${shop} sells items that are only intended for adults. Please confirm that you are at least ${age} years old to continue.`,
    confirm: (age: number) => `Yes, I am ${age} or older`,
    leave: "No, leave",
    denied: (age: number) => `Sorry, you must be ${age} or older to visit this shop.`,
  },
} as const;

export const layoutCopies = localized({ en: layoutCopy, nl: layoutCopyNl, de: layoutCopyDe });

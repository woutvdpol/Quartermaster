import { localized } from "@/lib/i18n/shop-copy";
import { leadsCopyDe } from "./_copy.de";
import { leadsCopyNl } from "./_copy.nl";

/** English copy for "Sell your collection" (Dutch/German: ./_copy.nl.ts, ./_copy.de.ts). */
export const leadsCopy = {
  title: "Sell your collection",
  metaDescription: "Selling militaria? Describe your items, add a few photos and we will get back to you with an offer.",
  eyebrow: "We buy militaria",
  intro: (shop: string) =>
    `Have a single piece or a whole collection to sell? Tell ${shop} what you have, add a few photos, and we will get back to you — no obligation.`,
  steps: [
    { title: "Describe your items", body: "What it is, where it came from, condition, any papers or provenance." },
    { title: "Add photos", body: "Front, back, markings and details. Up to 10 photos help us judge quickly." },
    { title: "We get in touch", body: "We review your request and contact you by email or phone with a proposal." },
  ],
  fields: {
    name: "Your name",
    email: "Email address",
    phone: "Phone number",
    phoneHint: "Optional — handy if you prefer a call.",
    itemsDescription: "What would you like to sell?",
    itemsDescriptionHint: "Type, nationality, period, condition, markings, how many items…",
    message: "Anything else?",
    messageHint: "Optional — e.g. asking price or when you are available.",
    photos: "Photos",
    photosHint: (max: number, mb: number) => `Up to ${max} photos (JPEG, PNG or WebP, max ${mb} MB each).`,
    addPhotos: "Add photos",
    removePhoto: (n: number) => `Remove photo ${n}`,
    uploading: "Uploading…",
    photoCount: (n: number, max: number) => `${n} of ${max} photos`,
    consent: (shop: string) =>
      `I agree that ${shop} stores my details and photos to assess my items and to contact me about them.`,
    privacy: "Privacy policy",
  },
  submit: "Send request",
  submitting: "Sending…",
  waitForUploads: "Please wait until all photos have finished uploading.",
  done: {
    title: "Thank you — we received your request",
    body: "We sent a confirmation to your email address and will get back to you as soon as possible.",
    again: "Back to the shop",
  },
  errors: {
    invalid: "Please check the highlighted fields.",
    expired: "This form has expired. Please reload the page and try again (your photos need to be added again).",
    captcha: "We could not verify that you are human. Please try again.",
    rate_limited: "Too many requests. Please try again later.",
    photos: "One of the photos could not be found. Please remove it and upload it again.",
    duplicate: "This request was already sent. Reload the page to send another one.",
    unexpected: "Something went wrong. Please try again.",
    tooMany: (max: number) => `You can add at most ${max} photos.`,
    tooLarge: (name: string, mb: number) => `${name} is larger than ${mb} MB.`,
    wrongType: (name: string) => `${name} is not a JPEG, PNG or WebP image.`,
    uploadFailed: (name: string) => `${name} could not be uploaded.`,
    thePhoto: "The photo",
  },
} as const;

export const leadsCopies = localized({ en: leadsCopy, nl: leadsCopyNl, de: leadsCopyDe });

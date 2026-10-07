// Routes of the offer flow (keep in sync with src/app/(shop)/offer/** and src/app/admin/(app)/offers/**).

export const OFFER_PATHS = {
  /** Personal checkout link (agreed price). */
  checkout: (token: string) => `/offer/${encodeURIComponent(token)}`,
  /** Counter offer: accept / decline (POST buttons). */
  counter: (token: string) => `/offer/counter/${encodeURIComponent(token)}`,
  /** Admin inbox with the detail drawer open. */
  admin: (offerId: string) => `/admin/offers?offer=${encodeURIComponent(offerId)}`,
} as const;

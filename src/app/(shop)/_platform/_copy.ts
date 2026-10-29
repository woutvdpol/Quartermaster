export const platformCopy = {
  name: "Quartermaster",
  title: "The webshop platform for militaria dealers",
  body: "Unique items, honest descriptions and a checkout that never sells the same piece twice. Shops run on their own domain; this is the platform address.",
  adminLink: "Sign in to the admin",
  /** Call to action per sign-up mode (docs/signup-modes.md). */
  applyLink: {
    APPLY: () => "Open your shop — apply",
    WAITLIST: () => "Join the waitlist",
    TRIAL: (days: number) => `Start your free ${days}-day trial`,
  },
  metaDescription: "Quartermaster — webshop platform for militaria dealers.",
} as const;

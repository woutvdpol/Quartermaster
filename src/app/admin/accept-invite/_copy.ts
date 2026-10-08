/** Copy for the owner invite acceptance screen (approved dealer → first password → setup wizard). */
export const copy = {
  title: "Welcome to Quartermaster",
  subtitle: "Choose a password to open your shop's admin.",
  email: "Your sign-in email",
  password: "Password",
  confirm: "Repeat password",
  hint: (min: number) => `At least ${min} characters. A long passphrase is easiest to remember.`,
  submit: "Set password and start setup",
  submitting: "Signing you in…",
  errors: {
    missing: "Enter a password and repeat it.",
    tooShort: (min: number) => `Use at least ${min} characters.`,
    mismatch: "The two passwords don’t match.",
    rate_limited: "Too many attempts. Please wait a while and try again.",
    unexpected: "Something went wrong. Please try again.",
  },
  invalidTitle: "This invite link is no longer valid",
  invalidBody:
    "Invite links work once and expire after 24 hours. Already chose a password? Sign in. Otherwise reply to the invite email and we send you a new link.",
  toLogin: "Go to sign in",
} as const;

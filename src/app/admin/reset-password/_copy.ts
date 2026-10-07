/** Copy for the public "set your password" screen (password reset and owner invites). */
export const copy = {
  title: "Set your password",
  subtitle: "Choose a new password for your admin account.",
  password: "New password",
  confirm: "Repeat new password",
  hint: (min: number) =>
    `At least ${min} characters. A long passphrase is easiest to remember.`,
  submit: "Set password",
  submitting: "Saving…",
  errors: {
    missing: "Enter a new password and repeat it.",
    tooShort: (min: number) => `Use at least ${min} characters.`,
    mismatch: "The two passwords don’t match.",
    unexpected: "Something went wrong. Please try again.",
  },
  invalidTitle: "This link has expired or was already used",
  invalidBody:
    "Links to set a password work once and only for a limited time. Request a new link and use the most recent email.",
  requestNew: "Request a new link",
  doneTitle: "Your password has been set",
  doneBody:
    "For your security you were signed out everywhere. Sign in with your new password.",
  toLogin: "Go to sign in",
  backToLogin: "Back to sign in",
} as const;

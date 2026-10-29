const intro =
  "Every piece is listed once, held while a buyer pays, and gone everywhere the moment it sells. Mollie payments, shipping zones and rules per country are built in.";
const step1 = "Your name, your shop and what you sell.";
const wizardStep = { title: "Set up in the wizard", body: "Pick a theme, connect Mollie, set your shipping zones and import your products.", meta: "Live when you are ready" };

/** Texts that depend on the platform's sign-up mode (docs/signup-modes.md). */
const modes = {
  APPLY: {
    metaTitle: "Open your shop",
    title: "Open your shop. Built for unique items.",
    intro,
    steps: [
      { title: "Apply", body: step1, meta: "About 3 minutes" },
      { title: "We review", body: "Militaria is sensitive, so every dealer is checked by hand.", meta: "Usually a few working days" },
      wizardStep,
    ],
    formTitle: "Apply for a shop",
    submit: "Send application",
    footnote: "Protected by Turnstile. We email you once your application is reviewed.",
    verifyBody: "Confirm that this is your email address so we can review your application.",
    verifyButton: "Confirm my email",
    thanks: {
      title: "Thanks — check your inbox",
      body: [
        "We sent you an email with a link to confirm your address. Your application is reviewed once your email is confirmed.",
        "Every dealer is checked by hand, usually within a few working days. You hear from us by email either way.",
      ],
    },
  },
  WAITLIST: {
    metaTitle: "Join the waitlist",
    title: "Join the waitlist. Built for unique items.",
    intro,
    steps: [
      { title: "Tell us about your business", body: step1, meta: "About 3 minutes" },
      { title: "We invite you", body: "In the order dealers signed up, as soon as there is room.", meta: "We email you" },
      wizardStep,
    ],
    formTitle: "Join the waitlist",
    submit: "Join the waitlist",
    footnote: "Protected by Turnstile. We email you when it is your turn.",
    verifyBody: "Confirm that this is your email address to take your place on the waitlist.",
    verifyButton: "Confirm my email",
    thanks: {
      title: "Thanks — check your inbox",
      body: [
        "We sent you an email with a link to confirm your address. You are on the waitlist once your email is confirmed.",
        "We invite dealers in the order they signed up and email you as soon as there is room.",
      ],
    },
  },
  TRIAL: {
    metaTitle: "Start your free trial",
    title: (days: number) => `Try Quartermaster free for ${days} days.`,
    intro,
    steps: [
      { title: "Tell us about your shop", body: step1, meta: "About 3 minutes" },
      { title: "Confirm your email", body: "Your shop is created the moment you click the link in your inbox.", meta: "Choose a password" },
      { ...wizardStep, title: "Straight into the setup wizard" },
    ],
    formTitle: "Start your free trial",
    submit: "Start free trial",
    footnote: "Protected by Turnstile. No payment details needed.",
    verifyBody: "Confirm that this is your email address and your shop is created right away.",
    // Same words as the button in the confirmation mail (src/server/mail/builders-onboarding.tsx).
    verifyButton: "Confirm and create my shop",
    thanks: {
      title: "Almost there — check your inbox",
      body: [
        "We sent you an email with a link to confirm your address. Click it and your shop is created right away.",
        "You then choose a password and the setup wizard opens.",
      ],
    },
  },
} as const;

export const applyCopy = {
  modes,
  next: "What happens next",
  fields: {
    applicantName: "Your name",
    email: "Email",
    shopName: "Shop name",
    country: "Country",
    cocNumber: "Chamber of Commerce no. (optional)",
    cocHint: "Your company registration number (KvK, KBO, Handelsregister, …).",
    currentPlatform: "Where do you sell now?",
    description: "What do you sell?",
    descriptionHint: "Periods, countries, types of items — and roughly how many pieces.",
    legalConsent:
      "I only sell legal items and follow the rules of the countries I ship to (deactivated weapons with certificate).",
  },
  submitting: "Sending…",
  errors: {
    invalid: "Please check the highlighted fields.",
    rate_limited: "Too many applications from your connection. Please try again later.",
    captcha: "The bot check failed or expired. Please try again.",
    unexpected: "Something went wrong. Please try again.",
  },
  thanks: {
    metaTitle: "Check your inbox",
    noMail: "No email after a few minutes? Check your spam folder, or apply again with the same address to get a new link.",
    back: "Back to Quartermaster",
  },
  verify: {
    title: "Confirm your email",
    pending: "Confirming…",
    invalidTitle: "This link is not valid",
    invalidBody: "The link has expired or is not complete. Apply again with the same email address to get a new link.",
    /** Outcomes of verifyApplicationEmail: a title of their own, the body no longer repeats it. */
    verified: { title: "Email confirmed", body: "We review your application and email you the outcome." },
    waitlisted: { title: "You are on the waitlist", body: "Your email address is confirmed. We email you as soon as there is room." },
    already_verified: { title: "Email already confirmed", body: "We email you about the next step." },
    already_created: {
      title: "Your shop already exists",
      body: "Use the link in the email “Your shop … is ready” to choose your password, or sign in on your shop's address.",
    },
    rate_limited: "Too many attempts. Please try again later.",
    error: "Something went wrong. Please try again.",
    applyAgain: "Apply again",
  },
} as const;

const intro =
  "Every piece listed once, reserved while someone checks out, sold everywhere at the same moment. Certificates with QR code, per-country compliance rules and Mollie payments are built in.";
const wizardStep = { title: "Set up in a guided wizard", body: "theme, payments, shipping, and import from WooCommerce, Shopify or Concept500." };

/** Texts that depend on the platform's sign-up mode (docs/signup-modes.md). */
const modes = {
  APPLY: {
    metaTitle: "Open your shop",
    title: "Open your shop. Built for unique items.",
    intro,
    steps: [
      { n: "01", title: "Apply", body: "tell us about your business. Takes 3 minutes." },
      { n: "02", title: "We review", body: "usually within a few working days. Militaria is sensitive; every dealer is checked." },
      { n: "03", ...wizardStep },
    ],
    formTitle: "Apply for a shop",
    submit: "Send application",
    footnote: "Protected by Turnstile. We email you once your application is reviewed.",
    verifyBody: "Confirm that this is your email address so we can review your application.",
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
      { n: "01", title: "Tell us about your business", body: "takes 3 minutes." },
      { n: "02", title: "We invite you", body: "in the order dealers signed up, as soon as there is room." },
      { n: "03", ...wizardStep },
    ],
    formTitle: "Join the waitlist",
    submit: "Join the waitlist",
    footnote: "Protected by Turnstile. We email you when it is your turn.",
    verifyBody: "Confirm that this is your email address to take your place on the waitlist.",
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
      { n: "01", title: "Tell us about your shop", body: "takes 3 minutes." },
      { n: "02", title: "Confirm your email", body: "your shop is created the moment you click the link." },
      { n: "03", title: "Straight into the setup wizard", body: wizardStep.body },
    ],
    formTitle: "Start your free trial",
    submit: "Start free trial",
    footnote: "Protected by Turnstile. No payment details needed.",
    verifyBody: "Confirm that this is your email address and your shop is created right away.",
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
  eyebrow: "For militaria dealers",
  modes,
  fields: {
    applicantName: "Your name",
    email: "Email",
    shopName: "Shop name",
    country: "Country",
    cocNumber: "Chamber of Commerce no.",
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
    noMail: "No email after a few minutes? Check your spam folder, or apply again with the same address to get a new link.",
    back: "Back to Quartermaster",
  },
  verify: {
    title: "Confirm your email",
    button: "Confirm my email",
    pending: "Confirming…",
    invalidTitle: "This link is not valid",
    invalidBody: "The link has expired or is not complete. Apply again with the same email address to get a new link.",
    verified: "Thanks, your email address is confirmed. We review your application and email you the outcome.",
    waitlisted: "Thanks, your email address is confirmed and you are on the waitlist. We email you as soon as there is room.",
    already_verified: "Your email address was already confirmed. We email you about the next step.",
    already_created: "Your shop has already been created. Use the link in the email “Your shop … is ready” to choose your password, or sign in on your shop's address.",
    rate_limited: "Too many attempts. Please try again later.",
    error: "Something went wrong. Please try again.",
    applyAgain: "Apply again",
  },
} as const;

/*
 * Texts of the platform landing (PLATFORM_HOST "/", design: docs/design/platform-landing.html, DESIGN.md).
 * Everything that depends on the sign-up mode (docs/signup-modes.md) is keyed by mode; `days` is the
 * configured trial length. The product-UI mockups use the demo data under `demo` (marked as demo on the page).
 */

type Mode = "APPLY" | "WAITLIST" | "TRIAL";
type Step = { title: string; body: string; meta: string };

const wizardStep: Step = { title: "Set up in the wizard", body: "Pick a theme, connect Mollie, set your shipping zones and import your products.", meta: "Live when you are ready" };

export const platformCopy = {
  name: "Quartermaster",
  tagline: "The webshop platform for militaria dealers",
  metaDescription: "Quartermaster is the webshop platform for militaria dealers: every piece is listed once, held while a buyer pays and gone everywhere the moment it sells.",

  nav: { label: "Main", how: "How it works", features: "Features", pricing: "Pricing", network: "Network", login: "Dealer login", menu: "Menu" },

  /** Call to action per sign-up mode: `long` in the hero and closing, `short` in the nav and on the plans. */
  cta: {
    APPLY: { long: () => "Open your shop — apply", short: () => "Apply" },
    WAITLIST: { long: () => "Join the waitlist", short: () => "Join the waitlist" },
    TRIAL: { long: (days: number) => `Start your free ${days}-day trial`, short: () => "Start free trial" },
  } satisfies Record<Mode, { long: (days: number) => string; short: () => string }>,

  hero: {
    title: "The webshop for stock that exists only once.",
    body: "Quartermaster is the shop platform for militaria dealers: every piece is listed once, held while a buyer pays, and gone everywhere the moment it sells.",
    secondary: "See how it works",
    checks: {
      APPLY: ["Your own domain", "Import from WooCommerce or Shopify"],
      WAITLIST: ["Your own domain", "Import from WooCommerce or Shopify"],
      TRIAL: ["No payment details needed", "Your own domain", "Import from WooCommerce or Shopify"],
    } satisfies Record<Mode, string[]>,
    windowLabel: "The Quartermaster admin showing stock number 50212, a wool greatcoat, for sale in the webshop and the network and ready to sell at a fair.",
  },

  facts: ["Payments through Mollie: iDEAL, Bancontact, cards, PayPal", "Shipping zones per country", "Blur and sign-in for sensitive pieces"],

  how: {
    title: "One piece. One stock line. No double sales.",
    body: "General shop software counts stock in quantities. Quartermaster treats every piece as the only one, because it is. Try it: start a checkout on the piece below.",
  },

  /** The checkout demo: one stock line, three places it shows up, three states. */
  checkout: {
    channels: { shop: "Webshop", network: "Quartermaster network", fair: "Fair table" },
    states: {
      available: {
        chip: "Available",
        title: "Listed once",
        body: "Every piece has one stock number and one stock line. Your webshop, the network and the fair all read from it.",
        shop: ["For sale", "Anyone can add it to their basket"],
        network: ["Listed", "Shows up in searches across all dealers"],
        fair: ["Ready to sell", "Scan the QR label to sell it on the spot"],
        log: "Available everywhere.",
        action: "Simulate a checkout",
      },
      reserved: {
        chip: "Reserved",
        title: "Held while the buyer pays",
        body: "The piece is held, 15 minutes by default. It drops out of the network, and the fair app refuses the sale while the order is open.",
        shop: ["Reserved", "A buyer is paying. Nobody else can add it."],
        network: ["Hidden", "Out of the network while it is reserved"],
        fair: ["Blocked", "In a webshop order awaiting payment"],
        log: "",
        action: "Confirm the payment",
      },
      sold: {
        chip: "Sold",
        title: "Sold everywhere at once",
        body: "Mollie confirms the payment, even if the buyer closes the tab. The piece leaves every channel in the same moment and stays in your sold archive.",
        shop: ["Sold", "Moved to your sold archive"],
        network: ["Removed", "Gone from every search"],
        fair: ["Sold", "The fair app shows it as sold"],
        log: "Paid through Mollie. Sold everywhere at once.",
        action: "Reset the demo",
      },
    },
    /** `{clock}` is replaced by the hold clock (mm:ss). A string, so the copy can be passed to the client. */
    held: "Held for {clock} while the buyer pays.",
    expired: "Hold expired. Back on sale everywhere.",
  },

  features: {
    title: "Built for the militaria trade",
    body: "The parts a general shop builder leaves to plug-ins are in Quartermaster from day one.",
    fair: {
      title: "Sell at the fair from your phone",
      body: "Scan the QR label, take cash or card on your own terminal and keep selling when the hall has no signal. Fair pieces leave your webshop while the fair runs and come back if they do not sell.",
      points: ["QR labels on A4, label printers or hang tags", "A floor price per piece", "A closing report with takings, margin and cash count"],
      label: "Fair mode on a phone: piece 50214 at 240 euros, cash selected, offline with two sales waiting to sync.",
    },
    compliance: {
      title: "Rules per country, handled for you",
      body: "Sensitive pieces are blurred until a buyer signs in, and you decide what can be sold to which country. The checkout follows the rules, so you do not have to police every order.",
      points: ["Blur and sign-in for sensitive items", "Test any piece against any country", "Shipping zones and weight bands per country"],
      label: "A storefront grid where one sensitive piece is blurred with a sign-in prompt, and a note that a country rule applies.",
    },
    index: [
      {
        title: "Sell",
        items: [
          ["Auctions", "Live bidding with a reserve price and a payment link for the winner."],
          ["Make an offer", "Offers and counter-offers on any piece you choose."],
          ["Coupons", "Codes with your own redemption rules."],
        ],
      },
      {
        title: "Get found",
        items: [
          ["Smart search", "Understands typos and the terms collectors use, and searches by photo."],
          ["Translations", "Dutch and German drafts that go live after you approve them."],
          ["SEO and feeds", "Sitemaps, structured data and a Merchant feed."],
        ],
      },
      {
        title: "Keep buyers coming back",
        items: [
          ["Alerts and push", "Saved searches, price drops and back-in-stock alerts."],
          ["Newsletter", "Send campaigns from your own admin."],
          ["Sell your collection", "A page where collectors offer you their pieces."],
        ],
      },
      {
        title: "Know your stock",
        items: [
          ["Insights", "Stock value, time to sell and money tied up, per category."],
          ["Sitting too long", "Pieces that stopped selling, with a reason and a suggested price."],
          ["Duplicate check", "Spots a returning piece when you upload its photos."],
        ],
      },
    ] satisfies { title: string; items: [string, string][] }[],
    indexLabel: "Everything included",
  },

  switch: {
    title: "Bring your shop with you",
    body: {
      APPLY: "Apply in a few minutes. Once we have checked your shop, you set it up in the wizard.",
      WAITLIST: "Take your place on the list. When it is your turn, you set up your shop in the wizard.",
      TRIAL: "Start the trial and you are in the setup wizard minutes later. No sales call, no payment details.",
    } satisfies Record<Mode, string>,
    steps: {
      APPLY: [
        { title: "Apply", body: "Your name, your shop and what you sell.", meta: "About 3 minutes" },
        { title: "We review", body: "Militaria is sensitive, so every dealer is checked by hand.", meta: "Usually a few working days" },
        wizardStep,
      ],
      WAITLIST: [
        { title: "Join the waitlist", body: "Your name, your shop and what you sell.", meta: "About 3 minutes" },
        { title: "We invite you", body: "In the order dealers signed up, as soon as there is room.", meta: "We email you" },
        wizardStep,
      ],
      TRIAL: [
        { title: "Tell us about your shop", body: "Your name, your shop and what you sell.", meta: "About 3 minutes" },
        { title: "Confirm your email", body: "Your shop is created the moment you click the link in your inbox.", meta: "Choose a password" },
        wizardStep,
      ],
    } satisfies Record<Mode, Step[]>,
    imports: ["WooCommerce CSV", "Shopify CSV"],
    importsLabel: "Imports",
  },

  network: {
    title: "Found beyond your own shop",
    body: "Join the Quartermaster network and your stock appears in one search across every dealer who takes part. Buyers check out in your shop, on your domain.",
    points: ["Free to join, one switch in your settings", "Reserved and sold pieces drop out by themselves", "Leave whenever you like"],
    label: "Network search for greatcoat with three results from different dealers, the first from your shop.",
  },

  pricing: {
    title: "Simple packages",
    body: {
      APPLY: "One price per month for the whole shop. Add a single module to Start or Pro when you need it.",
      WAITLIST: "One price per month for the whole shop. Add a single module to Start or Pro when you need it.",
      TRIAL: (days: number) => `Every trial runs on Complete for ${days} days. Pick a package when you are ready to stay.`,
    },
    perMonth: "/ month",
    plans: {
      START: { for: "The full shop, for a focused stock.", includes: "Everything in the shop", core: ["One stock line per piece", "Mollie checkout and invoices", "Compliance per country", "Themes, CMS pages, SEO"] },
      PRO: { for: "For dealers who sell every week.", includes: "Everything in Start, plus", core: [] },
      COMPLETE: { for: "Every module, no limits.", includes: "Everything in Pro, plus", core: [] },
    },
    featured: { APPLY: "Everything included", WAITLIST: "Everything included", TRIAL: "Your trial runs on this" } satisfies Record<Mode, string>,
    limits: (products: number | null, photos: number) => `${products === null ? "Unlimited products" : `${products} products`} · ${photos} photos each`,
    notes: ["Prices per month, excluding VAT. Pay yearly and get 2 months free.", "Need one module on Start or Pro? Add it on its own."],
  },

  faq: {
    title: "Questions dealers ask",
    /** The first question depends on the sign-up mode. */
    first: {
      APPLY: ["How does the review work?", "Every dealer is checked by hand, usually within a few working days. You hear from us by email either way."],
      WAITLIST: ["How does the waitlist work?", "We invite dealers in the order they signed up and email you as soon as there is room."],
      TRIAL: ["What happens when the trial ends?", "Your storefront closes and visitors see a “temporarily closed” page. Your admin, products and orders stay exactly as they are. Pick a package with us and the shop opens again."],
    } satisfies Record<Mode, [string, string]>,
    items: [
      ["Can I use my own domain?", "Yes. Every shop runs on its own domain. The Quartermaster address is only for signing up and for the network."],
      ["Which payment methods can my buyers use?", "Payments run through Mollie: iDEAL, Bancontact, cards and PayPal. At the fair you register cash or card payments taken on your own terminal."],
      ["Can I move my current shop?", "The setup wizard imports your products from a WooCommerce or Shopify CSV export."],
      ["Is my shop available in other languages?", "Your storefront can run in English, Dutch and German. Translations are drafted on our own servers and only go live after you approve them."],
    ] satisfies [string, string][],
  },

  closing: {
    APPLY: { title: () => "Open your shop on Quartermaster.", body: "Apply in a few minutes. Every dealer is checked by hand." },
    WAITLIST: { title: () => "Take your place on the list.", body: "We invite dealers in the order they signed up." },
    TRIAL: { title: (days: number) => `Open your shop. The first ${days} days are on us.`, body: "Full Complete package, your own domain, no payment details." },
  } satisfies Record<Mode, { title: (days: number) => string; body: string }>,

  footer: { open: "Open a shop", network: "Network", login: "Dealer login", label: "Footer" },

  /** Demo data in the product-UI mockups (synthetic; the page marks it as demo). */
  demo: {
    tag: "Demo data",
    tagShort: "Demo",
    shop: "Your shop",
    domain: "yourshop.com",
    adminUrl: "yourshop.com/admin/products/50212",
    rail: ["Dashboard", "Products", "Orders", "Customers", "Auctions", "Fairs", "Compliance"],
    crumb: "Products / Outerwear",
    piece: { stock: "No. 50212", titleStart: "Wool greatcoat, ", titleEnd: "double-breasted", price: "€545", stockCount: "1 of 1", margin: "45%" },
    facts: { price: "Price", stock: "Stock", margin: "Margin" },
    where: ["Where it is", "One stock line"],
    heroChannels: [
      ["Webshop", "yourshop.com/product/50212", "For sale"],
      ["Quartermaster network", "Found in searches across all dealers", "Listed"],
      ["Spring fair, table 14", "QR label printed", "Ready to sell"],
    ] satisfies [string, string, string][],
    phone: { fair: "Spring fair", mode: "Fair mode", stock: "No. 50214", title: "Naval officer's cap", price: "€240", floor: "Floor €210", cash: "Cash", card: "Card", record: "Record sale", offline: "Offline · 2 sales waiting to sync" },
    store: {
      path: "yourshop.com / Uniforms",
      visitor: "Visitor from DE",
      cards: [
        { title: "Navy greatcoat", stock: "No. 50190", price: "€495" },
        { title: "Restricted item", stock: "No. 50201", price: "€380" },
      ],
      locked: "Sign in to view",
      rule: "A country rule applies to one piece in this list",
    },
    search: {
      query: "greatcoat",
      results: [
        { title: "Navy greatcoat, brass buttons", where: "A dealer in Antwerp", price: "€495" },
        { title: "Sailor's cap with tally ribbon", where: "A dealer in Utrecht", price: "€165" },
      ],
    },
  },
} as const;

/** English starter content for system pages (created as drafts by `ensureSystemPages`). Pure. */
import { defaultBlockData, type ParsedBlock } from "./blocks";
import type { SystemPageKey } from "./rules";

const text = (markdown: string, title = ""): ParsedBlock => ({ type: "TEXT", data: { title, markdown, cta: null } });

export const SYSTEM_PAGE_STARTER_BLOCKS: Record<SystemPageKey, ParsedBlock[]> = {
  HOME: [
    { type: "HERO", data: defaultBlockData("HERO") },
    { type: "NEW_ITEMS", data: defaultBlockData("NEW_ITEMS") },
    { type: "CATEGORIES", data: defaultBlockData("CATEGORIES") },
    text(
      "We specialise in original militaria. Every item is checked, described honestly and photographed in detail.\n\nHave a question about an item? [Contact us](/contact).",
      "About our shop",
    ),
  ],
  TERMS: [
    text(
      [
        "*Replace this text with your own terms and conditions before publishing this page.*",
        "## 1. General",
        "These terms apply to every offer and order placed in this shop.",
        "## 2. Prices and payment",
        "All prices are in euros and include VAT where applicable. Payment is due when the order is placed.",
        "## 3. Delivery",
        "Orders are shipped after payment has been received. Shipping costs are shown at checkout.",
        "## 4. Returns",
        "You may return an item within 14 days of receipt. Contact us before sending anything back.",
        "## 5. Authenticity",
        "Every item is described to the best of our knowledge. If an item turns out not to be as described, we will refund it.",
      ].join("\n\n"),
    ),
  ],
  PRIVACY: [
    text(
      [
        "*Replace this text with your own privacy policy before publishing this page.*",
        "## What we collect",
        "Your name, address, email address and order history: only what we need to process your orders.",
        "## Why",
        "To deliver your orders, to answer your questions and, if you subscribed, to send you our newsletter.",
        "## How long",
        "We keep order data as long as the law requires (usually seven years for tax purposes).",
        "## Your rights",
        "You can ask us to view, correct or delete your data at any time. Contact us to do so.",
      ].join("\n\n"),
    ),
  ],
  CONTACT: [
    text(
      [
        "We are happy to answer questions about items, orders and shipping.",
        "**Email:** [info@example.com](mailto:info@example.com)  \n**Phone:** +00 000 000 000",
        "*Replace these details with your own before publishing this page.*",
      ].join("\n\n"),
      "Get in touch",
    ),
  ],
  ABOUT: [
    { type: "TEXT_IMAGE", data: { ...defaultBlockData("TEXT_IMAGE"), title: "Our story", markdown: "Tell your visitors who you are, how you started collecting and what you specialise in." } },
    { type: "QUOTE", data: { quote: "Every item has a story. We make sure it is told correctly.", author: "" } },
  ],
};

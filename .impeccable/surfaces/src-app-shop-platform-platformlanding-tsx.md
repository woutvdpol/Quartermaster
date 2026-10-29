---
version: 1
slug: "src-app-shop-platform-platformlanding-tsx"
primary_target: "src/app/(shop)/_platform/PlatformLanding.tsx"
related_targets: ["docs/design/platform-landing.html"]
---

# Platform landing (PLATFORM_HOST `/`)

Mode: Persuade. Scope: landing first; apply, verify and thanks pages follow in the same system (PlatformShell).
Audience: militaria dealer (1–3 people) with an existing WooCommerce/Shopify shop. Action: start the free trial (CTA follows the sign-up mode; production is TRIAL, 30 days). Proof: the one-piece mechanism demonstrated, real modules, real package prices (Start €29, Pro €59, Complete €99). No testimonials, customer names, counts, Concept500 or demo-shop mentions.
Avoid: military costume, generic SaaS (gradients, icon tiles, "all-in-one" talk), loaded symbolism.
Quality bar: Shopify, Lightspeed/Shopware, Linear/Stripe, Squarespace.
Design file: docs/design/platform-landing.html. Built in src/app/(shop)/_platform/ (2026-10-29); the owner dropped the provenance/certificate feature row, so the build has two feature rows (fair, country rules) before the module index.

## Direction contract

THESIS: The category-standard commerce-platform landing (headline, product, proof, pricing, FAQ) at Stripe/Shopify craft, where the proof is the one thing generic shop software cannot show: a single piece reserved and sold in every channel at once. Refuses icon-tile feature walls, gradients and platform buzzwords.

OWN-WORLD: White and Depot-tinted off-white (#FAFAF6, #ECECE5) grounds, ink #1E2119, brass #7E5416 as the only action colour, one olive (#2F3526) band. Status colours (reserved #7A5000, sold #A2342A, ok #2F6B3A) live only inside product UI. Barlow 600 sentence-case headings, Hanken Grotesk body, IBM Plex Mono only for stock numbers in product UI. Product frames: 12px radius, hairline #D7D8CC, soft offset shadow. Drawn line icons, no tiles.

STORY: The dealer sees a shop platform made for militaria, watches piece 50212 reserved and sold in webshop, fair and auction at once, scans what is included and what it costs, and starts the free trial.

FIRST VIEWPORT: Nav (wordmark, How it works, Features, Pricing, Network, Dealer login, Start free trial). Centred two-line headline (max 6rem), one-sentence subline, primary "Start your free 30-day trial" plus "See how it works", a small "No payment details needed" line. From 55% height down, the admin product window for No. 50212 with its three channel rows, cropped by the fold.

FORM: Canon (the category standard, user-chosen standing exit). seed:d857c024a12c813c. Signature interaction: "Simulate a checkout" flips all three channel rows to Reserved with a running countdown, then to Sold together; one orchestrated state change, exponential ease-out.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

// Demo data for local development: catalog, purchasing, shipping, customers, orders, reservations,
// content, newsletter and page views for "concept-militaria" (full set) and "veldpost-antiek" (small set).
//
//   npm run db:seed            # base seed first (tenants, superadmin, owner, settings, system pages)
//   npm run db:seed:demo       # this script
//   npm run db:seed:demo -- --reset   # delete previously seeded demo rows, then seed again
//
// Rules:
//  - Refuses to run with NODE_ENV=production.
//  - Idempotent per tenant: a tenant with ≥ 10 products is skipped ("demo data already present").
//  - Writes go through the admin services wherever one exists (catalog, media, purchasing, shipping,
//    customers, order commands, Mollie status handling, reservations, content, settings, newsletter).
//    There is no checkout service yet, so Order/OrderLine/OrderAddress/Payment(open) rows are inserted
//    directly. Services stamp `now()`; afterwards the script back-dates timestamps (placedAt, paidAt,
//    events, stock movements, publishedAt, soldAt, …) so dashboards show a realistic 90/120-day history.
//  - Demo rows are marked so `--reset` can remove exactly them:
//      products/orders: legacyData.demo = true · customers/suppliers/purchase records: notes start "[demo]"
//      categories/tags/shipping zones/campaigns/subscribers: matched by the names/emails defined here
//      page views: visitorHash starts with "demo" · carts: found through demo products.
//    Reset leaves settings (newsletterEnabled), the published home page, audit logs and queued jobs.
//  - Order finalization queues confirmation mails in pg-boss (no worker needed); stopBoss() at the end.
import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import type { ServiceContext } from "../src/server/context";
import type { Prisma } from "../src/generated/prisma/client";
import type { ProductStatus } from "../src/generated/prisma/enums";
import type { Specification } from "../src/server/catalog/products";

// Service bug workaround: `audit()` (src/server/audit.ts) calls `headers().catch(...)`, but outside a
// request Next's `headers()` throws synchronously, so every audited service call fails in a script.
// Route `next/headers` to a stub whose functions reject (= "no request"), which audit() already handles.
// App modules are therefore loaded with dynamic import() after this hook is registered (see loadServices).
// (tsx compiles app modules to CommonJS and reads them from disk, so the stub is a real temp file.)
const NEXT_HEADERS_STUB = path.join(mkdtempSync(path.join(tmpdir(), "qm-seed-demo-")), "next-headers-stub.cjs");
writeFileSync(
  NEXT_HEADERS_STUB,
  'const none = () => Promise.reject(new Error("no request scope (seed-demo)"));\n' +
    "module.exports = { headers: none, cookies: none, draftMode: none };\n",
);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers" || specifier === "next/headers.js") return { url: pathToFileURL(NEXT_HEADERS_STUB).href, format: "commonjs", shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

let db!: typeof import("../src/server/db").db;
let createCategory!: typeof import("../src/server/catalog/categories").createCategory;
let createTag!: typeof import("../src/server/catalog/tags").createTag;
let createProduct!: typeof import("../src/server/catalog/products").createProduct;
let setStatus!: typeof import("../src/server/catalog/products").setStatus;
let addProductImages!: typeof import("../src/server/media/product-images").addProductImages;
let deleteProductMedia!: typeof import("../src/server/media/product-images").deleteProductMedia;
let allocatePurchaseRecordCost!: typeof import("../src/server/purchasing").allocatePurchaseRecordCost;
let createPurchaseRecord!: typeof import("../src/server/purchasing").createPurchaseRecord;
let createSupplier!: typeof import("../src/server/purchasing").createSupplier;
let setPurchasePrices!: typeof import("../src/server/purchasing").setPurchasePrices;
let createZone!: typeof import("../src/server/shipping/zones").createZone;
let quoteShipping!: typeof import("../src/server/shipping/quote").quoteShipping;
let findOrCreateGuestCustomer!: typeof import("../src/server/customers").findOrCreateGuestCustomer;
let addOrderNote!: typeof import("../src/server/orders/commands").addOrderNote;
let applyMolliePaymentStatus!: typeof import("../src/server/orders/commands").applyMolliePaymentStatus;
let archiveOrder!: typeof import("../src/server/orders/commands").archiveOrder;
let cancelOrder!: typeof import("../src/server/orders/commands").cancelOrder;
let markPaidManually!: typeof import("../src/server/orders/commands").markPaidManually;
let setFulfillmentStatus!: typeof import("../src/server/orders/commands").setFulfillmentStatus;
let nextSequenceValue!: typeof import("../src/server/sequence").nextSequenceValue;
let reserveProduct!: typeof import("../src/server/stock/reservations").reserveProduct;
let addBlock!: typeof import("../src/server/content/pages").addBlock;
let ensureSystemPages!: typeof import("../src/server/content/pages").ensureSystemPages;
let updateBlock!: typeof import("../src/server/content/pages").updateBlock;
let updatePage!: typeof import("../src/server/content/pages").updatePage;
let updateSettings!: typeof import("../src/server/settings").updateSettings;
let createCampaign!: typeof import("../src/server/newsletter/campaigns").createCampaign;
let stopBoss!: typeof import("../src/server/jobs/boss").stopBoss;

async function loadServices() {
  ({ db } = await import("../src/server/db"));
  ({ createCategory } = await import("../src/server/catalog/categories"));
  ({ createTag } = await import("../src/server/catalog/tags"));
  ({ createProduct, setStatus } = await import("../src/server/catalog/products"));
  ({ addProductImages, deleteProductMedia } = await import("../src/server/media/product-images"));
  ({ allocatePurchaseRecordCost, createPurchaseRecord, createSupplier, setPurchasePrices } = await import("../src/server/purchasing"));
  ({ createZone } = await import("../src/server/shipping/zones"));
  ({ quoteShipping } = await import("../src/server/shipping/quote"));
  ({ findOrCreateGuestCustomer } = await import("../src/server/customers"));
  ({ addOrderNote, applyMolliePaymentStatus, archiveOrder, cancelOrder, markPaidManually, setFulfillmentStatus } = await import(
    "../src/server/orders/commands"
  ));
  ({ nextSequenceValue } = await import("../src/server/sequence"));
  ({ reserveProduct } = await import("../src/server/stock/reservations"));
  ({ addBlock, ensureSystemPages, updateBlock, updatePage } = await import("../src/server/content/pages"));
  ({ updateSettings } = await import("../src/server/settings"));
  ({ createCampaign } = await import("../src/server/newsletter/campaigns"));
  ({ stopBoss } = await import("../src/server/jobs/boss"));
}

// ─── Utilities ──────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;
const NOW = Date.now();
const DEMO_MARK = "[demo]";

/** Deterministic PRNG (mulberry32) so repeated fresh seeds look the same. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rand = rng(1940);
const between = (min: number, max: number) => min + rand() * (max - min);
const int = (min: number, max: number) => Math.floor(between(min, max + 1));
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const chance = (p: number) => rand() < p;
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const at = (ms: number) => new Date(Math.min(ms, NOW - MIN));
const euro = (cents: number) => `€ ${(cents / 100).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hex = (n: number) => randomBytes(n).toString("hex");
const progress = (msg: string) => {
  if (process.stdout.isTTY) process.stdout.write(`\r${msg}`);
};

// ─── Data definitions ───────────────────────────────────────────────────────

type CatDef = { key: string; title: string; description?: string; children?: CatDef[] };
type Shape = "helmet" | "cap" | "tunic" | "coat" | "bag" | "canteen" | "optics" | "badge" | "buckle" | "patch" | "document" | "photo" | "blade";
type ItemDef = {
  title: string;
  cat: string;
  price: number; // euros
  weight: number; // grams
  tags: string[];
  restricted?: boolean;
  blurred?: boolean;
  age?: boolean;
  marking?: string;
  size?: string;
  material?: string;
};
type CustomerDef = { first: string; last: string; country: string; city: string; postal: string; street: string; nr: string; phone: string; domain: string };
type ZoneDef = { name: string; countries: string[]; isPickup?: boolean; rates: { maxWeightGrams: number; price: number; insurancePrice?: number; maxInsuredValue?: number }[] };

type TenantSpec = {
  slug: string;
  seed: number;
  categories: CatDef[];
  shapes: Record<string, Shape>;
  tags: { name: string; description?: string }[];
  items: ItemDef[];
  suppliers: { name: string; contact: string; notes: string }[];
  records: { supplier: number; daysAgo: number; invoice: string | null; notes: string; items: number; allocate?: "equal" | "byPrice" }[];
  zones: ZoneDef[];
  customers: CustomerDef[];
  orders: number;
  drafts: number;
  archived: number;
  stolen: number;
  cartReservations: number;
  newsletter: boolean;
  homePage: boolean;
  pageViewDays: number;
  visitorsPerDay: number;
};

const EU = ["AT", "CZ", "DE", "DK", "ES", "FI", "FR", "IE", "IT", "PL", "PT", "SE", "HU", "SK", "SI", "HR", "EE", "LV", "LT", "GR"];

const CONCEPT: TenantSpec = {
  slug: "concept-militaria",
  seed: 1940,
  categories: [
    {
      key: "helmets",
      title: "Helmets",
      description: "Steel helmets and headgear, from the M16 Stahlhelm to Cold War issue.",
      children: [
        { key: "steel-helmets", title: "Steel helmets" },
        { key: "caps", title: "Caps & headgear" },
      ],
    },
    {
      key: "uniforms",
      title: "Uniforms",
      description: "Original tunics, trousers and greatcoats.",
      children: [
        { key: "tunics", title: "Tunics & jackets" },
        { key: "coats", title: "Trousers & greatcoats" },
      ],
    },
    {
      key: "equipment",
      title: "Equipment",
      description: "Field gear, mess kits, optics and signals equipment.",
      children: [
        { key: "field-gear", title: "Field gear" },
        { key: "mess", title: "Mess kits & canteens" },
        { key: "optics", title: "Optics & signals" },
      ],
    },
    {
      key: "insignia",
      title: "Insignia",
      description: "Badges, awards, buckles and cloth insignia.",
      children: [
        { key: "awards", title: "Badges & awards" },
        { key: "buckles", title: "Buckles" },
        { key: "cloth", title: "Cloth insignia" },
      ],
    },
    {
      key: "documents",
      title: "Documents",
      description: "Paybooks, ID papers, letters and photographs.",
      children: [
        { key: "paybooks", title: "Paybooks & ID" },
        { key: "photos", title: "Photos & postcards" },
      ],
    },
    {
      key: "edged",
      title: "Edged weapons",
      description: "Bayonets and edged weapons. Sold to adults (18+) only; shipping restrictions may apply.",
      children: [{ key: "bayonets", title: "Bayonets" }],
    },
  ],
  shapes: {
    "steel-helmets": "helmet",
    caps: "cap",
    tunics: "tunic",
    coats: "coat",
    "field-gear": "bag",
    mess: "canteen",
    optics: "optics",
    awards: "badge",
    buckles: "buckle",
    cloth: "patch",
    paybooks: "document",
    photos: "photo",
    bayonets: "blade",
  },
  tags: [
    { name: "WW1", description: "1914–1918" },
    { name: "Interbellum", description: "1918–1939" },
    { name: "WW2", description: "1939–1945" },
    { name: "Cold War", description: "1947–1991" },
    { name: "Germany" },
    { name: "Netherlands" },
    { name: "Belgium" },
    { name: "France" },
    { name: "United Kingdom" },
    { name: "USA" },
    { name: "Soviet Union" },
    { name: "Heer" },
    { name: "Luftwaffe" },
    { name: "Kriegsmarine" },
    { name: "Army" },
    { name: "Infantry" },
    { name: "Airborne" },
    { name: "KNIL", description: "Koninklijk Nederlandsch-Indisch Leger" },
  ],
  items: [
    // Steel helmets
    { title: "Stahlhelm M40 Heer, ET64", cat: "steel-helmets", price: 1450, weight: 1100, tags: ["WW2", "Germany", "Heer"], restricted: true, marking: "ET64, lot 3721", size: "64 shell, 57 liner" },
    { title: "Stahlhelm M35 Luftwaffe, double decal", cat: "steel-helmets", price: 2450, weight: 1150, tags: ["WW2", "Germany", "Luftwaffe"], restricted: true, blurred: true, marking: "Q66, lot 4219", size: "66 shell, 58 liner" },
    { title: "Stahlhelm M42 Heer, no decal, Q64", cat: "steel-helmets", price: 875, weight: 1050, tags: ["WW2", "Germany", "Heer"], marking: "Q64, lot DN 1121", size: "64 shell, 56 liner" },
    { title: "Stahlhelm M16, Si66", cat: "steel-helmets", price: 895, weight: 1250, tags: ["WW1", "Germany", "Army"], marking: "Si66, B.7.", size: "66" },
    { title: "Dutch M27 helmet with lion badge", cat: "steel-helmets", price: 395, weight: 1000, tags: ["Interbellum", "Netherlands", "Army"], marking: "Verblifa", size: "57" },
    { title: "Dutch M34 helmet, Korps Mariniers", cat: "steel-helmets", price: 525, weight: 1050, tags: ["WW2", "Netherlands"], marking: "Anchor stamp", size: "56" },
    { title: "British Mk II Brodie helmet, 1940", cat: "steel-helmets", price: 185, weight: 1000, tags: ["WW2", "United Kingdom", "Army"], marking: "BMB 1940", size: "7" },
    { title: "US M1 helmet, fixed bale, Westinghouse liner", cat: "steel-helmets", price: 545, weight: 1350, tags: ["WW2", "USA", "Army"], marking: "Heat lot 136B", size: "Adjustable" },
    { title: "French Adrian M15 helmet, infantry", cat: "steel-helmets", price: 295, weight: 750, tags: ["WW1", "France", "Infantry"], marking: "Grenade badge", size: "B" },
    { title: "Soviet SSh-40 helmet, 1943", cat: "steel-helmets", price: 225, weight: 1250, tags: ["WW2", "Soviet Union", "Army"], marking: "Size 2, 1943", size: "2" },
    { title: "Belgian Mle 1931 helmet", cat: "steel-helmets", price: 165, weight: 950, tags: ["Interbellum", "Belgium", "Army"], marking: "Lion badge", size: "57" },
    { title: "Dutch M53 helmet, Koninklijke Landmacht", cat: "steel-helmets", price: 65, weight: 1200, tags: ["Cold War", "Netherlands", "Army"], marking: "Helmet net present", size: "Adjustable" },
    { title: "Bundeswehr M56 Stahlhelm", cat: "steel-helmets", price: 45, weight: 1150, tags: ["Cold War", "Germany", "Army"], marking: "Schuberth", size: "58" },
    // Caps
    { title: "Feldmütze M34 with Trapez eagle", cat: "caps", price: 325, weight: 120, tags: ["WW2", "Germany", "Heer"], restricted: true, marking: "Size 57, 1940", size: "57", material: "Wool" },
    { title: "Einheitsfeldmütze M43, Heer", cat: "caps", price: 595, weight: 150, tags: ["WW2", "Germany", "Heer"], restricted: true, marking: "Size 58, 1943 RBNr", size: "58", material: "Wool" },
    { title: "Schirmmütze Kriegsmarine officer, Erel", cat: "caps", price: 1250, weight: 300, tags: ["WW2", "Germany", "Kriegsmarine"], restricted: true, marking: "Erel Sonderklasse", size: "57", material: "Wool, leather" },
    { title: "Dutch M37 field cap, 1939", cat: "caps", price: 145, weight: 110, tags: ["WW2", "Netherlands", "Army"], size: "56", material: "Wool" },
    { title: "British General Service cap, 1944", cat: "caps", price: 75, weight: 100, tags: ["WW2", "United Kingdom", "Army"], size: "7", material: "Wool" },
    { title: "Soviet pilotka M35 with star", cat: "caps", price: 95, weight: 80, tags: ["WW2", "Soviet Union", "Army"], size: "57", material: "Cotton" },
    { title: "NVA Schirmmütze, Volksarmee", cat: "caps", price: 55, weight: 250, tags: ["Cold War", "Germany", "Army"], size: "57", material: "Wool" },
    // Tunics
    { title: "Mobilisation field jacket M34, 1939", cat: "tunics", price: 695, weight: 1300, tags: ["WW2", "Netherlands", "Army"], marking: "Maker stamp 1939", size: "Chest 104", material: "Wool" },
    { title: "Feldbluse M36, infantry Obergefreiter", cat: "tunics", price: 1850, weight: 1100, tags: ["WW2", "Germany", "Heer", "Infantry"], restricted: true, marking: "M 1938", size: "Chest 96", material: "Wool" },
    { title: "Fliegerbluse Luftwaffe, Flak", cat: "tunics", price: 1650, weight: 900, tags: ["WW2", "Germany", "Luftwaffe"], restricted: true, marking: "LBA stamp", size: "Chest 98", material: "Wool" },
    { title: "British Battledress blouse P37, 1943", cat: "tunics", price: 245, weight: 900, tags: ["WW2", "United Kingdom", "Army"], marking: "Size 7, 1943", size: "7", material: "Wool serge" },
    { title: "US M41 field jacket", cat: "tunics", price: 285, weight: 800, tags: ["WW2", "USA", "Army"], marking: "Size 38R", size: "38R", material: "Cotton, wool lining" },
    { title: "Waffenrock M10, feldgrau", cat: "tunics", price: 1350, weight: 1200, tags: ["WW1", "Germany", "Infantry"], marking: "B.A. XVIII", size: "Chest 100", material: "Wool" },
    { title: "KNIL jungle green field jacket", cat: "tunics", price: 375, weight: 700, tags: ["WW2", "Netherlands", "KNIL"], size: "M", material: "Cotton" },
    { title: "Dutch DT-63 jacket, Koninklijke Landmacht", cat: "tunics", price: 45, weight: 900, tags: ["Cold War", "Netherlands", "Army"], size: "Size 4", material: "Wool" },
    { title: "French vareuse M1920, horizon blue", cat: "tunics", price: 425, weight: 1000, tags: ["Interbellum", "France", "Infantry"], size: "Size 2", material: "Wool" },
    // Coats
    { title: "Mantel M40 Heer, feldgrau", cat: "coats", price: 495, weight: 2300, tags: ["WW2", "Germany", "Heer"], marking: "1940, RBNr", size: "Chest 104", material: "Wool" },
    { title: "Dutch M34 greatcoat, infantry", cat: "coats", price: 265, weight: 2400, tags: ["WW2", "Netherlands", "Infantry"], size: "Chest 100", material: "Wool" },
    { title: "US M1943 trousers", cat: "coats", price: 95, weight: 600, tags: ["WW2", "USA", "Army"], size: "32x33", material: "Cotton sateen" },
    { title: "Soviet shinel greatcoat", cat: "coats", price: 210, weight: 2500, tags: ["WW2", "Soviet Union", "Army"], size: "50", material: "Wool" },
    // Field gear
    { title: "Brotbeutel M31, marked 1940", cat: "field-gear", price: 85, weight: 350, tags: ["WW2", "Germany", "Heer"], marking: "1940", material: "Canvas, leather" },
    { title: "Leather belt with cartridge pouches, 1941", cat: "field-gear", price: 145, weight: 900, tags: ["WW2", "Germany", "Heer"], marking: "1941, maker marked", material: "Leather" },
    { title: "Gas mask canister M38, original paint", cat: "field-gear", price: 95, weight: 700, tags: ["WW2", "Germany"], marking: "AUER 1939", material: "Steel" },
    { title: "Tornister M34 with cowhide flap", cat: "field-gear", price: 285, weight: 1400, tags: ["WW2", "Germany", "Heer"], marking: "1938", material: "Canvas, cowhide" },
    { title: "Dutch M15 knapsack", cat: "field-gear", price: 145, weight: 1500, tags: ["WW1", "Netherlands", "Army"], marking: "Rijkseigendom", material: "Canvas, leather" },
    { title: "British 37 pattern webbing set", cat: "field-gear", price: 165, weight: 1600, tags: ["WW2", "United Kingdom", "Army"], marking: "M.E. Co. 1942", material: "Webbing" },
    { title: "US M1910 entrenching tool", cat: "field-gear", price: 75, weight: 1200, tags: ["WW2", "USA", "Army"], marking: "AMES 1943", material: "Steel, wood" },
    { title: "Zeltbahn M31, splinter camo", cat: "field-gear", price: 345, weight: 1300, tags: ["WW2", "Germany", "Heer"], marking: "1942, RBNr", material: "Cotton" },
    { title: "Klappspaten with carrier", cat: "field-gear", price: 165, weight: 1300, tags: ["WW2", "Germany"], marking: "1939", material: "Steel, leather" },
    // Mess
    { title: "Feldflasche M31 with bakelite cup", cat: "mess", price: 95, weight: 500, tags: ["WW2", "Germany"], marking: "HRE 42", material: "Aluminium, felt" },
    { title: "Kochgeschirr M31, 1942", cat: "mess", price: 65, weight: 450, tags: ["WW2", "Germany"], marking: "MN 42", material: "Aluminium" },
    { title: "US M1910 canteen with cup, 1944", cat: "mess", price: 55, weight: 600, tags: ["WW2", "USA", "Army"], marking: "S.M.Co. 1944", material: "Stainless steel" },
    { title: "Dutch water bottle M1928", cat: "mess", price: 75, weight: 550, tags: ["Interbellum", "Netherlands", "Army"], material: "Aluminium, felt" },
    // Optics
    { title: "Dienstglas 6x30 binoculars, cxn", cat: "optics", price: 395, weight: 600, tags: ["WW2", "Germany"], marking: "cxn 6x30", material: "Metal, bakelite" },
    { title: "Feldfernsprecher 33 field telephone", cat: "optics", price: 295, weight: 4800, tags: ["WW2", "Germany"], marking: "1941", material: "Bakelite" },
    { title: "Marching compass M1935, Busch", cat: "optics", price: 145, weight: 150, tags: ["WW2", "Germany"], marking: "Busch Rathenow", material: "Bakelite" },
    { title: "Signal torch, Daimon, 1940", cat: "optics", price: 55, weight: 250, tags: ["WW2", "Germany"], marking: "Daimon", material: "Steel" },
    // Awards
    { title: "Infantry Assault Badge in silver", cat: "awards", price: 245, weight: 40, tags: ["WW2", "Germany", "Heer", "Infantry"], restricted: true, blurred: true, marking: "Unmarked, hollow", material: "Zinc" },
    { title: "Wound Badge in black", cat: "awards", price: 85, weight: 20, tags: ["WW2", "Germany"], restricted: true, marking: "L/22", material: "Steel" },
    { title: "Iron Cross 2nd class 1914", cat: "awards", price: 145, weight: 25, tags: ["WW1", "Germany"], marking: "Ring marked KO", material: "Iron, silver" },
    { title: "Mobilisation War Cross 1940", cat: "awards", price: 125, weight: 30, tags: ["WW2", "Netherlands"], material: "Bronze" },
    { title: "Cross for Justice and Freedom, Korea", cat: "awards", price: 165, weight: 30, tags: ["Cold War", "Netherlands", "Army"], material: "Bronze" },
    { title: "British 1939–45 Star", cat: "awards", price: 45, weight: 25, tags: ["WW2", "United Kingdom"], material: "Copper-zinc alloy" },
    { title: "Belgian Croix de Guerre 1914–1918", cat: "awards", price: 95, weight: 30, tags: ["WW1", "Belgium"], material: "Bronze" },
    { title: "Eastern Front Medal 1941/42 with ribbon", cat: "awards", price: 75, weight: 30, tags: ["WW2", "Germany"], restricted: true, marking: "Ring marked 4", material: "Zinc" },
    // Buckles
    { title: "Belt buckle Heer, aluminium", cat: "buckles", price: 135, weight: 60, tags: ["WW2", "Germany", "Heer"], restricted: true, marking: "OLC 1936", material: "Aluminium" },
    { title: "KNIL belt buckle, brass", cat: "buckles", price: 110, weight: 80, tags: ["WW2", "Netherlands", "KNIL"], material: "Brass" },
    { title: "Kriegsmarine belt buckle, brass", cat: "buckles", price: 165, weight: 80, tags: ["WW2", "Germany", "Kriegsmarine"], restricted: true, marking: "Unmarked", material: "Brass" },
    { title: "Dutch M27 belt buckle with lion", cat: "buckles", price: 75, weight: 70, tags: ["Interbellum", "Netherlands", "Army"], material: "Brass" },
    // Cloth
    { title: "Sleeve eagle Heer, BeVo", cat: "cloth", price: 65, weight: 10, tags: ["WW2", "Germany", "Heer"], restricted: true, material: "Woven rayon" },
    { title: "Collar tabs pair, infantry", cat: "cloth", price: 45, weight: 10, tags: ["WW2", "Germany", "Infantry"], material: "Wool" },
    { title: "1st Airborne Division Pegasus patch", cat: "cloth", price: 125, weight: 10, tags: ["WW2", "United Kingdom", "Airborne"], material: "Printed cotton" },
    { title: "101st Airborne Screaming Eagle patch", cat: "cloth", price: 145, weight: 10, tags: ["WW2", "USA", "Airborne"], material: "Embroidered twill" },
    { title: "Princess Irene Brigade sleeve badge", cat: "cloth", price: 175, weight: 10, tags: ["WW2", "Netherlands", "Army"], material: "Embroidered wool" },
    // Paybooks
    { title: "Soldbuch Heer, Infanterie-Regiment 37", cat: "paybooks", price: 245, weight: 60, tags: ["WW2", "Germany", "Heer", "Infantry"], restricted: true, blurred: true, material: "Paper" },
    { title: "Wehrpass Kriegsmarine", cat: "paybooks", price: 185, weight: 80, tags: ["WW2", "Germany", "Kriegsmarine"], restricted: true, blurred: true, material: "Paper" },
    { title: "Dutch military pocket book, 1939", cat: "paybooks", price: 45, weight: 50, tags: ["WW2", "Netherlands", "Army"], material: "Paper" },
    { title: "Kennkarte and Ausweis set, Amsterdam 1943", cat: "paybooks", price: 65, weight: 30, tags: ["WW2", "Netherlands"], restricted: true, material: "Paper" },
    // Photos
    { title: "Photo album, France 1940, 120 photos", cat: "photos", price: 325, weight: 900, tags: ["WW2", "Germany", "Heer"], restricted: true, blurred: true, material: "Paper, card" },
    { title: "Field post letters bundle, 1942", cat: "photos", price: 45, weight: 150, tags: ["WW2", "Germany"], material: "Paper" },
    { title: "Mobilisation postcard set, 1939", cat: "photos", price: 25, weight: 50, tags: ["WW2", "Netherlands"], material: "Card" },
    { title: "Studio portrait US paratrooper, 1944", cat: "photos", price: 35, weight: 40, tags: ["WW2", "USA", "Airborne"], material: "Photographic paper" },
    // Bayonets
    { title: "Seitengewehr 84/98 bayonet, matching numbers", cat: "bayonets", price: 245, weight: 650, tags: ["WW2", "Germany"], age: true, marking: "cof 41", material: "Steel, bakelite" },
    { title: "Bayonet M95 Mannlicher, Hembrug", cat: "bayonets", price: 165, weight: 500, tags: ["Interbellum", "Netherlands", "Army"], age: true, marking: "Hembrug crown", material: "Steel, wood" },
    { title: "British No.4 Mk II spike bayonet", cat: "bayonets", price: 45, weight: 200, tags: ["WW2", "United Kingdom", "Army"], age: true, marking: "Broad arrow", material: "Steel" },
    { title: "US M1 bayonet, UFH", cat: "bayonets", price: 125, weight: 450, tags: ["WW2", "USA", "Army"], age: true, marking: "U.F.H. 1943", material: "Steel, plastic" },
    { title: "French Lebel M1886/15 bayonet", cat: "bayonets", price: 195, weight: 600, tags: ["WW1", "France", "Infantry"], age: true, marking: "Serial 37158", material: "Steel, nickel silver" },
  ],
  suppliers: [
    { name: "Veilinghuis Hollandia", contact: "Lot desk · veilingen@example.nl · +31 20 555 0140", notes: `${DEMO_MARK} Quarterly militaria auction, 21% buyer's premium.` },
    { name: "Militaria-Börse Ludwigsburg", contact: "Stand 114 · info@example.com", notes: `${DEMO_MARK} Spring and autumn fair.` },
    { name: "Estate De Wit, Amersfoort", contact: "Via notary · estates@example.nl", notes: `${DEMO_MARK} Private estate, veteran's collection.` },
    { name: "Brocante Lefèvre, Lille", contact: "Julien Lefèvre · +33 3 20 55 01 99", notes: `${DEMO_MARK} Dealer, buys at French flea markets.` },
  ],
  records: [
    { supplier: 0, daysAgo: 118, invoice: "VH-2026-0412", notes: `${DEMO_MARK} Spring auction, lots 211–236.`, items: 12, allocate: "byPrice" },
    { supplier: 1, daysAgo: 104, invoice: "MBL-7781", notes: `${DEMO_MARK} Fair purchase, cash.`, items: 8 },
    { supplier: 2, daysAgo: 92, invoice: null, notes: `${DEMO_MARK} Estate lot, one price for the whole collection.`, items: 14, allocate: "equal" },
    { supplier: 3, daysAgo: 71, invoice: "BL-0388", notes: `${DEMO_MARK} French and Belgian items.`, items: 6 },
    { supplier: 0, daysAgo: 46, invoice: "VH-2026-0733", notes: `${DEMO_MARK} Summer auction.`, items: 9, allocate: "byPrice" },
    { supplier: 1, daysAgo: 18, invoice: "MBL-8102", notes: `${DEMO_MARK} Autumn fair.`, items: 7 },
  ],
  zones: [
    {
      name: "Benelux",
      countries: ["NL", "BE", "LU"],
      rates: [
        { maxWeightGrams: 2000, price: 695, insurancePrice: 250, maxInsuredValue: 50000 },
        { maxWeightGrams: 5000, price: 995, insurancePrice: 250, maxInsuredValue: 50000 },
        { maxWeightGrams: 10000, price: 1495, insurancePrice: 450, maxInsuredValue: 250000 },
        { maxWeightGrams: 30000, price: 2495, insurancePrice: 450, maxInsuredValue: 250000 },
      ],
    },
    {
      name: "Europe",
      countries: EU,
      rates: [
        { maxWeightGrams: 2000, price: 1450, insurancePrice: 500, maxInsuredValue: 100000 },
        { maxWeightGrams: 5000, price: 1995, insurancePrice: 500, maxInsuredValue: 100000 },
        { maxWeightGrams: 10000, price: 2995 },
        { maxWeightGrams: 20000, price: 4495 },
      ],
    },
    {
      name: "Rest of world",
      countries: ["*"],
      rates: [
        { maxWeightGrams: 2000, price: 2750 },
        { maxWeightGrams: 5000, price: 4500 },
        { maxWeightGrams: 10000, price: 7500 },
      ],
    },
    { name: "Pickup in store", countries: ["NL", "BE"], isPickup: true, rates: [] },
  ],
  customers: [
    { first: "Jan", last: "de Vries", country: "NL", city: "Utrecht", postal: "3511 AB", street: "Oudegracht", nr: "112", phone: "+31 6 12345601", domain: "example.nl" },
    { first: "Sanne", last: "Visser", country: "NL", city: "Zwolle", postal: "8011 LK", street: "Diezerstraat", nr: "45", phone: "+31 6 12345602", domain: "example.nl" },
    { first: "Pieter", last: "Bakker", country: "NL", city: "Amersfoort", postal: "3811 GB", street: "Langestraat", nr: "8", phone: "+31 6 12345603", domain: "example.nl" },
    { first: "Anouk", last: "Janssen", country: "NL", city: "Eindhoven", postal: "5611 EM", street: "Stratumseind", nr: "21", phone: "+31 6 12345604", domain: "example.nl" },
    { first: "Ruud", last: "Mulder", country: "NL", city: "Groningen", postal: "9712 HN", street: "Herestraat", nr: "77", phone: "+31 6 12345605", domain: "example.nl" },
    { first: "Thijs", last: "van Dijk", country: "NL", city: "Arnhem", postal: "6811 CD", street: "Rijnkade", nr: "14", phone: "+31 6 12345606", domain: "example.nl" },
    { first: "Lotte", last: "de Boer", country: "NL", city: "Haarlem", postal: "2011 RD", street: "Grote Houtstraat", nr: "90", phone: "+31 6 12345607", domain: "example.nl" },
    { first: "Henk", last: "Smit", country: "NL", city: "Apeldoorn", postal: "7311 KZ", street: "Hoofdstraat", nr: "155", phone: "+31 6 12345608", domain: "example.nl" },
    { first: "Bram", last: "Hendriks", country: "NL", city: "Nijmegen", postal: "6511 PA", street: "Lange Hezelstraat", nr: "3", phone: "+31 6 12345609", domain: "example.nl" },
    { first: "Wim", last: "Peeters", country: "BE", city: "Antwerpen", postal: "2000", street: "Meir", nr: "50", phone: "+32 470 12 34 01", domain: "example.com" },
    { first: "Lien", last: "Maes", country: "BE", city: "Gent", postal: "9000", street: "Veldstraat", nr: "18", phone: "+32 470 12 34 02", domain: "example.com" },
    { first: "Thomas", last: "Jacobs", country: "BE", city: "Leuven", postal: "3000", street: "Bondgenotenlaan", nr: "66", phone: "+32 470 12 34 03", domain: "example.com" },
    { first: "Sarah", last: "Willems", country: "BE", city: "Bastogne", postal: "6600", street: "Place McAuliffe", nr: "4", phone: "+32 470 12 34 04", domain: "example.com" },
    { first: "Marc", last: "Schmit", country: "LU", city: "Luxembourg", postal: "1660", street: "Grand-Rue", nr: "27", phone: "+352 621 123 401", domain: "example.com" },
    { first: "Lukas", last: "Müller", country: "DE", city: "Köln", postal: "50667", street: "Hohe Straße", nr: "120", phone: "+49 151 2345 6701", domain: "example.com" },
    { first: "Jonas", last: "Schmidt", country: "DE", city: "Düsseldorf", postal: "40213", street: "Bolkerstraße", nr: "9", phone: "+49 151 2345 6702", domain: "example.com" },
    { first: "Felix", last: "Weber", country: "DE", city: "Münster", postal: "48143", street: "Prinzipalmarkt", nr: "31", phone: "+49 151 2345 6703", domain: "example.com" },
    { first: "Anna", last: "Becker", country: "DE", city: "Aachen", postal: "52062", street: "Pontstraße", nr: "12", phone: "+49 151 2345 6704", domain: "example.com" },
    { first: "Klaus", last: "Hoffmann", country: "DE", city: "Hamburg", postal: "20095", street: "Mönckebergstraße", nr: "7", phone: "+49 151 2345 6705", domain: "example.com" },
    { first: "Julien", last: "Lefebvre", country: "FR", city: "Lille", postal: "59000", street: "Rue de Béthune", nr: "15", phone: "+33 6 12 34 56 01", domain: "example.com" },
    { first: "Camille", last: "Moreau", country: "FR", city: "Reims", postal: "51100", street: "Rue de Vesle", nr: "88", phone: "+33 6 12 34 56 02", domain: "example.com" },
    { first: "Antoine", last: "Dubois", country: "FR", city: "Bayeux", postal: "14400", street: "Rue Saint-Jean", nr: "41", phone: "+33 6 12 34 56 03", domain: "example.com" },
    { first: "James", last: "Taylor", country: "GB", city: "Canterbury", postal: "CT1 2JB", street: "High Street", nr: "19", phone: "+44 7700 900101", domain: "example.com" },
    { first: "Oliver", last: "Brown", country: "GB", city: "York", postal: "YO1 7HH", street: "Stonegate", nr: "33", phone: "+44 7700 900102", domain: "example.com" },
    { first: "Michael", last: "Johnson", country: "US", city: "Fort Wayne", postal: "46802", street: "Main Street", nr: "410", phone: "+1 260 555 0147", domain: "example.com" },
  ],
  orders: 45,
  drafts: 5,
  archived: 3,
  stolen: 1,
  cartReservations: 4,
  newsletter: true,
  homePage: true,
  pageViewDays: 60,
  visitorsPerDay: 38,
};

const VELDPOST: TenantSpec = {
  slug: "veldpost-antiek",
  seed: 1914,
  categories: [
    { key: "post", title: "Post & paper", description: "Field post, postcards and printed matter.", children: [{ key: "fieldpost", title: "Field post" }, { key: "postcards", title: "Postcards" }] },
    { key: "medals", title: "Medals" },
    { key: "headgear", title: "Headgear" },
  ],
  shapes: { fieldpost: "document", postcards: "photo", medals: "badge", headgear: "cap", post: "document" },
  tags: [{ name: "WW1" }, { name: "Interbellum" }, { name: "WW2" }, { name: "Netherlands" }, { name: "Belgium" }, { name: "Germany" }],
  items: [
    { title: "Field post letter, Grebbelinie 1940", cat: "fieldpost", price: 35, weight: 20, tags: ["WW2", "Netherlands"], material: "Paper" },
    { title: "Field post card, Mobilisation 1914", cat: "fieldpost", price: 25, weight: 10, tags: ["WW1", "Netherlands"], material: "Card" },
    { title: "Feldpostbrief bundle, Flanders 1917", cat: "fieldpost", price: 85, weight: 120, tags: ["WW1", "Germany", "Belgium"], material: "Paper" },
    { title: "Internment camp letter, Harderwijk 1915", cat: "fieldpost", price: 55, weight: 15, tags: ["WW1", "Netherlands", "Belgium"], material: "Paper" },
    { title: "Postcard Waalsdorpervlakte, 1915", cat: "postcards", price: 25, weight: 10, tags: ["WW1", "Netherlands"], material: "Card" },
    { title: "Postcard set Belgian refugees, 1914", cat: "postcards", price: 45, weight: 40, tags: ["WW1", "Belgium"], material: "Card" },
    { title: "Mobilisation Cross 1914–1918", cat: "medals", price: 65, weight: 30, tags: ["WW1", "Netherlands"], material: "Bronze" },
    { title: "Belgian Yser Medal", cat: "medals", price: 75, weight: 30, tags: ["WW1", "Belgium"], material: "Bronze" },
    { title: "Dutch Long Service Medal, bronze", cat: "medals", price: 45, weight: 30, tags: ["Interbellum", "Netherlands"], material: "Bronze" },
    { title: "Dutch kepi M1912, infantry", cat: "headgear", price: 425, weight: 250, tags: ["WW1", "Netherlands"], size: "56", material: "Wool, leather" },
    { title: "Dutch field cap M1912", cat: "headgear", price: 225, weight: 120, tags: ["WW1", "Netherlands"], size: "57", material: "Wool" },
    { title: "Belgian bonnet de police, 1915", cat: "headgear", price: 165, weight: 100, tags: ["WW1", "Belgium"], size: "56", material: "Wool" },
  ],
  suppliers: [{ name: "Antiekmarkt De Looier", contact: "Stand 32 · looier@example.nl", notes: `${DEMO_MARK} Market dealer.` }],
  records: [{ supplier: 0, daysAgo: 60, invoice: "LOO-221", notes: `${DEMO_MARK} Mixed lot.`, items: 8, allocate: "byPrice" }],
  zones: [
    { name: "Benelux", countries: ["NL", "BE", "LU"], rates: [{ maxWeightGrams: 2000, price: 595 }, { maxWeightGrams: 10000, price: 1295 }] },
    { name: "Europe", countries: EU, rates: [{ maxWeightGrams: 2000, price: 1350 }, { maxWeightGrams: 10000, price: 2650 }] },
    { name: "Pickup in store", countries: ["NL"], isPickup: true, rates: [] },
  ],
  customers: [
    { first: "Kees", last: "Vermeulen", country: "NL", city: "Leiden", postal: "2311 EW", street: "Breestraat", nr: "60", phone: "+31 6 22345601", domain: "example.nl" },
    { first: "Marieke", last: "Dekker", country: "NL", city: "Delft", postal: "2611 GV", street: "Markt", nr: "11", phone: "+31 6 22345602", domain: "example.nl" },
    { first: "Gert", last: "Claes", country: "BE", city: "Ieper", postal: "8900", street: "Meensestraat", nr: "5", phone: "+32 471 22 34 01", domain: "example.com" },
    { first: "Hanna", last: "Wagner", country: "DE", city: "Kleve", postal: "47533", street: "Große Straße", nr: "24", phone: "+49 152 2345 6701", domain: "example.com" },
    { first: "Erik", last: "Kok", country: "NL", city: "Harderwijk", postal: "3841 BG", street: "Donkerstraat", nr: "38", phone: "+31 6 22345603", domain: "example.nl" },
    { first: "Inge", last: "Brouwer", country: "NL", city: "Den Haag", postal: "2513 AA", street: "Noordeinde", nr: "70", phone: "+31 6 22345604", domain: "example.nl" },
  ],
  orders: 7,
  drafts: 1,
  archived: 0,
  stolen: 0,
  cartReservations: 1,
  newsletter: false,
  homePage: false,
  pageViewDays: 30,
  visitorsPerDay: 9,
};

const DEMO_CAMPAIGNS = [
  {
    subject: "New arrivals: Dutch mobilisation 1939–1940",
    body: "## Fresh from an estate in Amersfoort\n\nThis month we listed a complete Dutch mobilisation group: an M34 field jacket, M37 field cap, the Mobilisation War Cross and a pocket book from 1939.\n\n[Browse the new arrivals](/shop)\n\nAs always: every item is checked, described honestly and photographed in detail.",
    sent: true,
  },
  {
    subject: "Autumn fair finds — Ludwigsburg 2026",
    body: "## Back from Ludwigsburg\n\nWe found helmets, field gear and a lovely Dienstglas 6x30. Everything will be online this weekend.\n\n*Draft — add photos before sending.*",
    sent: false,
  },
];

// ─── Context helpers ────────────────────────────────────────────────────────

type Actor = ServiceContext["actor"];

async function actorsFor(tenantId: string): Promise<{ owner: Actor; superadmin: Actor; ownerIsSuperadmin: boolean }> {
  const su = await db.user.findFirst({ where: { role: "SUPERADMIN", tenantId: null, disabledAt: null }, orderBy: { createdAt: "asc" } });
  if (!su) throw new Error("No SUPERADMIN user found — run `npm run db:seed` first");
  const superadmin: Actor = { id: su.id, role: su.role, tenantId: su.tenantId, email: su.email };
  const ow = await db.user.findFirst({ where: { tenantId, role: "OWNER", disabledAt: null }, orderBy: { createdAt: "asc" } });
  if (!ow) return { owner: superadmin, superadmin, ownerIsSuperadmin: true };
  return { owner: { id: ow.id, role: ow.role, tenantId: ow.tenantId, email: ow.email }, superadmin, ownerIsSuperadmin: false };
}

// ─── Placeholder images ─────────────────────────────────────────────────────

const PALETTES = [
  { bg1: "#5B5F3A", bg2: "#3E4128", fg: "#2B2D1C", ink: "#E9E0C6", accent: "#C2954A" }, // olive
  { bg1: "#B8A97A", bg2: "#8F8257", fg: "#5E5537", ink: "#2E2A1C", accent: "#7E5416" }, // khaki
  { bg1: "#6E7363", bg2: "#4C5044", fg: "#33362D", ink: "#ECE6D3", accent: "#D19C48" }, // field grey
  { bg1: "#7A6247", bg2: "#54412D", fg: "#3A2C1E", ink: "#F1E5CC", accent: "#D9A85A" }, // leather
  { bg1: "#D9CDB0", bg2: "#BFB08C", fg: "#8C7D5A", ink: "#3A3324", accent: "#9C6B22" }, // paper
];

const SHAPES: Record<Shape, string> = {
  helmet: `<path d="M210 360 Q215 165 400 150 Q585 165 590 360 L640 385 Q400 425 160 385 Z"/><path d="M250 330 Q400 350 550 330" fill="none" stroke-width="6" class="ln"/>`,
  cap: `<path d="M235 320 Q255 205 400 195 Q545 205 565 320 Z"/><ellipse cx="400" cy="330" rx="200" ry="34"/><path d="M300 345 Q400 410 520 350 Z"/>`,
  tunic: `<path d="M310 140 L365 125 L400 175 L435 125 L490 140 L610 230 L570 290 L525 255 L525 470 L275 470 L275 255 L230 290 L190 230 Z"/>`,
  coat: `<path d="M315 120 L370 105 L400 150 L430 105 L485 120 L600 210 L565 265 L530 235 L560 490 L240 490 L270 235 L235 265 L200 210 Z"/>`,
  bag: `<rect x="250" y="180" width="300" height="260" rx="38"/><path d="M250 230 Q400 300 550 230 L550 200 Q400 150 250 200 Z" class="ln2"/><rect x="380" y="270" width="40" height="40" rx="6" class="ln2"/>`,
  canteen: `<ellipse cx="400" cy="320" rx="135" ry="160"/><rect x="370" y="130" width="60" height="45" rx="8"/><rect x="290" y="300" width="220" height="20" class="ln2"/>`,
  optics: `<rect x="255" y="190" width="120" height="230" rx="30"/><rect x="425" y="190" width="120" height="230" rx="30"/><rect x="360" y="250" width="80" height="50"/><circle cx="315" cy="410" r="52"/><circle cx="485" cy="410" r="52"/>`,
  badge: `<ellipse cx="400" cy="300" rx="130" ry="160" fill="none" stroke-width="26" class="st"/><path d="M400 200 L428 270 L500 272 L442 315 L465 385 L400 343 L335 385 L358 315 L300 272 L372 270 Z"/>`,
  buckle: `<rect x="250" y="190" width="300" height="220" rx="26"/><circle cx="400" cy="300" r="70" class="ln2"/><rect x="200" y="270" width="50" height="60"/>`,
  patch: `<path d="M290 170 L510 170 L510 330 Q510 420 400 460 Q290 420 290 330 Z"/><path d="M340 250 L400 210 L460 250 L430 330 L370 330 Z" class="ln2"/>`,
  document: `<rect x="270" y="130" width="260" height="340" rx="6"/><g class="ln2"><rect x="305" y="180" width="190" height="12"/><rect x="305" y="215" width="160" height="12"/><rect x="305" y="250" width="180" height="12"/><rect x="305" y="285" width="120" height="12"/><circle cx="460" cy="400" r="34"/></g>`,
  photo: `<rect x="220" y="160" width="360" height="280" rx="4"/><rect x="245" y="185" width="310" height="200" class="ln2"/><path d="M245 385 L330 300 L390 350 L450 280 L555 385 Z"/>`,
  blade: `<path d="M150 285 L540 270 L590 300 L540 330 L150 315 Z"/><rect x="540" y="255" width="20" height="90"/><rect x="560" y="280" width="120" height="40" rx="10"/>`,
};
const VIEWS = ["FRONT", "SIDE", "DETAIL", "MARKING"];

function xml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function svgFor(opts: { title: string; stockCode: number; shape: Shape; view: number; palette: number }) {
  const p = PALETTES[opts.palette % PALETTES.length];
  const title = opts.title.length > 44 ? `${opts.title.slice(0, 43)}…` : opts.title;
  const rotate = [0, -8, 6, -3][opts.view % 4];
  const scale = [1, 0.9, 1.25, 1.1][opts.view % 4];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <defs>
    <radialGradient id="g" cx="50%" cy="42%" r="70%"><stop offset="0" stop-color="${p.bg1}"/><stop offset="1" stop-color="${p.bg2}"/></radialGradient>
    <style>.ln,.st{stroke:${p.accent}} .ln2{fill:${p.accent};opacity:.55} text{font-family:Helvetica,Arial,sans-serif}</style>
  </defs>
  <rect width="800" height="600" fill="url(#g)"/>
  <g opacity=".08" fill="${p.ink}">${Array.from({ length: 12 }, (_, i) => `<rect x="0" y="${i * 50}" width="800" height="1"/>`).join("")}</g>
  <g fill="${p.fg}" transform="translate(400 300) rotate(${rotate}) scale(${scale}) translate(-400 -300)">${SHAPES[opts.shape]}</g>
  <text x="32" y="48" font-size="18" letter-spacing="3" fill="${p.ink}" opacity=".7">DEMO · ${VIEWS[opts.view % 4]}</text>
  <rect x="0" y="508" width="800" height="92" fill="#1E1C14" opacity=".72"/>
  <text x="32" y="550" font-size="26" font-weight="700" fill="#F4ECD8">${xml(title)}</text>
  <text x="32" y="582" font-size="18" fill="#D9A85A" letter-spacing="2">#${opts.stockCode}</text>
</svg>`;
}

async function placeholderJpeg(opts: Parameters<typeof svgFor>[0]): Promise<Uint8Array> {
  const buf = await sharp(Buffer.from(svgFor(opts))).jpeg({ quality: 82 }).toBuffer();
  return new Uint8Array(buf);
}

// ─── Descriptions & specs ───────────────────────────────────────────────────

const CONDITIONS = ["Excellent", "Very good", "Good, honest wear", "Good, some damage (see photos)", "Fair, as found"];
const PERIOD_TAGS = ["WW1", "Interbellum", "WW2", "Cold War"];
const COUNTRY_TAGS = ["Germany", "Netherlands", "Belgium", "France", "United Kingdom", "USA", "Soviet Union"];

function specsFor(item: ItemDef, condition: string): Specification[] {
  const specs: Specification[] = [];
  const period = item.tags.find((t) => PERIOD_TAGS.includes(t));
  const country = item.tags.find((t) => COUNTRY_TAGS.includes(t));
  const branch = item.tags.find((t) => !PERIOD_TAGS.includes(t) && !COUNTRY_TAGS.includes(t));
  if (period) specs.push({ label: "Period", value: period });
  if (country) specs.push({ label: "Country", value: country });
  if (branch) specs.push({ label: "Branch", value: branch });
  if (item.marking) specs.push({ label: "Markings", value: item.marking });
  if (item.size) specs.push({ label: "Size", value: item.size });
  if (item.material) specs.push({ label: "Material", value: item.material });
  specs.push({ label: "Condition", value: condition });
  return specs;
}

function descriptionFor(item: ItemDef, condition: string): string {
  const parts = [
    `Original ${item.title}${item.marking ? `, marked ${item.marking}` : ""}. ${condition === "Excellent" ? "A very clean example." : "Honest piece with age-appropriate wear."}`,
    "Comes from an old Dutch collection; checked and described to the best of our knowledge. Please study the photos carefully — they are part of the description.",
  ];
  if (item.restricted) parts.push("*Shown with period symbols for historical and educational purposes only.*");
  if (item.age) parts.push("**18+ only.** Edged weapons are only sold to adults; we ship within the EU only.");
  return parts.join("\n\n");
}

// ─── Reset ──────────────────────────────────────────────────────────────────

async function resetTenant(spec: TenantSpec, tenantId: string, ctx: ServiceContext) {
  const isDemoJson = { path: ["demo"], equals: true };
  const demoProducts = await db.product.findMany({ where: { tenantId, legacyData: isDemoJson }, select: { id: true } });
  const productIds = demoProducts.map((p) => p.id);
  const demoOrders = await db.order.findMany({ where: { tenantId, legacyData: isDemoJson }, select: { id: true } });
  const orderIds = demoOrders.map((o) => o.id);
  const catTitles = flattenCats(spec.categories).map((c) => c.title);
  const counts: Record<string, number> = {};

  await db.$transaction(async (tx) => {
    // Carts that hold demo products.
    const carts = await tx.cartItem.findMany({ where: { tenantId, productId: { in: productIds } }, select: { cartId: true } });
    const resCarts = await tx.reservation.findMany({ where: { tenantId, productId: { in: productIds }, cartId: { not: null } }, select: { cartId: true } });
    const cartIds = [...new Set([...carts.map((c) => c.cartId), ...resCarts.map((r) => r.cartId!)])];
    counts.carts = (await tx.cart.deleteMany({ where: { tenantId, id: { in: cartIds } } })).count;
    // Orders (payments are Restrict; lines/addresses/events cascade).
    await tx.invoice.deleteMany({ where: { tenantId, orderId: { in: orderIds } } });
    await tx.payment.deleteMany({ where: { tenantId, orderId: { in: orderIds } } });
    await tx.reservation.deleteMany({ where: { tenantId, OR: [{ orderId: { in: orderIds } }, { productId: { in: productIds } }] } });
    await tx.stockMovement.deleteMany({ where: { tenantId, OR: [{ orderId: { in: orderIds } }, { productId: { in: productIds } }] } });
    counts.orders = (await tx.order.deleteMany({ where: { tenantId, id: { in: orderIds } } })).count;
    counts.products = (await tx.product.deleteMany({ where: { tenantId, id: { in: productIds } } })).count;
    counts.purchaseRecords = (await tx.purchaseRecord.deleteMany({ where: { tenantId, notes: { startsWith: DEMO_MARK } } })).count;
    counts.suppliers = (
      await tx.supplier.deleteMany({ where: { tenantId, notes: { startsWith: DEMO_MARK }, purchaseRecords: { none: {} } } })
    ).count;
    counts.customers = (await tx.customer.deleteMany({ where: { tenantId, notes: { startsWith: DEMO_MARK }, orders: { none: {} } } })).count;
    // Taxonomy / zones by the names defined in this script, only when nothing else uses them.
    counts.tags = (await tx.tag.deleteMany({ where: { tenantId, name: { in: spec.tags.map((t) => t.name) }, products: { none: {} } } })).count;
    // Children before parents.
    let removed = 0;
    for (let pass = 0; pass < 3; pass++) {
      removed += (
        await tx.category.deleteMany({ where: { tenantId, title: { in: catTitles }, products: { none: {} }, children: { none: {} } } })
      ).count;
    }
    counts.categories = removed;
    counts.shippingZones = (
      await tx.shippingZone.deleteMany({ where: { tenantId, name: { in: spec.zones.map((z) => z.name) }, orders: { none: {} } } })
    ).count;
    counts.subscribers = (await tx.newsletterSubscriber.deleteMany({ where: { tenantId, email: { in: subscriberEmails(spec) } } })).count;
    counts.campaigns = (await tx.newsletterCampaign.deleteMany({ where: { tenantId, subject: { in: DEMO_CAMPAIGNS.map((c) => c.subject) } } })).count;
    counts.pageViews = (await tx.pageView.deleteMany({ where: { tenantId, visitorHash: { startsWith: "demo" } } })).count;
  });
  for (const id of productIds) await deleteProductMedia(ctx, id);
  console.log(`  reset ${spec.slug}: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ")}`);
}

function flattenCats(cats: CatDef[]): CatDef[] {
  return cats.flatMap((c) => [c, ...flattenCats(c.children ?? [])]);
}

const EXTRA_SUBSCRIBERS = [
  "r.vandenberg", "m.koster", "collector.utrecht", "helmut.krause", "a.devos", "p.lambert", "s.oconnor", "militaria.fan",
  "l.meijer", "k.schouten", "t.dewitte", "j.gerritsen", "b.hermans", "c.fontaine", "d.richter", "e.vos", "f.claessens", "g.hartmann",
];
function subscriberEmails(spec: TenantSpec): string[] {
  const fromCustomers = spec.customers.slice(0, 12).map(customerEmail);
  return [...fromCustomers, ...EXTRA_SUBSCRIBERS.map((n, i) => `${n}@${i % 2 ? "example.com" : "example.nl"}`)];
}
function customerEmail(c: CustomerDef) {
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z]+/g, "");
  return `${norm(c.first)}.${norm(c.last)}@${c.domain}`;
}

// ─── Seeding one tenant ─────────────────────────────────────────────────────

type CreatedProduct = {
  id: string;
  stockCode: number;
  slug: string;
  item: ItemDef;
  price: number;
  final: ProductStatus | "SOLD_VIA_ORDER";
  imagePath: string | null;
  purchasePrice: number | null;
  publishedAt?: Date;
};

type OrderPlan = {
  placedAt: number;
  customer: CustomerDef;
  products: CreatedProduct[];
  outcome: "PAID_MOLLIE" | "PAID_MANUAL" | "PENDING_TRANSFER" | "PENDING_OPEN" | "FAILED" | "EXPIRED" | "MOLLIE_CANCELED" | "ADMIN_CANCELED";
  method: string;
  pickup: boolean;
};

type Summary = Record<string, number | string>;

async function seedTenant(spec: TenantSpec): Promise<Summary | null> {
  rand = rng(spec.seed);
  const tenant = await db.tenant.findUnique({ where: { slug: spec.slug } });
  if (!tenant) {
    console.log(`- ${spec.slug}: tenant not found (run \`npm run db:seed\`), skipped`);
    return null;
  }
  const tenantId = tenant.id;
  const { owner, superadmin, ownerIsSuperadmin } = await actorsFor(tenantId);
  const ctx: ServiceContext = { tenantId, actor: owner };

  if (process.argv.includes("--reset")) await resetTenant(spec, tenantId, ctx);

  const existing = await db.product.count({ where: { tenantId } });
  if (existing >= 10) {
    console.log(`- ${spec.slug}: demo data already present (${existing} products), skipped`);
    return null;
  }
  console.log(`- ${spec.slug}: seeding as ${ownerIsSuperadmin ? "SUPERADMIN (tenant has no owner)" : `owner ${owner.email}`}`);

  // Settings first: the newsletter feature gates subscribers/campaigns and the signup block.
  if (spec.newsletter) await updateSettings(tenantId, "platform", { newsletterEnabled: true }, superadmin);

  // 1. Taxonomy
  const catIds = new Map<string, string>();
  const createCats = async (defs: CatDef[], parentId: string | null) => {
    for (const d of defs) {
      const c = await createCategory(ctx, { title: d.title, description: d.description ?? null, parentId });
      catIds.set(d.key, c.id);
      if (d.children) await createCats(d.children, c.id);
    }
  };
  await createCats(spec.categories, null);
  const tagIds = new Map<string, string>();
  for (const t of spec.tags) tagIds.set(t.name, (await createTag(ctx, { name: t.name, description: t.description ?? null })).id);

  // 2. Suppliers + purchase records (products are linked at creation)
  const suppliers = [];
  for (const s of spec.suppliers) suppliers.push(await createSupplier(ctx, s));
  const records = [];
  for (const r of spec.records) {
    records.push(
      await createPurchaseRecord(ctx, {
        supplierId: suppliers[r.supplier].id,
        purchasedAt: new Date(NOW - r.daysAgo * DAY),
        invoiceNumber: r.invoice,
        notes: r.notes,
      }),
    );
  }

  // 3. Products. Decide final roles first.
  const n = spec.items.length;
  const order = shuffle([...Array(n).keys()]);
  const roles: (ProductStatus | "SELLABLE")[] = Array(n).fill("SELLABLE");
  let cursor = 0;
  for (let i = 0; i < spec.drafts; i++) roles[order[cursor++]] = "DRAFT";
  for (let i = 0; i < spec.archived; i++) roles[order[cursor++]] = "ARCHIVED";
  for (let i = 0; i < spec.stolen; i++) roles[order[cursor++]] = "STOLEN";
  // Record membership: walk the remaining shuffled list.
  const recordOf = new Map<number, number>();
  let rc = 0;
  for (let r = 0; r < spec.records.length; r++) {
    for (let k = 0; k < spec.records[r].items && rc < n; k++) recordOf.set(order[(rc++ * 7) % n], r);
  }

  const created: CreatedProduct[] = [];
  let imageCount = 0;
  let draftsWithoutPhoto = 0;
  for (let i = 0; i < n; i++) {
    const item = spec.items[i];
    const condition = pick(CONDITIONS);
    const role = roles[i];
    const r = recordOf.get(i);
    const price = item.price * 100 - (chance(0.3) && item.price > 60 ? 500 : 0);
    const p = await createProduct(ctx, {
      title: item.title,
      description: descriptionFor(item, condition),
      specifications: specsFor(item, condition),
      price,
      weightGrams: item.weight,
      importance: chance(0.1) ? 10 : 0,
      ageRestricted: !!item.age,
      blurred: !!item.blurred,
      restrictedSymbols: !!item.restricted,
      acceptsOffers: item.price >= 500 && chance(0.6),
      onSale: chance(0.06),
      notes: chance(0.2) ? pick(["Check liner before shipping.", "Bought as part of a group; see purchase record.", "Customer from Ghent asked about this one."]) : null,
      categoryId: catIds.get(item.cat) ?? null,
      purchaseRecordId: r !== undefined ? records[r].id : null,
      tagIds: item.tags.map((t) => tagIds.get(t)!).filter(Boolean),
      quantity: 1,
      status: role === "DRAFT" ? "DRAFT" : "ACTIVE",
    });
    await db.product.update({ where: { id: p.id }, data: { legacyData: { demo: true } } });

    const skipPhotos = role === "DRAFT" && draftsWithoutPhoto < 2;
    if (skipPhotos) draftsWithoutPhoto++;
    else {
      const count = int(1, 4);
      const palette = int(0, PALETTES.length - 1);
      const files = [];
      for (let v = 0; v < count; v++) {
        files.push({
          name: `${p.stockCode}-${v + 1}.jpg`,
          type: "image/jpeg",
          bytes: await placeholderJpeg({ title: item.title, stockCode: p.stockCode, shape: spec.shapes[item.cat] ?? "bag", view: v, palette: palette + (v === 3 ? 1 : 0) }),
        });
      }
      await addProductImages(ctx, p.id, files);
      imageCount += count;
    }
    const cover = await db.productImage.findFirst({ where: { productId: p.id }, orderBy: { sortOrder: "asc" }, select: { storageKey: true, variants: true } });
    const thumbKey = (cover?.variants as { thumb?: { key?: string } } | null)?.thumb?.key ?? cover?.storageKey ?? null;
    created.push({ id: p.id, stockCode: p.stockCode, slug: p.slug, item, price, final: role === "SELLABLE" ? "ACTIVE" : role, imagePath: thumbKey, purchasePrice: null });
    progress(`  products ${i + 1}/${n} (${imageCount} images)`);
  }
  progress("\n");

  // 4. Purchase prices: allocate per record where configured; individual prices for ~80% of the rest.
  for (let r = 0; r < spec.records.length; r++) {
    const def = spec.records[r];
    const linked = created.filter((_, i) => recordOf.get(i) === r);
    if (!linked.length) continue;
    const retail = linked.reduce((s, p) => s + p.price, 0);
    const totalCost = Math.round((retail * between(0.42, 0.58)) / 100) * 100;
    await db.purchaseRecord.update({ where: { id: records[r].id }, data: { totalCost } }); // no service sets totalCost after create without replacing links
    if (def.allocate) {
      await allocatePurchaseRecordCost(ctx, records[r].id, def.allocate);
    } else {
      // Itemised invoice: individual prices that sum to the total.
      let left = totalCost;
      const prices = linked.map((p, i) => {
        const v = i === linked.length - 1 ? left : Math.round((totalCost * p.price) / retail / 100) * 100;
        left -= v;
        return { productId: p.id, purchasePrice: Math.max(v, 100) };
      });
      await setPurchasePrices(ctx, { prices });
    }
  }
  const loose = created.filter((_, i) => !recordOf.has(i) && chance(0.72));
  if (loose.length) {
    await setPurchasePrices(ctx, {
      prices: loose.map((p) => ({ productId: p.id, purchasePrice: Math.round((p.price * between(0.35, 0.65)) / 100) * 100 })),
    });
  }
  const pp = await db.product.findMany({ where: { id: { in: created.map((c) => c.id) } }, select: { id: true, purchasePrice: true } });
  for (const c of created) c.purchasePrice = pp.find((x) => x.id === c.id)?.purchasePrice ?? null;

  // 5. Shipping zones
  for (const z of spec.zones) await createZone(ctx, { name: z.name, countries: z.countries, isPickup: !!z.isPickup, rates: z.rates });

  // 6. Orders
  const sellable = shuffle(created.filter((c) => c.final === "ACTIVE"));
  const orderSummary = await seedOrders(spec, ctx, sellable);

  // 7. Final statuses for archived / stolen items (service: setStatus)
  const toArchive = created.filter((c) => c.final === "ARCHIVED").map((c) => c.id);
  if (toArchive.length) await setStatus(ctx, toArchive, "ARCHIVED");
  const toSteal = created.filter((c) => c.final === "STOLEN").map((c) => c.id);
  if (toSteal.length) await setStatus(ctx, toSteal, "STOLEN");

  // 8. Back-date catalog timestamps (publishedAt over the last 120 days, before any order for the item).
  const firstOrderAt = orderSummary.firstOrderAt;
  for (const c of created) {
    const before = firstOrderAt.get(c.id);
    const latest = before ? before - int(1, 25) * DAY : NOW - int(0, 118) * DAY;
    const publishedMs = Math.max(NOW - 120 * DAY + int(0, 6) * HOUR, latest - int(0, 10) * HOUR);
    const createdMs = c.final === "DRAFT" ? NOW - int(1, 20) * DAY - int(0, 12) * HOUR : publishedMs - int(1, 30) * HOUR;
    await db.product.update({
      where: { id: c.id },
      data: { createdAt: at(createdMs), publishedAt: c.final === "DRAFT" ? null : at(publishedMs) },
    });
    await db.stockMovement.updateMany({ where: { productId: c.id, orderId: null, reason: { in: ["PURCHASE", "ADJUSTMENT"] } }, data: { createdAt: at(createdMs) } });
    await db.productImage.updateMany({ where: { productId: c.id }, data: { createdAt: at(createdMs + 20 * MIN) } });
  }

  // 9. Live cart reservations ("In cart")
  const stillActive = await db.product.findMany({ where: { tenantId, status: "ACTIVE", id: { in: created.map((c) => c.id) } }, select: { id: true } });
  let reservations = 0;
  for (const p of shuffle(stillActive).slice(0, spec.cartReservations)) {
    const cart = await db.cart.create({
      data: { tenantId, tokenHash: createHash("sha256").update(`demo-cart-${hex(16)}`).digest("hex"), countryCode: pick(["NL", "BE", "DE"]), expiresAt: new Date(NOW + 30 * DAY) },
    });
    await db.cartItem.create({ data: { tenantId, cartId: cart.id, productId: p.id } });
    await reserveProduct({ tenantId, productId: p.id, cartId: cart.id, minutes: 15 });
    reservations++;
  }

  // 10. Content: system pages, home page
  await ensureSystemPages(tenantId);
  let homePublished = "no";
  if (spec.homePage) homePublished = await seedHomePage(ctx, spec);

  // 11. Newsletter
  let subscribers = 0;
  let campaigns = 0;
  if (spec.newsletter) ({ subscribers, campaigns } = await seedNewsletter(ctx, spec));

  // 12. Page views
  const pageViews = await seedPageViews(tenantId, spec, created);

  const statusCounts = await db.product.groupBy({ by: ["status"], where: { tenantId, id: { in: created.map((c) => c.id) } }, _count: true });
  return {
    tenant: spec.slug,
    actor: ownerIsSuperadmin ? "superadmin" : "owner",
    categories: catIds.size,
    tags: tagIds.size,
    products: created.length,
    ...Object.fromEntries(statusCounts.map((s) => [`  ${s.status}`, s._count])),
    images: imageCount,
    suppliers: suppliers.length,
    purchaseRecords: records.length,
    shippingZones: spec.zones.length,
    customers: orderSummary.customers,
    orders: orderSummary.orders,
    ...Object.fromEntries(Object.entries(orderSummary.byStatus).map(([k, v]) => [`  ${k}`, v])),
    "revenue (paid subtotal)": euro(orderSummary.revenue),
    cartReservations: reservations,
    homePublished,
    subscribers,
    campaigns,
    pageViews,
  };
}

// ─── Orders ─────────────────────────────────────────────────────────────────

function planOrders(spec: TenantSpec, sellable: CreatedProduct[]): OrderPlan[] {
  const plans: OrderPlan[] = [];
  // Outcomes: mostly paid; a few pending/failed/canceled.
  const total = spec.orders;
  const nonPaid: OrderPlan["outcome"][] =
    total >= 20
      ? ["PENDING_TRANSFER", "PENDING_TRANSFER", "PENDING_OPEN", "PENDING_OPEN", "FAILED", "EXPIRED", "MOLLIE_CANCELED", "ADMIN_CANCELED", "ADMIN_CANCELED"]
      : ["PENDING_TRANSFER", "EXPIRED"];
  // Dates: weighted to recent weeks, weekend-heavy (Sunday evening browsing → Monday orders).
  const dates: number[] = [];
  while (dates.length < total) {
    const daysAgo = Math.floor(Math.pow(rand(), 1.25) * 89);
    const ts = NOW - daysAgo * DAY - int(0, 23) * HOUR - int(0, 59) * MIN;
    const dow = new Date(ts).getDay();
    if ((dow === 0 || dow === 1 || dow === 6) && chance(0.15)) continue; // keep shape, tiny dip otherwise
    if (ts > NOW - 20 * MIN) continue;
    dates.push(ts);
  }
  dates.sort((a, b) => a - b);
  // Non-paid outcomes: pending ones are the most recent orders, failures spread.
  const outcomes: OrderPlan["outcome"][] = Array(total).fill("PAID_MOLLIE");
  const recentIdx = [total - 1, total - 3, total - 6, total - 8].filter((i) => i >= 0);
  const pendings = nonPaid.filter((o) => o.startsWith("PENDING"));
  pendings.forEach((o, k) => (outcomes[recentIdx[k] ?? total - 1 - k] = o));
  const others = nonPaid.filter((o) => !o.startsWith("PENDING"));
  const freeIdx = shuffle([...Array(total).keys()].filter((i) => outcomes[i] === "PAID_MOLLIE" && i < total - recentIdx.length - 1 && i > 0));
  others.forEach((o, k) => (outcomes[freeIdx[k]] = o));
  // ~25% of paid orders by bank transfer (marked paid manually).
  outcomes.forEach((o, i) => {
    if (o === "PAID_MOLLIE" && chance(0.25)) outcomes[i] = "PAID_MANUAL";
  });

  // Products: paid orders consume unique items; non-paid orders reference items that stay for sale.
  const forSale = [...sellable];
  const paidCount = outcomes.filter((o) => o.startsWith("PAID")).length;
  const keepActive = Math.max(spec.cartReservations + 6, Math.ceil(forSale.length * 0.45));
  const soldPool = forSale.slice(0, Math.max(paidCount, forSale.length - keepActive));
  const stayPool = forSale.slice(soldPool.length);
  // Repeat buyers: a handful of customers order more than once.
  const regulars = spec.customers.slice(0, Math.min(5, spec.customers.length));

  let soldIdx = 0;
  for (let i = 0; i < total; i++) {
    const outcome = outcomes[i];
    const customer = chance(0.3) ? pick(regulars) : pick(spec.customers);
    const paid = outcome.startsWith("PAID");
    const items: CreatedProduct[] = [];
    if (paid) {
      const remaining = soldPool.length - soldIdx;
      const ordersLeft = outcomes.slice(i).filter((o) => o.startsWith("PAID")).length;
      const lines = remaining > ordersLeft && chance(0.22) ? 2 : 1;
      for (let k = 0; k < lines && soldIdx < soldPool.length; k++) items.push(soldPool[soldIdx++]);
      if (!items.length) items.push(stayPool.pop()!); // safety: never happens with sane spec sizes
    } else {
      items.push(pick(stayPool));
    }
    const method =
      outcome === "PAID_MANUAL" || outcome === "PENDING_TRANSFER" || outcome === "ADMIN_CANCELED"
        ? "banktransfer"
        : customer.country === "BE"
          ? pick(["bancontact", "bancontact", "creditcard"])
          : customer.country === "NL"
            ? pick(["ideal", "ideal", "ideal", "paypal"])
            : pick(["creditcard", "paypal", "creditcard"]);
    plans.push({
      placedAt: dates[i],
      customer,
      products: items,
      outcome,
      method,
      pickup: customer.country === "NL" && paid && chance(0.12),
    });
  }
  return plans;
}

const CARRIERS: Record<string, { carrier: string; url: (code: string, postal: string, country: string) => string; code: () => string }> = {
  NL: { carrier: "PostNL", code: () => `3S${hex(4).toUpperCase()}${int(1000000, 9999999)}`, url: (c, p, co) => `https://jouw.postnl.nl/track-and-trace/${c}-${co}-${p.replace(/\s/g, "")}` },
  BE: { carrier: "bpost", code: () => `32${int(10000000, 99999999)}${int(1000000, 9999999)}`, url: (c) => `https://track.bpost.cloud/btr/web/#/search?itemCode=${c}` },
  DE: { carrier: "DHL", code: () => `00340434${int(100000000, 999999999)}${int(100, 999)}`, url: (c) => `https://www.dhl.com/nl-en/home/tracking.html?tracking-id=${c}` },
  XX: { carrier: "PostNL", code: () => `RR${int(100000000, 999999999)}NL`, url: (c, p, co) => `https://jouw.postnl.nl/track-and-trace/${c}-${co}-${p.replace(/\s/g, "")}` },
};

const NOTES = [
  "Please pack the helmet with extra care, it is a gift.",
  "Could you combine shipping with my other order?",
  "Is a certificate of authenticity included?",
  "Leave the parcel with the neighbours at number 14 if I'm not home.",
];

async function seedOrders(spec: TenantSpec, ctx: ServiceContext, sellable: CreatedProduct[]) {
  const tenantId = ctx.tenantId;
  const plans = planOrders(spec, sellable);
  const byStatus: Record<string, number> = {};
  const firstOrderAt = new Map<string, number>();
  const customerFirst = new Map<string, number>();
  let revenue = 0;

  for (const [idx, plan] of plans.entries()) {
    for (const p of plan.products) if (!firstOrderAt.has(p.id)) firstOrderAt.set(p.id, plan.placedAt);
    const c = plan.customer;
    const subtotal = plan.products.reduce((s, p) => s + p.price, 0);
    const weight = plan.products.reduce((s, p) => s + p.item.weight, 0) + 400; // + packaging
    const quote = await quoteShipping(tenantId, { countryCode: c.country, totalWeightGrams: weight, subtotal });
    if (!quote.deliverable) throw new Error(`No shipping option for ${c.country} (${weight} g)`);
    const option = (plan.pickup ? quote.options.find((o) => o.isPickup) : undefined) ?? quote.options.find((o) => !o.isPickup) ?? quote.options[0];
    const insured = !option.isPickup && option.insurance && subtotal >= 40000;
    const shippingTotal = option.price + (insured ? option.insurance!.price : 0);
    const placedAt = new Date(plan.placedAt);
    const name = `${c.first} ${c.last}`;

    // Checkout (no service yet): order + lines + addresses, customer via service, reservations via service.
    const order = await db.$transaction(async (tx) => {
      const customer = await findOrCreateGuestCustomer(tx, tenantId, { email: customerEmail(c), name, phone: c.phone });
      if (!customer.notes) await tx.customer.update({ where: { id: customer.id }, data: { notes: `${DEMO_MARK} seeded by scripts/seed-demo.ts` } });
      if (!customerFirst.has(customer.id)) customerFirst.set(customer.id, plan.placedAt);
      const number = await nextSequenceValue(tx, tenantId, "order.number");
      const o = await tx.order.create({
        data: {
          tenantId,
          number,
          customerId: customer.id,
          email: customer.email,
          customerName: name,
          phone: c.phone,
          currency: "EUR",
          subtotal,
          shippingTotal,
          total: subtotal + shippingTotal,
          paymentMethod: plan.method,
          shippingMethod: option.isPickup ? "PICKUP" : "SHIP",
          shippingZoneId: option.zoneId,
          shippingZoneName: option.name,
          shippingWeightGrams: weight,
          placedAt,
          createdAt: placedAt,
          customerNote: chance(0.15) ? pick(NOTES) : null,
          legacyData: { demo: true, insured: !!insured },
          lines: {
            create: plan.products.map((p, i) => ({
              tenantId,
              productId: p.id,
              title: p.item.title,
              stockCode: p.stockCode,
              imagePath: p.imagePath,
              unitPrice: p.price,
              quantity: 1,
              lineTotal: p.price,
              purchasePriceSnapshot: p.purchasePrice,
              sortOrder: i,
              createdAt: placedAt,
            })),
          },
        },
      });
      const address = { firstName: c.first, lastName: c.last, street: c.street, houseNumber: c.nr, postalCode: c.postal, city: c.city, countryCode: c.country, phone: c.phone };
      await tx.orderAddress.create({ data: { tenantId, orderId: o.id, type: "BILLING", ...address } });
      if (!option.isPickup) await tx.orderAddress.create({ data: { tenantId, orderId: o.id, type: "SHIPPING", ...address } });
      for (const p of plan.products) await reserveProduct({ tenantId, productId: p.id, orderId: o.id, minutes: 15 }, tx);
      return o;
    });

    // Payment flow through the real commands.
    const t = { paid: 0, fail: 0, packed: 0, shipped: 0, delivered: 0, archived: 0, canceled: 0, note: 0 };
    const mollie = async (status: "paid" | "failed" | "expired" | "canceled" | "open", whenMs: number) => {
      const pid = `tr_demo${hex(5)}`;
      await db.payment.create({
        data: {
          tenantId,
          orderId: order.id,
          provider: "MOLLIE",
          providerPaymentId: pid,
          method: plan.method,
          status: "OPEN",
          amount: order.total,
          currency: "EUR",
          checkoutUrl: `https://www.mollie.com/checkout/select-method/${pid.slice(3)}`,
          expiresAt: new Date(plan.placedAt + 15 * MIN),
          createdAt: new Date(plan.placedAt + 30_000),
        },
      });
      if (status !== "open") {
        await applyMolliePaymentStatus(tenantId, pid, status, {
          method: plan.method,
          paidAt: status === "paid" ? at(whenMs) : null,
          raw: { resource: "payment", id: pid, mode: "test", status, method: plan.method, demo: true },
        });
      }
    };

    let outcome: string;
    switch (plan.outcome) {
      case "PAID_MOLLIE":
        t.paid = plan.placedAt + int(1, 6) * MIN;
        await mollie("paid", t.paid);
        outcome = "PAID";
        break;
      case "PAID_MANUAL":
        t.paid = Math.max(plan.placedAt + 30 * MIN, Math.min(plan.placedAt + int(18, 70) * HOUR, NOW - 2 * HOUR));
        await markPaidManually(ctx, order.id, "Bank transfer received");
        outcome = "PAID";
        break;
      case "PENDING_TRANSFER":
        outcome = "PENDING";
        break;
      case "PENDING_OPEN":
        await mollie("open", plan.placedAt);
        outcome = "PENDING";
        break;
      case "FAILED":
        t.fail = plan.placedAt + int(2, 9) * MIN;
        await mollie("failed", t.fail);
        outcome = "FAILED";
        break;
      case "EXPIRED":
        t.fail = plan.placedAt + 15 * MIN + int(0, 4) * MIN;
        await mollie("expired", t.fail);
        outcome = "EXPIRED";
        break;
      case "MOLLIE_CANCELED":
        t.fail = plan.placedAt + int(1, 4) * MIN;
        await mollie("canceled", t.fail);
        outcome = "CANCELED";
        break;
      case "ADMIN_CANCELED":
        t.canceled = Math.min(plan.placedAt + int(10, 15) * DAY, NOW - HOUR);
        await cancelOrder(ctx, order.id, "No payment received within 10 days");
        outcome = "CANCELED (admin)";
        break;
    }

    // Fulfillment by age.
    if (t.paid) {
      revenue += subtotal;
      const country = plan.customer.country;
      const far = !["NL", "BE", "LU"].includes(country);
      const packed = t.paid + between(3, 30) * HOUR;
      const shipped = packed + between(1, 6) * HOUR;
      const delivered = option.isPickup ? packed + between(1, 5) * DAY : shipped + (far ? between(3, 8) : between(0.7, 2.5)) * DAY;
      if (packed < NOW) {
        t.packed = packed;
        await setFulfillmentStatus(ctx, order.id, { status: "PACKED" });
      }
      if (!option.isPickup && shipped < NOW) {
        t.shipped = shipped;
        const carrier = CARRIERS[country] ?? CARRIERS.XX;
        const code = carrier.code();
        await setFulfillmentStatus(ctx, order.id, { status: "SHIPPED", carrier: carrier.carrier, trackingNumber: code, trackingUrl: carrier.url(code, plan.customer.postal, country) });
      }
      if (delivered < NOW) {
        t.delivered = delivered;
        await setFulfillmentStatus(ctx, order.id, { status: "DELIVERED" });
      }
      const archiveAt = delivered + 21 * DAY;
      if (t.delivered && archiveAt < NOW - 30 * DAY && chance(0.6)) {
        t.archived = archiveAt;
        await archiveOrder(ctx, order.id);
      }
    }
    if (idx % 9 === 4) {
      t.note = plan.placedAt + between(2, 20) * HOUR;
      await addOrderNote(ctx, order.id, pick(["Customer called, asked about combined shipping.", "Sent extra photos of the markings by mail.", "Repeat customer — add a small thank-you card."]));
    }

    await backdateOrder(tenantId, order.id, plan, t);
    byStatus[outcome] = (byStatus[outcome] ?? 0) + 1;
    progress(`  orders ${idx + 1}/${plans.length}`);
  }
  progress("\n");

  for (const [id, first] of customerFirst) await db.customer.update({ where: { id }, data: { createdAt: at(first) } });
  return { orders: plans.length, byStatus, revenue, firstOrderAt, customers: customerFirst.size };
}

/** Moves every timestamp the services stamped with now() back to the planned moment. */
async function backdateOrder(
  tenantId: string,
  orderId: string,
  plan: OrderPlan,
  t: { paid: number; fail: number; packed: number; shipped: number; delivered: number; archived: number; canceled: number; note: number },
) {
  const placed = plan.placedAt;
  const o = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  await db.order.update({
    where: { id: orderId },
    data: {
      placedAt: at(placed),
      createdAt: at(placed),
      paidAt: t.paid ? at(t.paid) : o.paidAt,
      finalizedAt: o.finalizedAt && t.paid ? at(t.paid + 2000) : o.finalizedAt,
      confirmationSentAt: o.confirmationSentAt && t.paid ? at(t.paid + 4000) : o.confirmationSentAt,
      shippedAt: t.shipped ? at(t.shipped) : o.shippedAt && t.delivered ? at(t.delivered) : o.shippedAt,
      deliveredAt: t.delivered ? at(t.delivered) : o.deliveredAt,
      canceledAt: t.canceled ? at(t.canceled) : o.canceledAt ? at(t.fail || placed) : null,
      archivedAt: t.archived ? at(t.archived) : o.archivedAt,
      updatedAt: at(Math.max(placed, t.paid, t.fail, t.packed, t.shipped, t.delivered, t.archived, t.canceled, t.note)),
    },
  });

  const payments = await db.payment.findMany({ where: { orderId } });
  for (const p of payments) {
    const end = p.status === "PAID" ? t.paid : t.fail || null;
    await db.payment.update({
      where: { id: p.id },
      data: {
        createdAt: at(p.provider === "MANUAL" ? t.paid : placed + 30_000),
        updatedAt: at(end ?? placed + 30_000),
        paidAt: p.paidAt ? at(t.paid) : null,
        failedAt: p.failedAt ? at(t.fail) : null,
        expiredAt: p.expiredAt ? at(t.fail) : null,
        canceledAt: p.canceledAt ? at(t.fail) : null,
        expiresAt: p.provider === "MOLLIE" ? at(placed + 15 * MIN) : null,
      },
    });
  }

  const eventTime: Record<string, number> = {
    "payment.paid": t.paid,
    finalized: t.paid + 2000,
    confirmation_queued: t.paid + 3000,
    "payment.failed": t.fail,
    "payment.expired": t.fail,
    "payment.canceled": t.fail,
    "reservations.released": t.fail + 1000,
    canceled: t.canceled,
    "fulfillment.packed": t.packed,
    "fulfillment.shipped": t.shipped,
    "fulfillment.delivered": t.delivered,
    archived: t.archived,
    note: t.note,
  };
  const events = await db.orderEvent.findMany({ where: { orderId }, select: { id: true, type: true } });
  for (const e of events) {
    const ms = eventTime[e.type];
    if (ms) await db.orderEvent.update({ where: { id: e.id }, data: { createdAt: at(ms) } });
  }

  // Stock + reservations + products sold through this order.
  if (t.paid) {
    await db.stockMovement.updateMany({ where: { orderId }, data: { createdAt: at(t.paid + 1000) } });
    await db.product.updateMany({ where: { tenantId, id: { in: plan.products.map((p) => p.id) }, status: "SOLD" }, data: { soldAt: at(t.paid + 1000) } });
  }
  const resEnd = t.paid || t.fail || t.canceled || placed + 15 * MIN;
  await db.reservation.updateMany({ where: { orderId, status: { not: "ACTIVE" } }, data: { createdAt: at(placed), expiresAt: at(placed + 15 * MIN), releasedAt: at(resEnd) } });
  // Holds of still-pending orders lapsed long ago (15 min) — the sweeper would have expired them.
  await db.reservation.updateMany({
    where: { orderId, status: "ACTIVE" },
    data: { status: "EXPIRED", createdAt: at(placed), expiresAt: at(placed + 15 * MIN), releasedAt: at(placed + 16 * MIN) },
  });
}

// ─── Content ────────────────────────────────────────────────────────────────

async function seedHomePage(ctx: ServiceContext, spec: TenantSpec): Promise<string> {
  const home = await db.contentPage.findFirst({ where: { tenantId: ctx.tenantId, systemKey: "HOME" }, include: { blocks: { orderBy: { sortOrder: "asc" } } } });
  if (!home) return "missing";
  if (home.publishedAt) return "already published";
  const hero = home.blocks.find((b) => b.type === "HERO");
  if (hero) {
    await updateBlock(ctx, hero.id, {
      data: {
        title: "Original militaria, honestly described",
        subtitle: "Helmets, uniforms, insignia and documents from WW1 to the Cold War — every item checked, measured and photographed.",
        imageKey: null,
        cta: { label: "Browse the shop", href: "/shop" },
      },
    });
  }
  const newItems = home.blocks.find((b) => b.type === "NEW_ITEMS");
  if (newItems) await updateBlock(ctx, newItems.id, { data: { title: "New arrivals", count: 8, cta: { label: "View all", href: "/shop" } } });
  await addBlock(ctx, home.id, {
    type: "TESTIMONIAL",
    data: { quote: "The M34 helmet arrived double-boxed and exactly as described. Third purchase, won't be the last.", author: "Pieter, Amersfoort", link: null },
  });
  if (spec.newsletter) {
    await addBlock(ctx, home.id, { type: "NEWSLETTER_SIGNUP", data: { title: "Never miss a new arrival", text: "One e-mail when new items are listed. No spam, unsubscribe any time." } });
  }
  await updatePage(ctx, home.id, { published: true });
  return "yes";
}

// ─── Newsletter ─────────────────────────────────────────────────────────────

async function seedNewsletter(ctx: ServiceContext, spec: TenantSpec) {
  const tenantId = ctx.tenantId;
  const emails = subscriberEmails(spec);
  // No service creates confirmed subscribers (subscribe() sends a double-opt-in mail), so insert directly.
  const customers = await db.customer.findMany({ where: { tenantId, email: { in: emails } }, select: { id: true, email: true } });
  let i = 0;
  const rows: Prisma.NewsletterSubscriberCreateManyInput[] = emails.map((email) => {
    const k = i++;
    const createdAt = NOW - int(2, 160) * DAY - int(0, 23) * HOUR;
    const status = k % 6 === 5 ? "pending" : k % 7 === 6 ? "unsubscribed" : "active";
    const confirmedAt = status === "pending" ? null : new Date(createdAt + int(2, 90) * MIN);
    return {
      tenantId,
      email,
      customerId: customers.find((c) => c.email === email)?.id ?? null,
      source: pick(["footer", "footer", "checkout", "popup"]),
      createdAt: new Date(createdAt),
      confirmSentAt: new Date(createdAt),
      confirmTokenHash: status === "pending" ? createHash("sha256").update(`demo-confirm-${email}-${hex(8)}`).digest("hex") : null,
      confirmedAt,
      unsubscribedAt: status === "unsubscribed" ? new Date(Math.min(createdAt + int(10, 60) * DAY, NOW - DAY)) : null,
    };
  });
  const { count } = await db.newsletterSubscriber.createMany({ data: rows, skipDuplicates: true });

  let campaigns = 0;
  for (const c of DEMO_CAMPAIGNS) {
    const row = await createCampaign(ctx, { subject: c.subject, body: c.body });
    campaigns++;
    if (c.sent) {
      // Sending needs the worker + SMTP; record the outcome of a finished send instead.
      const sentAt = new Date(NOW - 23 * DAY + 10 * HOUR);
      const recipients = await db.newsletterSubscriber.count({ where: { tenantId, confirmedAt: { not: null, lte: sentAt }, OR: [{ unsubscribedAt: null }, { unsubscribedAt: { gt: sentAt } }] } });
      await db.newsletterCampaign.update({
        where: { id: row.id },
        data: { status: "SENT", sentAt, recipientCount: recipients, sentCount: recipients - 1, failedCount: 1, createdAt: new Date(sentAt.getTime() - 2 * DAY), updatedAt: sentAt },
      });
    } else {
      await db.newsletterCampaign.update({ where: { id: row.id }, data: { createdAt: new Date(NOW - 2 * DAY) } });
    }
  }
  return { subscribers: count, campaigns };
}

// ─── Page views ─────────────────────────────────────────────────────────────

async function seedPageViews(tenantId: string, spec: TenantSpec, products: CreatedProduct[]) {
  const catSlugs = await db.category.findMany({ where: { tenantId }, select: { slug: true } });
  const productPaths = products.filter((p) => p.final !== "DRAFT").map((p) => `/product/${p.stockCode}/${p.slug}`);
  const staticPaths = ["/", "/", "/", "/shop", "/shop", "/contact", "/about", "/terms"];
  const referrers = [null, null, null, null, "www.google.com", "www.google.com", "www.google.nl", "www.bing.com", "duckduckgo.com", "www.facebook.com", "www.marktplaats.nl", "www.wehrmacht-awards.com"];
  const countries = ["NL", "NL", "NL", "NL", "NL", "BE", "BE", "DE", "DE", "FR", "GB", "US", null];
  const DOW_FACTOR = [1.45, 1.05, 0.9, 0.95, 1.0, 0.85, 1.2]; // Sun..Sat
  const rows: Prisma.PageViewCreateManyInput[] = [];
  for (let d = spec.pageViewDays - 1; d >= 0; d--) {
    const dayStart = NOW - d * DAY;
    const dow = new Date(dayStart).getDay();
    const trend = 0.85 + 0.3 * (1 - d / spec.pageViewDays);
    const visitors = Math.max(1, Math.round(spec.visitorsPerDay * DOW_FACTOR[dow] * trend * between(0.8, 1.2)));
    for (let v = 0; v < visitors; v++) {
      const hash = `demo${hex(14)}`;
      const hour = pick([8, 9, 10, 12, 12, 13, 14, 16, 17, 19, 20, 20, 21, 21, 22, 23]);
      let ts = dayStart - (d === 0 ? int(0, 600) * MIN : 0);
      ts = new Date(ts).setHours(hour, int(0, 59), int(0, 59));
      if (ts > NOW) ts = NOW - int(1, 300) * MIN;
      const referrerHost = pick(referrers);
      const countryCode = pick(countries);
      const views = int(1, 7);
      for (let k = 0; k < views; k++) {
        const path = k === 0 && referrerHost ? pick([...productPaths, "/"]) : chance(0.55) ? pick(productPaths) : chance(0.4) && catSlugs.length ? `/shop/${pick(catSlugs).slug}` : pick(staticPaths);
        rows.push({ tenantId, path, referrerHost: k === 0 ? referrerHost : null, countryCode, visitorHash: hash, createdAt: new Date(ts + k * int(20, 180) * 1000) });
      }
    }
  }
  for (let i = 0; i < rows.length; i += 2000) await db.pageView.createMany({ data: rows.slice(i, i + 2000) });
  return rows.length;
}

// ─── Main ───────────────────────────────────────────────────────────────────

function printSummary(summaries: Summary[]) {
  if (!summaries.length) return;
  const keys = [...new Set(summaries.flatMap((s) => Object.keys(s)))].filter((k) => k !== "tenant");
  const w0 = Math.max(...keys.map((k) => k.length), 8);
  const cols = summaries.map((s) => Math.max(String(s.tenant).length, ...keys.map((k) => String(s[k] ?? "").length)));
  const line = (label: string, vals: string[]) => `${label.padEnd(w0)} │ ${vals.map((v, i) => v.padStart(cols[i])).join(" │ ")}`;
  console.log(`\n${line("", summaries.map((s) => String(s.tenant)))}`);
  console.log(`${"─".repeat(w0)}─┼─${cols.map((c) => "─".repeat(c)).join("─┼─")}`);
  for (const k of keys) console.log(line(k, summaries.map((s) => String(s[k] ?? "–"))));
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to seed demo data with NODE_ENV=production.");
    process.exitCode = 1;
    return;
  }
  await loadServices();
  console.log("Quartermaster demo data");
  const summaries: Summary[] = [];
  for (const spec of [CONCEPT, VELDPOST]) {
    const s = await seedTenant(spec);
    if (s) summaries.push(s);
  }
  if (!summaries.length) console.log("demo data already present");
  printSummary(summaries);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (stopBoss) await stopBoss().catch(() => undefined);
    if (db) await db.$disconnect();
    rmSync(path.dirname(NEXT_HEADERS_STUB), { recursive: true, force: true });
  });

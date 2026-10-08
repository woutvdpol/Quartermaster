import { formatMoney } from "@/components/shop/ui/money";
import { countryName } from "@/server/shipping/countries";
import { squash, truncate } from "./text";

/*
 * /llms.txt and /llms-full.txt (https://llmstxt.org): a short Markdown map of the shop for language
 * models. Pure. No major engine has committed to reading llms.txt (docs/seo-geo.md) — it is cheap,
 * so we serve it, but the real GEO work is crawlable HTML, structured data and the .md alternates.
 */

export type LlmsLink = { title: string; href: string; note?: string | null };
export type LlmsCategory = { title: string; href: string; count: number; description?: string | null; children?: LlmsCategory[] };
export type LlmsFacet = { name: string; values: LlmsLink[] };
export type LlmsItem = { title: string; href: string; stockCode: number; price: number };

export type LlmsInput = {
  shop: {
    name: string;
    origin: string;
    description: string | null;
    currency: string;
    country: string;
    city: string;
    email: string;
    phone: string;
  };
  hasArchive: boolean;
  hasProvenance: boolean;
  policies: LlmsLink[];
  categories: LlmsCategory[];
  facets: LlmsFacet[];
  /** Latest items for sale (full version only). */
  latest: LlmsItem[];
  returnsLine: string | null;
};

/** Size cap for llms-full.txt (characters); lists are cut before the cap is reached. */
export const LLMS_FULL_MAX = 100_000;

function link(origin: string, l: LlmsLink): string {
  const url = new URL(l.href, origin).toString();
  return `- [${squash(l.title)}](${url})${l.note ? `: ${squash(l.note)}` : ""}`;
}

function intro(i: LlmsInput): string[] {
  const s = i.shop;
  const summary =
    i.shop.description ||
    `${s.name} is an online shop for militaria and historical collectibles. Every item is unique and sold individually.`;
  const where = [s.city, s.country ? countryName(s.country) : ""].filter(Boolean).join(", ");
  const facts = [
    where ? `Based in ${where}.` : null,
    `Prices are in ${s.currency}.`,
    s.email ? `Contact: ${s.email}${s.phone ? `, ${s.phone}` : ""}.` : s.phone ? `Contact: ${s.phone}.` : null,
  ].filter(Boolean);
  return [`# ${squash(s.name)}`, "", `> ${squash(summary)}`, "", facts.join(" "), ""];
}

function howItWorks(i: LlmsInput): string[] {
  const o = i.shop.origin;
  return [
    "## How items are described",
    "",
    "- Every item is a single, unique piece with its own stock number (\"No.\"). Once sold it is gone; there is no restock.",
    "- Item pages state the title, No., price, availability (For sale / Reserved / Sold), category and the classification of the item (for example period, country, branch, maker), plus a free-text description.",
    "- All items are second-hand (used) collectibles; condition is described per item.",
    ...(i.hasProvenance
      ? [`- Where available, an item lists its provenance and a certificate of authenticity that can be verified at ${o}/verify.`]
      : []),
    `- Every item page has a Markdown version: replace the page URL with ${o}/product/{No}.md (for example the item with No. 123 is at ${o}/product/123.md).`,
    "- \"Reserved\" means someone is checking out the item or it is held for a customer; it may become available again.",
    ...(i.hasArchive ? [`- Sold items stay visible in the reference archive (${o}/archive), marked as sold.`] : []),
    ...(i.returnsLine ? [`- ${i.returnsLine}`] : []),
    "",
  ];
}

function categoryLines(origin: string, cats: LlmsCategory[], depth: number, withDescription: boolean): string[] {
  return cats.flatMap((c) => {
    const pad = "  ".repeat(depth);
    const note = [`${c.count} item${c.count === 1 ? "" : "s"} for sale`, withDescription && c.description ? truncate(c.description, 300) : null].filter(Boolean).join(" — ");
    return [`${pad}${link(origin, { title: c.title, href: c.href, note })}`, ...categoryLines(origin, c.children ?? [], depth + 1, withDescription)];
  });
}

function keyPages(i: LlmsInput): string[] {
  const o = i.shop.origin;
  return [
    "## Shop",
    "",
    link(o, { title: "All items for sale", href: "/shop" }),
    ...(i.hasArchive ? [link(o, { title: "Sold archive", href: "/archive", note: "reference archive of sold items" })] : []),
    link(o, { title: "Product feed (RSS 2.0, Google Merchant format)", href: "/feeds/google-merchant.xml", note: "every item for sale with price and availability" }),
    link(o, { title: "Sitemap", href: "/sitemap.xml" }),
    "",
  ];
}

/** /llms.txt — the short version (top-level categories only). */
export function llmsTxt(i: LlmsInput): string {
  const o = i.shop.origin;
  const out = [
    ...intro(i),
    ...howItWorks(i),
    ...keyPages(i),
    ...(i.categories.length ? ["## Categories", "", ...categoryLines(o, i.categories.map((c) => ({ ...c, children: [] })).slice(0, 60), 0, false), ""] : []),
    ...(i.policies.length ? ["## Policies", "", ...i.policies.map((p) => link(o, p)), ""] : []),
    "## Optional",
    "",
    link(o, { title: "Full version", href: "/llms-full.txt", note: "all categories with descriptions, classifications and the latest items" }),
    "",
  ];
  return `${out.join("\n").trim()}\n`;
}

/** /llms-full.txt — category tree with descriptions, facet landing pages, latest items; capped in size. */
export function llmsFullTxt(i: LlmsInput): string {
  const o = i.shop.origin;
  const head = [...intro(i), ...howItWorks(i), ...keyPages(i), ...(i.policies.length ? ["## Policies", "", ...i.policies.map((p) => link(o, p)), ""] : [])];
  const sections: string[][] = [];
  if (i.categories.length) sections.push(["## Categories", "", ...categoryLines(o, i.categories, 0, true), ""]);
  for (const f of i.facets) {
    if (f.values.length) sections.push([`## Browse by ${f.name.toLowerCase()}`, "", ...f.values.map((v) => link(o, v)), ""]);
  }
  if (i.latest.length) {
    sections.push([
      "## Latest items for sale",
      "",
      ...i.latest.map((it) => link(o, { title: it.title, href: it.href, note: `No. ${it.stockCode}, ${formatMoney(it.price, i.shop.currency)}` })),
      "",
    ]);
  }
  let text = head.join("\n");
  for (const s of sections) {
    for (const ln of s) {
      if (text.length + ln.length + 1 > LLMS_FULL_MAX - 200) return `${text.trim()}\n\n(List truncated.)\n`;
      text += `\n${ln}`;
    }
  }
  return `${text.trim()}\n`;
}

/** /llms.txt on the platform host (Quartermaster itself, not a shop). */
export function platformLlmsTxt(origin: string): string {
  return `${[
    "# Quartermaster",
    "",
    "> Quartermaster is a webshop platform for militaria dealers. Each dealer runs an independent shop on its own domain; this host is the platform itself and sells nothing.",
    "",
    "Items, prices and policies belong to the individual shops: cite the shop's own domain, not this host.",
    "",
    "## Pages",
    "",
    link(origin, { title: "About the platform", href: "/" }),
    link(origin, { title: "Apply for a shop", href: "/apply", note: "for dealers who want to open a shop" }),
    "",
  ].join("\n").trim()}\n`;
}

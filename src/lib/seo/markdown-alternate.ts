import { formatMoney } from "@/components/shop/ui/money";
import { provenanceCopy } from "@/server/provenance/copy";
import { countryName } from "@/server/shipping/countries";
import type { PublicBlock } from "@/server/content/pages";
import type { PublicProduct, PublicStatus } from "@/server/storefront-catalog/types";
import { squash } from "./text";

/*
 * Markdown versions of product and CMS pages for AI assistants / answer engines (GEO). Pure.
 * Served at /product/{No}.md and /{slug}.md (rewrites in next.config.ts → src/app/md/**) and
 * announced with <link rel="alternate" type="text/markdown">. The HTML page stays canonical
 * (route handlers send `Link: <html>; rel="canonical"`).
 *
 * Product pages use one predictable layout so facts can be quoted reliably:
 *   # Title / key-value facts list / ## Description / ## Provenance / ## Shipping and returns
 */

export const STATUS_LABEL: Record<PublicStatus, string> = { available: "For sale", reserved: "Reserved", sold: "Sold" };

export type ProductMarkdownInput = {
  shop: { name: string; origin: string; currency: string; country: string };
  product: PublicProduct;
  status: PublicStatus;
  /** Sold items show their price only with Product.showSoldPrice (docs/sold-archive.md). */
  showPrice: boolean;
  /** Sold items: the month of sale ("Oct 2026"), shown with the availability. */
  soldMonth?: string | null;
  /** Images may be omitted (compliance blur in the visitor's country). */
  showImages: boolean;
  provenance: { text: string | null; certificateIncluded: boolean; authenticityGuaranteed: boolean } | null;
  /** e.g. "Delivery to Netherlands from €12.50". */
  shippingLines: string[];
  /** e.g. "Returns accepted within 14 days of delivery; return shipping paid by the buyer." */
  returnsLine: string | null;
  disclaimer: string | null;
};

const line = (label: string, value: string | null | undefined) => (value && squash(value) ? `- **${label}:** ${squash(value)}` : null);

/**
 * Free-text specification rows that are not already covered by a facet with the same label (the
 * product page hides those too), plus the "Condition" row split off (it extends the condition fact).
 */
export function productSpecs(p: Pick<PublicProduct, "facets" | "specifications">): { condition: string | null; specs: PublicProduct["specifications"] } {
  const facetLabels = new Set(p.facets.map((f) => f.facet.name.trim().toLowerCase()));
  const own = p.specifications.filter((s) => !facetLabels.has(s.label.trim().toLowerCase()));
  const condition = own.find((s) => s.label.trim().toLowerCase() === "condition")?.value ?? null;
  return { condition, specs: own.filter((s) => s.label.trim().toLowerCase() !== "condition") };
}

export function productMarkdown(i: ProductMarkdownInput): string {
  const p = i.product;
  const url = new URL(p.href, i.shop.origin).toString();
  const { condition, specs } = productSpecs(p);
  const facts = [
    line("No.", String(p.stockCode)),
    p.sku && p.sku !== String(p.stockCode) ? line("SKU", p.sku) : null,
    // Sold: no price on offer — only the sold price, when the dealer shows it for this item.
    i.status === "sold"
      ? i.showPrice
        ? line("Sold for", `${formatMoney(p.price, i.shop.currency)} (${i.shop.currency})`)
        : null
      : line("Price", i.showPrice ? `${formatMoney(p.price, i.shop.currency)} (${i.shop.currency})` : "Not shown"),
    line("Availability", i.status === "sold" ? `Sold${i.soldMonth ? ` (${i.soldMonth})` : ""}; no longer for sale, kept as a reference` : STATUS_LABEL[i.status]),
    line("Condition", `Used${condition ? ` — ${condition}` : ""}; unique item (one piece)`),
    line("Category", p.categoryPath.map((c) => c.title).join(" > ") || null),
    ...p.facets.map((f) => line(f.facet.name, f.values.map((v) => v.path.join(" › ")).join(", "))),
    ...specs.map((s) => line(s.label, s.value)),
    p.weightGrams > 0 ? line("Shipping weight", `${p.weightGrams} g`) : null,
    p.ageRestricted ? line("Age restriction", "Adults only") : null,
    line("Seller", `${i.shop.name} (${i.shop.origin}), ships from ${countryName(i.shop.country)}`),
    line("URL", url),
  ].filter(Boolean);

  const out = [`# ${squash(p.title)}`, "", ...facts, ""];
  if (p.description?.trim()) out.push("## Description", "", p.description.trim(), "");
  if (i.provenance && (i.provenance.text || i.provenance.certificateIncluded || i.provenance.authenticityGuaranteed)) {
    out.push("## Provenance and authenticity", "");
    if (i.provenance.text) out.push(i.provenance.text.trim(), "");
    if (i.provenance.certificateIncluded) out.push("- Certificate of authenticity included (verifiable at " + new URL("/verify", i.shop.origin).toString() + ")");
    if (i.provenance.authenticityGuaranteed) out.push(`- Lifetime authenticity guarantee: ${provenanceCopy.guaranteeText}`);
    out.push("");
  }
  if (i.shippingLines.length || i.returnsLine) {
    out.push("## Shipping and returns", "");
    for (const s of i.shippingLines) out.push(`- ${s}`);
    if (i.returnsLine) out.push(`- ${i.returnsLine}`);
    out.push("");
  }
  if (i.showImages && p.images.length) {
    out.push("## Photos", "");
    p.images.slice(0, 10).forEach((img, n) => out.push(`- ![${squash(img.alt ?? `${p.title} — photo ${n + 1}`)}](${new URL(img.large, i.shop.origin).toString()})`));
    out.push("");
  }
  if (i.disclaimer) out.push("---", "", squash(i.disclaimer), "");
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/** Plain-language returns summary from the returns settings, or null when none is published. */
export function returnsSummary(r: { days: number; fees: "customer" | "free" } | null): string | null {
  if (!r) return null;
  if (r.days <= 0) return "Returns are not accepted.";
  return `Returns accepted within ${r.days} days of delivery; ${r.fees === "free" ? "free return shipping" : "return shipping paid by the buyer"}.`;
}

/** A published CMS page as Markdown (text-bearing blocks only, in page order). */
export function pageMarkdown(input: { title: string; url: string; blocks: PublicBlock[]; shopName: string }): string {
  const out = [`# ${squash(input.title)}`, "", `Source: ${input.url} (${input.shopName})`, ""];
  for (const b of input.blocks) {
    const d = b.data as Record<string, unknown>;
    const text = (k: string) => (typeof d[k] === "string" && (d[k] as string).trim() ? (d[k] as string).trim() : null);
    switch (b.type) {
      case "HERO":
      case "CTA":
      case "NEWSLETTER_SIGNUP": {
        const t = text("title");
        if (t) out.push(`## ${t}`, "");
        const body = text("subtitle") ?? text("text");
        if (body) out.push(body, "");
        break;
      }
      case "QUOTE":
      case "TESTIMONIAL": {
        const q = text("quote");
        if (q) out.push(`> ${q.replace(/\n/g, "\n> ")}`, ...(text("author") ? [`> — ${text("author")}`] : []), "");
        break;
      }
      case "FAQ": {
        // Every question is a heading so each answer can be quoted on its own (### under a block title).
        const t = text("title");
        if (t) out.push(`## ${t}`, "");
        for (const it of b.data.items) out.push(`${t ? "###" : "##"} ${squash(it.question)}`, "", it.answer.trim(), "");
        break;
      }
      default: {
        const t = text("title");
        if (t) out.push(`## ${t}`, "");
        const md = text("markdown");
        if (md) out.push(md, "");
      }
    }
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

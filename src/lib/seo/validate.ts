/*
 * Minimal structured-data checks (pure): extracts JSON-LD from HTML and verifies the fields Google
 * marks as *required* for the rich results we target (developers.google.com/search/docs/appearance/
 * structured-data: Product snippets / merchant listings, Organization, BreadcrumbList, ItemList,
 * FAQPage).
 * Used by unit tests and scripts/seo/validate-jsonld.ts. Not a replacement for Google's Rich Results
 * Test — it catches regressions (missing price, relative URLs, broken JSON) early.
 */

export type JsonLdNode = Record<string, unknown>;

/** Every `<script type="application/ld+json">` block of a page, parsed (throws on invalid JSON). */
export function extractJsonLd(html: string): JsonLdNode[] {
  const out: JsonLdNode[] = [];
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const data = JSON.parse(m[1]) as JsonLdNode | JsonLdNode[];
    for (const node of Array.isArray(data) ? data : [data]) {
      if (Array.isArray(node["@graph"])) out.push(...(node["@graph"] as JsonLdNode[]));
      else out.push(node);
    }
  }
  return out;
}

/** ItemAvailability values Google's merchant listings accept (schema.org's "Reserved" is not one). */
const GOOGLE_AVAILABILITY = new Set(["BackOrder", "Discontinued", "InStock", "InStoreOnly", "LimitedAvailability", "OnlineOnly", "OutOfStock", "PreOrder", "PreSale", "SoldOut"]);

const isAbsUrl = (v: unknown) => typeof v === "string" && /^https?:\/\/[^/]+/.test(v);
const nonEmpty = (v: unknown) => (typeof v === "string" ? v.trim().length > 0 : v !== undefined && v !== null);

/** Problems found in one node ([] = fine). Unknown types are not checked. */
export function validateJsonLd(node: JsonLdNode): string[] {
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => {
    if (!cond) errors.push(`${String(node["@type"])}: ${msg}`);
  };
  const type = node["@type"];
  need(node["@context"] === "https://schema.org" || node["@context"] === undefined, "@context must be https://schema.org");
  switch (type) {
    case "Product": {
      need(nonEmpty(node.name), "name is required");
      need(isAbsUrl(node.url), "url must be absolute");
      const images = node.image as unknown[] | undefined;
      need(images === undefined || (Array.isArray(images) && images.every(isAbsUrl)), "images must be absolute URLs");
      const offer = node.offers as JsonLdNode | undefined;
      if (offer) {
        need(offer["@type"] === "Offer", "offers must be an Offer");
        need(typeof offer.price === "string" && /^\d+(\.\d+)?$/.test(offer.price), "offers.price must be a decimal");
        need(typeof offer.priceCurrency === "string" && /^[A-Z]{3}$/.test(offer.priceCurrency), "offers.priceCurrency must be ISO 4217");
        need(typeof offer.availability === "string" && GOOGLE_AVAILABILITY.has(offer.availability.replace("https://schema.org/", "")), "offers.availability must be a value Google supports");
        need(images !== undefined && images.length > 0, "merchant listings need at least one image");
      }
      break;
    }
    case "Organization":
    case "OnlineStore": {
      need(nonEmpty(node.name), "name is required");
      need(isAbsUrl(node.url), "url must be absolute");
      if (node.logo) need(isAbsUrl((node.logo as JsonLdNode).url), "logo.url must be absolute");
      break;
    }
    case "WebSite": {
      need(nonEmpty(node.name) && isAbsUrl(node.url), "name and absolute url are required");
      break;
    }
    case "BreadcrumbList": {
      const items = node.itemListElement as JsonLdNode[] | undefined;
      need(Array.isArray(items) && items.length > 0, "itemListElement is required");
      items?.forEach((it, i) => {
        need(it.position === i + 1, `item ${i + 1}: position must be ${i + 1}`);
        need(nonEmpty(it.name), `item ${i + 1}: name is required`);
        if (i < items.length - 1) need(isAbsUrl(it.item), `item ${i + 1}: item must be an absolute URL`);
      });
      break;
    }
    case "CollectionPage": {
      const list = node.mainEntity as JsonLdNode | undefined;
      need(list?.["@type"] === "ItemList", "mainEntity must be an ItemList");
      const items = (list?.itemListElement as JsonLdNode[] | undefined) ?? [];
      items.forEach((it, i) => need(it.position === i + 1 && isAbsUrl(it.url), `list item ${i + 1}: position + absolute url required`));
      break;
    }
    case "FAQPage": {
      const qs = node.mainEntity as JsonLdNode[] | undefined;
      need(Array.isArray(qs) && qs.length > 0, "mainEntity must be a non-empty list of Questions");
      qs?.forEach((q, i) => {
        const answer = q.acceptedAnswer as JsonLdNode | undefined;
        need(q["@type"] === "Question" && nonEmpty(q.name), `question ${i + 1}: Question with a name required`);
        need(answer?.["@type"] === "Answer" && nonEmpty(answer.text), `question ${i + 1}: acceptedAnswer.text required`);
      });
      break;
    }
  }
  return errors;
}

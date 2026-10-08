import { describe, expect, it } from "vitest";
import { collectionPageJsonLd, faqAnswerText, faqPageJsonLd, organizationJsonLd, productJsonLd, returnPolicyJsonLd, shippingDetailsJsonLd, websiteJsonLd } from "./json-ld";
import { extractJsonLd, validateJsonLd } from "./validate";
import { ORIGIN, ZONES, productFixture, shopFixture } from "./__tests__/fixtures";

const shop = shopFixture();

describe("organizationJsonLd", () => {
  it("describes the shop as an OnlineStore with NAP, logo, sameAs and return policy", () => {
    const org = organizationJsonLd(shop);
    expect(validateJsonLd(org)).toEqual([]);
    expect(org).toMatchObject({
      "@type": "OnlineStore",
      "@id": `${ORIGIN}/#organization`,
      name: "Example Militaria",
      url: `${ORIGIN}/`,
      logo: { url: `${ORIGIN}/uploads/t1/logo.png` },
      email: "info@shop.example",
      telephone: "+31 6 1234 5678",
      address: { "@type": "PostalAddress", streetAddress: "Dorpsstraat 1", postalCode: "1234 AB", addressLocality: "Utrecht", addressCountry: "NL" },
      contactPoint: { contactType: "customer service", email: "info@shop.example" },
      vatID: "NL123456789B01",
      sameAs: ["https://www.instagram.com/example"],
      hasMerchantReturnPolicy: { merchantReturnDays: 14 },
    });
  });

  it("omits empty fields instead of emitting blanks", () => {
    const org = organizationJsonLd(shopFixture({ email: "", phone: "", logoPath: null, sameAs: [], vatNumber: "", description: null, returns: null, address: { line1: "", line2: "", postalCode: "", city: "", country: "" } }));
    expect(Object.keys(org).sort()).toEqual(["@context", "@id", "@type", "name", "url"]);
  });
});

describe("websiteJsonLd", () => {
  it("has a SearchAction on the catalog search", () => {
    const site = websiteJsonLd(shop);
    expect(validateJsonLd(site)).toEqual([]);
    expect(site.potentialAction.target.urlTemplate).toBe(`${ORIGIN}/shop?q={search_term_string}`);
    expect(site.publisher).toEqual({ "@id": `${ORIGIN}/#organization` });
  });
});

describe("returnPolicyJsonLd", () => {
  it("maps days and fees", () => {
    expect(returnPolicyJsonLd({ days: 30, fees: "free", countries: ["NL", "XX", "NL"] })).toMatchObject({
      applicableCountry: ["NL"],
      returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
      merchantReturnDays: 30,
      returnFees: "https://schema.org/FreeReturn",
    });
    expect(returnPolicyJsonLd({ days: 0, fees: "customer", countries: ["NL"] }).returnPolicyCategory).toBe("https://schema.org/MerchantReturnNotPermitted");
  });
});

describe("shippingDetailsJsonLd", () => {
  const base = { weightGrams: 1200, price: 45000, freeShippingThreshold: 0, currency: "EUR" };

  it("uses the weight tier per zone and skips rest-of-world, pickup and inactive zones", () => {
    const out = shippingDetailsJsonLd(ZONES, base) as { shippingRate: { value: string }; shippingDestination: { addressCountry: string }[] }[];
    expect(out.map((o) => [o.shippingRate.value, o.shippingDestination.map((d) => d.addressCountry)])).toEqual([
      ["6.95", ["NL", "BE", "LU"]],
      ["19.50", ["DE", "FR"]],
    ]);
  });

  it("is free above the threshold and drops blocked countries / overweight zones", () => {
    const out = shippingDetailsJsonLd(ZONES, { ...base, weightGrams: 3000, freeShippingThreshold: 10000, blockedCountries: ["DE"] }) as {
      shippingRate: { value: string };
      shippingDestination: { addressCountry: string }[];
    }[];
    // Benelux tops out at 2 kg → skipped; Europe free, without DE.
    expect(out).toHaveLength(1);
    expect(out[0].shippingRate.value).toBe("0.00");
    expect(out[0].shippingDestination.map((d) => d.addressCountry)).toEqual(["FR"]);
  });
});

describe("productJsonLd", () => {
  const extras = { showPrice: true, shipping: shippingDetailsJsonLd(ZONES, { weightGrams: 1200, price: 45000, freeShippingThreshold: 0, currency: "EUR" }), returns: shop.returns };

  it("builds a valid Product + Offer with brand, condition and properties", () => {
    const ld = productJsonLd(shop, productFixture(), "available", extras);
    expect(validateJsonLd(ld)).toEqual([]);
    expect(ld).toMatchObject({
      "@type": "Product",
      "@id": `${ORIGIN}/product/1234/m35-helmet#product`,
      sku: "1234",
      productID: "1234",
      description: "Original M35 helmet with liner. Good condition.",
      image: [`${ORIGIN}/uploads/a/large.webp`, `${ORIGIN}/uploads/b/large.webp`],
      category: "Helmets > German",
      brand: { "@type": "Brand", name: "Quist" },
      countryOfOrigin: { name: "Germany" },
      itemCondition: "https://schema.org/UsedCondition",
      offers: {
        price: "450.00",
        priceCurrency: "EUR",
        availability: "https://schema.org/InStock",
        itemCondition: "https://schema.org/UsedCondition",
        seller: { "@id": `${ORIGIN}/#organization` },
        hasMerchantReturnPolicy: { merchantReturnDays: 14 },
      },
    });
    const props = (ld.additionalProperty as { name: string; value: string }[]).map((p) => `${p.name}=${p.value}`);
    // Facet-duplicated spec rows are dropped (like on the page); the maker is the brand.
    expect(props).toEqual(["Period=WW2", "Country=Germany", "Size=64", "Condition=Very good"]);
    expect(ld.offers && "shippingDetails" in ld.offers).toBe(true);
  });

  it.each([
    ["available", "https://schema.org/InStock"],
    ["reserved", "https://schema.org/OutOfStock"],
    ["sold", "https://schema.org/SoldOut"],
  ] as const)("maps %s to %s", (status, url) => {
    expect(productJsonLd(shop, productFixture({ status }), status, { showPrice: true }).offers?.availability).toBe(url);
  });

  it("leaves out the Offer for a sold item whose price is hidden", () => {
    const ld = productJsonLd(shop, productFixture({ status: "sold" }), "sold", { showPrice: false });
    expect(ld.offers).toBeUndefined();
    expect(validateJsonLd(ld)).toEqual([]);
  });

  it("uses zero-decimal currencies correctly", () => {
    expect(productJsonLd({ ...shop, currency: "JPY" }, productFixture({ price: 12000 }), "available", { showPrice: true }).offers?.price).toBe("12000");
  });

  it("emits no image when the photos are withheld", () => {
    const ld = productJsonLd(shop, productFixture({ images: [] }), "available", { showPrice: true });
    expect(ld.image).toBeUndefined();
    expect(validateJsonLd(ld)).toContain("Product: merchant listings need at least one image");
  });
});

describe("collectionPageJsonLd", () => {
  it("lists items with absolute URLs and positions", () => {
    const ld = collectionPageJsonLd({ origin: ORIGIN, path: "/shop/category/helmets", name: "Helmets", total: 40, items: [{ href: "/product/1/a", name: "A", image: "/uploads/x.webp" }, { href: "/product/2/b", name: "B" }] });
    expect(validateJsonLd(ld)).toEqual([]);
    expect(ld.mainEntity.numberOfItems).toBe(40);
    expect(ld.mainEntity.itemListElement[0]).toEqual({ "@type": "ListItem", position: 1, url: `${ORIGIN}/product/1/a`, name: "A", image: `${ORIGIN}/uploads/x.webp` });
  });
});

describe("extractJsonLd / validateJsonLd", () => {
  it("parses script blocks and flags relative URLs", () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"/"},{"@type":"ListItem","position":2,"name":"X"}]}</script>`;
    const [node] = extractJsonLd(html);
    expect(validateJsonLd(node)).toEqual(["BreadcrumbList: item 1: item must be an absolute URL"]);
  });
});

describe("faqPageJsonLd", () => {
  it("builds one valid FAQPage with Question/Answer pairs", () => {
    const node = faqPageJsonLd(
      [
        { question: "Do you  ship abroad?", answer: "Yes, worldwide." },
        { question: "How do returns work?", answer: "Within **14 days**. See [returns](/returns?x=1&y=2).\n\n- Email us\n- Send it back" },
      ],
      ORIGIN,
    );
    expect(node).not.toBeNull();
    expect(validateJsonLd(node!)).toEqual([]);
    expect(node).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: "Do you ship abroad?", acceptedAnswer: { "@type": "Answer", text: "Yes, worldwide." } },
        {
          "@type": "Question",
          name: "How do returns work?",
          acceptedAnswer: {
            "@type": "Answer",
            text: `<p>Within <strong>14 days</strong>. See <a href="${ORIGIN}/returns?x=1&amp;y=2">returns</a>.</p>\n<ul><li>Email us</li><li>Send it back</li></ul>`,
          },
        },
      ],
    });
  });

  it("merges blocks: duplicate questions once, empty input → null", () => {
    const node = faqPageJsonLd([{ question: "Q?", answer: "A" }, { question: "q?", answer: "B" }, { question: "R?", answer: "C" }], ORIGIN);
    expect(node?.mainEntity.map((q) => q.name)).toEqual(["Q?", "R?"]);
    expect(faqPageJsonLd([], ORIGIN)).toBeNull();
  });

  it("answer HTML keeps only tags Google allows and escapes text", () => {
    const html = faqAnswerText("> quoted <b>\n\n---\n\n[ext](https://e.example) and [mail](mailto:a@b.example)", ORIGIN);
    expect(html).not.toMatch(/<blockquote|<hr|rel=/);
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain('<a href="https://e.example">ext</a>');
    expect(html).toContain('<a href="mailto:a@b.example">mail</a>');
    expect(faqAnswerText("Plain & simple", ORIGIN)).toBe("Plain & simple");
  });

  it("is extracted and checked by the validator", () => {
    const html = `<script type="application/ld+json">${JSON.stringify(faqPageJsonLd([{ question: "Q?", answer: "A" }], ORIGIN))}</script>`;
    const [node] = extractJsonLd(html);
    expect(validateJsonLd(node)).toEqual([]);
    expect(validateJsonLd({ "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Q", acceptedAnswer: { "@type": "Answer", text: "" } }] })).toHaveLength(1);
    expect(validateJsonLd({ "@type": "FAQPage", mainEntity: [] })).toHaveLength(1);
  });
});

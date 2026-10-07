import { describe, expect, it } from "vitest";
import { parseArgs } from "../../scripts/etl/args";
import { parseFacetMapCsv } from "../../scripts/etl/steps/facets";
import { inferFulfillment, mapPaymentStatus } from "../../scripts/etl/steps/orders";
import { legacyPasswordHash, roleFor } from "../../scripts/etl/steps/users";
import { decodeNestedJson, decodePhotoIds, decodeSpecifications } from "../../scripts/etl/transforms/json";
import { splitName, splitStreet, toCountryCode } from "../../scripts/etl/transforms/people";
import { distribute, reconstructLinePrices } from "../../scripts/etl/transforms/prices";
import { mapLegacySettings, mergeAndValidate, normalizeHexColor } from "../../scripts/etl/transforms/settings";
import { assignUniqueSlugs } from "../../scripts/etl/transforms/slugs";
import { deriveProductStatus } from "../../scripts/etl/transforms/status";
import { cleanMarkdown, htmlToMarkdown } from "../../scripts/etl/transforms/text";
import { buildLegacyRedirects, emptyUrlMaps, isHandledByRuntime, mapLegacyPath, relativizeLegacyUrl } from "../../scripts/etl/transforms/urls";
import type { LegacySetting } from "../../scripts/etl/legacy/types";

describe("photo JSON decode", () => {
  const ids = ["65944cf5-72f3-4e12-be78-fe2d817ca800", "cfed22ae-bba9-4192-7e91-f8f433a5ce00"];
  it("decodes double-encoded JSON (as in the dump)", () => {
    expect(decodePhotoIds(JSON.stringify(JSON.stringify(ids))).ids).toEqual(ids);
  });
  it("decodes single-encoded JSON", () => {
    expect(decodePhotoIds(JSON.stringify(ids)).ids).toEqual(ids);
  });
  it("handles null, empty and broken input", () => {
    expect(decodePhotoIds(null).ids).toEqual([]);
    expect(decodePhotoIds("").ids).toEqual([]);
    expect(decodePhotoIds('"[]"').ids).toEqual([]);
    expect(decodePhotoIds("[not json").error).toBeDefined();
  });
  it("de-duplicates and drops unsafe ids", () => {
    const r = decodePhotoIds(JSON.stringify([ids[0], ids[0], "../etc/passwd", ""]));
    expect(r.ids).toEqual([ids[0]]);
    expect(r.invalid).toHaveLength(1);
  });
  it("decodeNestedJson stops at 3 levels", () => {
    expect(decodeNestedJson(JSON.stringify(JSON.stringify({ a: 1 })))).toEqual({ ok: true, value: { a: 1 } });
  });
  it("decodes specifications in key/value and object form", () => {
    expect(decodeSpecifications(JSON.stringify(JSON.stringify([{ key: "Maker", value: "Assmann" }]))).specs).toEqual([{ label: "Maker", value: "Assmann" }]);
    expect(decodeSpecifications(JSON.stringify({ Size: "57" })).specs).toEqual([{ label: "Size", value: "57" }]);
    expect(decodeSpecifications("[]").specs).toBeNull();
  });
});

describe("price reconstruction", () => {
  it("uses product prices when they add up exactly (order 27 in the dump)", () => {
    const r = reconstructLinePrices({
      total: 14099,
      delivery: 5000,
      lines: [
        { quantity: 2, roundedEuros: 89, productPrice: 4462 },
        { quantity: 1, roundedEuros: 2, productPrice: 175 },
      ],
    });
    expect(r.method).toBe("product-price");
    expect(r.lines.map((l) => l.lineTotal)).toEqual([8924, 175]);
    expect(r.lines[0].unitPrice).toBe(4462);
    expect(r.subtotal + 5000 + r.surcharge).toBe(14099);
  });
  it("distributes proportionally when product prices changed", () => {
    const r = reconstructLinePrices({
      total: 10000,
      delivery: 0,
      lines: [
        { quantity: 1, roundedEuros: 45, productPrice: 9000 },
        { quantity: 1, roundedEuros: 55, productPrice: 2000 },
      ],
    });
    expect(r.method).toBe("proportional");
    expect(r.lines.map((l) => l.lineTotal)).toEqual([4500, 5500]);
  });
  it("keeps cents exact with largest remainder and zero-rounded lines (order 85)", () => {
    const r = reconstructLinePrices({
      total: 5311,
      delivery: 5000,
      lines: [
        { quantity: 1, roundedEuros: 3, productPrice: 295 },
        { quantity: 1, roundedEuros: 0, productPrice: 16 },
      ],
    });
    expect(r.method).toBe("product-price");
    expect(r.subtotal).toBe(311);
  });
  it("recognises a payment surcharge", () => {
    const r = reconstructLinePrices({ total: 10500 + 500, delivery: 500, surchargePercent: 5, lines: [{ quantity: 1, roundedEuros: 100, productPrice: 10000 }] });
    expect(r.method).toBe("product-price+surcharge");
    expect(r.surcharge).toBe(500);
    expect(r.subtotal).toBe(10000);
  });
  it("never produces negative amounts", () => {
    const r = reconstructLinePrices({ total: 100, delivery: 500, lines: [{ quantity: 0, roundedEuros: 1, productPrice: null }] });
    expect(r.lines[0]).toMatchObject({ lineTotal: 0, quantity: 1 });
    expect(r.warning).toBeDefined();
  });
  it("distribute() sums exactly", () => {
    const parts = distribute(1001, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1001);
    expect(distribute(10, [0, 0])).toEqual([5, 5]);
  });
});

describe("status derivation", () => {
  it.each([
    [{ active: "ARCHIVED", stockControl: "SOLD", quantity: 0 }, "ARCHIVED"],
    [{ active: "INACTIVE", stockControl: "RESERVED", quantity: 1 }, "DRAFT"],
    [{ active: "ACTIVE", stockControl: "SOLD", quantity: 0 }, "SOLD"],
    [{ active: "ACTIVE", stockControl: "STOLEN", quantity: 0 }, "STOLEN"],
    [{ active: "ACTIVE", stockControl: "RESERVED", quantity: 0 }, "RESERVED"],
    [{ active: "ACTIVE", stockControl: "NOT_IN_SHOP", quantity: 0 }, "ARCHIVED"],
    [{ active: "ACTIVE", stockControl: "SOLD", quantity: 1 }, "ACTIVE"],
  ] as const)("%o → %s", (input, expected) => {
    expect(deriveProductStatus(input)).toBe(expected);
  });
});

describe("slug de-duplication", () => {
  it("suffixes duplicates in id order and avoids reserved slugs", () => {
    const { slugs, collisions } = assignUniqueSlugs(
      [
        { key: 1, slug: "test", title: "x", fallback: "item-1" },
        { key: 2, slug: "Test", title: "x", fallback: "item-2" },
        { key: 3, slug: "", title: "Stahlhelm M35", fallback: "item-3" },
        { key: 4, slug: "", title: "", fallback: "item-4" },
        { key: 5, slug: "taken", title: "", fallback: "item-5" },
      ],
      ["taken"],
    );
    expect([...slugs.values()]).toEqual(["test", "test-2", "stahlhelm-m35", "item-4", "taken-2"]);
    expect(collisions.map((c) => c.key)).toEqual([2, 5]);
  });
});

describe("settings mapping", () => {
  const row = (key: string, type: string, values: Partial<LegacySetting>): LegacySetting => ({
    key,
    setting_type: type,
    value: null,
    string_value: null,
    boolean_value: null,
    int_value: null,
    list_value: null,
    image_value: null,
    list: null,
    ...values,
  });
  const rows = [
    row("shop_name", "string", { string_value: "Militaria shop" }),
    row("currency", "enum", { list_value: "EUR" }),
    row("timezone", "enum", { list_value: "UTC" }),
    row("list_or_grid_view", "enum", { list_value: "grid-view" }),
    row("shop_display_amount", "enum", { list_value: "4" }),
    row("shop_selected_filter", "enum", { list_value: "highlow" }),
    row("toggle_listview_stock_code", "boolean", { string_value: "0", boolean_value: "0" }),
    row("toggle_gridview_stock_code", "boolean", { string_value: "0", boolean_value: "1" }),
    row("reserved_time", "enum", { list_value: "900" }),
    row("age_verify", "boolean", { boolean_value: "1" }),
    row("purchase_information", "boolean", { boolean_value: "0" }),
    row("show_purchase_price", "boolean", { boolean_value: "1" }),
    row("primary_color", "string", { string_value: "#ABC" }),
    row("heading_font", "enum", { list_value: "Comic Sans" }),
    row("logo", "image", { image_value: JSON.stringify(["abc-123"]) }),
    row("emailer_quota", "int", { int_value: "9999" }),
    row("maximum_item_photos", "int", {}),
    row("toggle_bump_to_top", "boolean", { boolean_value: "0" }),
    row("pagination_amount", "int", { int_value: "12" }),
  ];
  const m = mapLegacySettings(rows, ["EUR", "USD", "GBP", "XYZ"]);

  it("maps values into typed groups", () => {
    expect(m.groups.general).toMatchObject({ shopName: "Militaria shop", displayCurrencies: ["USD", "GBP"] });
    expect(m.groups.catalog).toMatchObject({ layout: "grid", gridColumns: 4, defaultSort: "price_desc", showStockCode: true, purchaseRecords: true });
    expect(m.groups.checkout).toMatchObject({ reservationMinutes: 15 });
    expect(m.groups.legal).toMatchObject({ ageVerification: "popup" });
    expect(m.groups.appearance).toMatchObject({ colors: { primary: "#aabbcc" } });
    expect(m.groups.platform).toMatchObject({ newsletterQuota: 9999 });
    expect(m.tenant).toEqual({ currency: "EUR" });
  });
  it("reports dropped, unmapped, empty and images", () => {
    expect(m.dropped.map((d) => d.key)).toEqual(["toggle_bump_to_top"]);
    expect(m.unmapped).toEqual(["pagination_amount"]);
    expect(m.empty).toEqual(expect.arrayContaining(["timezone", "maximum_item_photos", "heading_font", "logo"]));
    expect(m.images).toEqual([{ key: "logo", ids: ["abc-123"] }]);
    expect(m.warnings.join(" ")).toMatch(/XYZ/);
  });
  it("validates merged groups and rejects bad values per key", () => {
    const ok = mergeAndValidate("catalog", {}, m.groups.catalog!);
    expect(ok.rejected).toEqual([]);
    const bad = mergeAndValidate("checkout", { reservationMinutes: 20 }, { reservationMinutes: 999, guestCheckout: false });
    expect(bad.rejected).toEqual(["reservationMinutes"]);
    expect(bad.data).toMatchObject({ reservationMinutes: 20, guestCheckout: false });
  });
  it("normalizes colours", () => {
    expect(normalizeHexColor("abc")).toBe("#aabbcc");
    expect(normalizeHexColor("0")).toBeNull();
  });
});

describe("redirects & URL mapping", () => {
  const maps = emptyUrlMaps();
  maps.products.set(50001, "helmet");
  maps.legacyProductSlugs.set(50001, "Helmet");
  maps.categories.set("Helmets", "helmets");
  maps.categories.set("old-cat", "new-cat");
  maps.tags.set("WW2", "/shop?tag=ww2");
  maps.cmsPages.set("testpage", "/testpage");
  maps.cmsPages.set("about-us", "/about-us-2");
  maps.contentPages.set("terms", "/terms");
  maps.contentPages.set("news", "/news-2");

  it("builds normalised rows only for paths the runtime does not handle", () => {
    const { rows, handledByRuntime } = buildLegacyRedirects(maps);
    const from = rows.map((r) => r.fromPath);
    expect(from).toEqual(expect.arrayContaining(["/home", "/pages/home", "/shop.php", "/shop/category/old-cat", "/pages/testpage", "/pages/about-us", "/news"]));
    // identity (after normalisation) and runtime-handled paths are skipped
    expect(from).not.toContain("/shop/category/helmets");
    expect(from).not.toContain("/terms");
    expect(from.some((f) => f.startsWith("/product/") || f.startsWith("/shop/tag/") || f.startsWith("/shop.php?"))).toBe(false);
    expect(rows.every((r) => r.toPath.startsWith("/"))).toBe(true);
    expect(rows.every((r) => r.fromPath === r.fromPath.toLowerCase() && !/\/$/.test(r.fromPath))).toBe(true);
    expect(handledByRuntime).toBeGreaterThan(0);
  });
  it("recognises runtime-handled legacy paths", () => {
    expect(isHandledByRuntime("/shop.php?code=50001")).toBe(true);
    expect(isHandledByRuntime("/profile/orders")).toBe(true);
    expect(isHandledByRuntime("/shop/tag/ww2")).toBe(true);
    expect(isHandledByRuntime("/product/50001/helmet")).toBe(true);
    expect(isHandledByRuntime("/pages/testpage")).toBe(false);
  });
  it("maps legacy links in content", () => {
    expect(mapLegacyPath("/shop.php?code=50001", maps)).toBe("/product/50001/helmet");
    expect(mapLegacyPath("/basket", maps)).toBe("/cart");
    expect(mapLegacyPath("/pages/testpage", maps)).toBe("/testpage");
    expect(mapLegacyPath("/shop/category/helmets", maps)).toBe("/shop/category/helmets");
    expect(relativizeLegacyUrl("https://main.coloss.dev/shop", maps)).toBe("/shop");
    expect(relativizeLegacyUrl("https://main.coloss.dev/home", maps, ["main.coloss.dev"])).toBe("/");
    expect(relativizeLegacyUrl("https://example.org/page", maps, ["main.coloss.dev"])).toBe("https://example.org/page");
    expect(relativizeLegacyUrl("javascript:alert(1)", maps)).toBeNull();
  });
});

describe("people, text, orders, users, args", () => {
  it("resolves countries", () => {
    expect(toCountryCode("Netherlands")).toBe("NL");
    expect(toCountryCode("België")).toBe("BE");
    expect(toCountryCode("de")).toBe("DE");
    expect(toCountryCode("Atlantis")).toBeNull();
  });
  it("splits names and streets", () => {
    expect(splitName("Jan de Vries")).toEqual({ firstName: "Jan", lastName: "de Vries" });
    expect(splitStreet("Kerkstraat 12a")).toEqual({ street: "Kerkstraat", houseNumber: "12a", line2: null });
    expect(splitStreet("12 Main Street\nUnit 4")).toEqual({ street: "Main Street", houseNumber: "12", line2: "Unit 4" });
  });
  it("converts HTML and Markdown images", () => {
    expect(htmlToMarkdown("<p>All <strong>prices</strong> in EUR<br></p><ul><li>One</li></ul>")).toBe("All **prices** in EUR\n\n- One");
    expect(cleanMarkdown("test ![x](https://imagedelivery.net/a/b/public)")).toBe("test [x](https://imagedelivery.net/a/b/public)");
  });
  it("maps payment status (manual = unpaid unless order_paid_on)", () => {
    expect(mapPaymentStatus({ payment_status: "paid", order_paid_on: null }).status).toBe("PAID");
    expect(mapPaymentStatus({ payment_status: "manual", order_paid_on: null }).status).toBe("PENDING");
    expect(mapPaymentStatus({ payment_status: "manual", order_paid_on: new Date() })).toEqual({ status: "PAID", inferred: true });
    expect(mapPaymentStatus({ payment_status: "failed", order_paid_on: null }).status).toBe("FAILED");
    const now = new Date("2026-10-07T00:00:00Z");
    expect(inferFulfillment(true, false, new Date("2026-09-01T00:00:00Z"), now)).toBe("DELIVERED");
    expect(inferFulfillment(true, false, new Date("2026-10-01T00:00:00Z"), now)).toBe("UNFULFILLED");
    expect(inferFulfillment(false, true, null, now)).toBe("UNFULFILLED");
  });
  it("keeps bcrypt hashes with the bcrypt$ prefix", () => {
    const hash = "$2y$10$" + "a".repeat(53);
    expect(legacyPasswordHash(hash)).toBe(`bcrypt$${hash}`);
    expect(legacyPasswordHash("plain")).toBeNull();
    expect(roleFor(["admin"])).toBe("OWNER");
    expect(roleFor(["user"])).toBe("CUSTOMER");
  });
  it("parses CLI args and facet CSV", () => {
    const a = parseArgs(["--tenant", "x", "--only=products,orders", "--zone-countries", "Freeyo=nl,be", "--dry-run"]);
    expect(a).toMatchObject({ tenant: "x", only: ["products", "orders"], zoneCountries: { Freeyo: ["NL", "BE"] }, dryRun: true });
    expect(() => parseArgs(["--tenant", "x", "--only", "nope"])).toThrow(/Unknown step/);
    const csv = parseFacetMapCsv("legacy_tag_id,facet_kind,value_name,parent\n12,PERIOD,WW2,\n44,BRANCH,Heer,Army\n9,CUSTOM:Material,Leather,\n0,PERIOD,x,");
    expect(csv.rows).toHaveLength(3);
    expect(csv.rows[2]).toMatchObject({ kind: "CUSTOM", customName: "Material" });
    expect(csv.errors).toHaveLength(1);
  });
});

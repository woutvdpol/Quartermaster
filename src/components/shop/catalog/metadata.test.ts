import { describe, expect, it } from "vitest";
import { parseCatalogParams } from "@/server/storefront-catalog/params";
import { catalogMetadata } from "./metadata";

const shop = { shopName: "Example", settings: { appearance: { bannerPath: null } } };
const meta = (path: string, raw: Record<string, string | string[] | undefined>, defaultSort = "newest" as const) =>
  catalogMetadata({ shop, path, params: parseCatalogParams(raw, defaultSort), title: "Helmets for sale", description: "Desc", defaultSort });

describe("catalogMetadata", () => {
  it("clean listing: self-canonical, indexable, OG defaults kept", () => {
    const m = meta("/shop/category/helmets", {});
    expect(m.alternates?.canonical).toBe("/shop/category/helmets");
    expect("robots" in m).toBe(false); // never `robots: undefined` (would wipe the layout's noindex)
    expect(m.openGraph).toMatchObject({ siteName: "Example", url: "/shop/category/helmets", images: [{ url: "/og/shop" }] });
  });

  it("paginated pages are self-canonical and indexable", () => {
    const m = meta("/shop/category/helmets", { page: "3" });
    expect(m.alternates?.canonical).toBe("/shop/category/helmets?page=3");
    expect(m.title).toBe("Helmets for sale – page 3");
    expect("robots" in m).toBe(false);
  });

  it.each([{ q: "helmet" }, { sort: "price_asc" }, { view: "list" }, { show: "48" }, { f: ["period.ww2", "country.germany"] }, { tag: "ww2" }, { min: "10" }])(
    "variant %o is noindex,follow with the clean canonical",
    (raw) => {
      const m = meta("/shop/category/helmets", raw);
      expect(m.robots).toEqual({ index: false, follow: true });
      expect(m.alternates?.canonical).toBe("/shop/category/helmets");
    },
  );

  it("a single facet filter on /shop points at the facet landing page", () => {
    const m = meta("/shop", { f: "period.ww2" });
    expect(m.alternates?.canonical).toBe("/shop/facet/period/ww2");
    expect("robots" in m).toBe(false);
    // …but not combined with anything else.
    expect(meta("/shop", { f: "period.ww2", q: "x" }).robots).toEqual({ index: false, follow: true });
  });

  it("treats the configured default sort as clean", () => {
    expect("robots" in catalogMetadata({ shop, path: "/shop", params: parseCatalogParams({ sort: "price_desc" }, "price_desc"), title: "T", description: "D", defaultSort: "price_desc" })).toBe(false);
  });
});

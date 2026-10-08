import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { LocalDriver, setStorageForTests } from "@/server/media/storage";
import { runJobNow, setJobTransportForTests, type EnqueuedJob } from "@/server/jobs/queue";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { setEmbedderForTests, type RgbImage } from "./embedder";
import { createFakeEmbedder } from "./fake-embedder";
import { indexProducts, indexStatus, reindexTenant, toRgb } from "./indexing";
import { invalidateShopDictionary } from "./dictionary";
import { productVectors, vectorSearch } from "./retrieval";
import { clearQueryEmbeddingCache, searchByImage, searchProducts, similarProducts, suggest } from "./service";
import { whereSql } from "@/server/storefront-catalog/queries";

/*
 * Smart search against a real Postgres (pgvector) with the deterministic fake embedder:
 * indexing + idempotency, hooks, hybrid ranking, interpretation, visibility / compliance / tenant
 * isolation, photo search and similar items.
 */

const RED = { r: 200, g: 20, b: 20 };
const BLUE = { r: 20, g: 20, b: 200 };

let uploads: string;
let code = 60000;

async function solidPng(c: { r: number; g: number; b: number }) {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: c } }).png().toBuffer();
}

type Opts = { title: string; status?: "ACTIVE" | "RESERVED" | "SOLD" | "DRAFT"; description?: string; price?: number; values?: string[]; color?: { r: number; g: number; b: number }; blurred?: boolean; restricted?: boolean };

async function product(tenantId: string, o: Opts) {
  code += 1;
  const p = await db.product.create({
    data: {
      tenantId,
      stockCode: code,
      slug: `item-${code}`,
      title: o.title,
      description: o.description ?? null,
      status: o.status ?? "ACTIVE",
      price: o.price ?? 10000,
      quantity: o.status === "SOLD" ? 0 : 1,
      blurred: o.blurred ?? false,
      restrictedSymbols: o.restricted ?? false,
      publishedAt: new Date(Date.UTC(2026, 0, 1, 0, code % 60)),
    },
  });
  for (const facetValueId of o.values ?? []) await db.productFacetValue.create({ data: { tenantId, productId: p.id, facetValueId } });
  if (o.color) {
    const key = `${tenantId}/products/${p.id}/img-${code}.png`;
    await new LocalDriver(uploads).put(key, await solidPng(o.color), "image/png");
    await db.productImage.create({ data: { tenantId, productId: p.id, storageKey: key, sortOrder: 0 } });
  }
  return p;
}

async function rgbOf(c: { r: number; g: number; b: number }): Promise<RgbImage> {
  return toRgb(await solidPng(c));
}

describe("smart search (integration)", () => {
  let tenantId: string;
  let otherTenant: string;
  let v: Record<string, string>;
  let p: Record<string, { id: string; stockCode: number }>;
  const embedded: string[] = [];
  const embedder = createFakeEmbedder({ onEmbed: (kind, input) => void (kind === "passage" && embedded.push(String(input))) });

  beforeAll(() => {
    uploads = mkdtempSync(path.join(tmpdir(), "qm-search-"));
    setStorageForTests(new LocalDriver(uploads));
  });
  afterAll(() => {
    setStorageForTests(null);
    setEmbedderForTests(undefined);
    rmSync(uploads, { recursive: true, force: true });
  });
  afterEach(() => setJobTransportForTests(null));

  beforeEach(async () => {
    await resetDb();
    setEmbedderForTests(embedder);
    embedded.length = 0;
    tenantId = (await createTenantContext()).tenantId;
    otherTenant = (await createTenantContext()).tenantId;
    invalidateShopDictionary(tenantId);

    const facet = async (kind: "COUNTRY" | "TYPE", name: string, slug: string) => db.facet.create({ data: { tenantId, kind, name, slug } });
    const country = await facet("COUNTRY", "Country", "country");
    const type = await facet("TYPE", "Type", "type");
    const value = async (facetId: string, name: string, slug: string) => (await db.facetValue.create({ data: { tenantId, facetId, name, slug } })).id;
    v = {
      germany: await value(country.id, "Germany", "germany"),
      netherlands: await value(country.id, "Netherlands", "netherlands"),
      helmets: await value(type.id, "Helmets", "helmets"),
    };
    p = {
      m40: await product(tenantId, { title: "Stahlhelm M40 Heer", description: "Original German steel helmet with decal.", price: 145000, values: [v.germany, v.helmets], color: RED }),
      m34: await product(tenantId, { title: "Dutch M34 helmet, Korps Mariniers", price: 52500, values: [v.netherlands, v.helmets], color: BLUE }),
      bluse: await product(tenantId, { title: "Feldbluse M36 infantry", description: "Field blouse with collar tabs.", price: 184500, values: [v.germany], color: { r: 120, g: 120, b: 90 } }),
      sold: await product(tenantId, { title: "Stahlhelm M35 Luftwaffe", status: "SOLD", values: [v.germany, v.helmets], color: RED }),
      draft: await product(tenantId, { title: "Stahlhelm M42 draft", status: "DRAFT", values: [v.germany, v.helmets] }),
      restricted: await product(tenantId, { title: "Stahlhelm M42 with restricted decal", values: [v.germany, v.helmets], restricted: true }),
      blurred: await product(tenantId, { title: "Stahlhelm M16 sensitive", values: [v.germany, v.helmets], blurred: true, color: { r: 190, g: 30, b: 30 } }),
      other: await product(otherTenant, { title: "Stahlhelm M40 Heer", description: "Original German steel helmet with decal.", color: RED }),
    };
    await reindexTenant(tenantId, { embedder });
    await reindexTenant(otherTenant, { embedder });
  });

  describe("indexing", () => {
    it("embeds text + main photo of every product and is idempotent via contentHash", async () => {
      const status = await indexStatus(tenantId, { text: embedder.textModel, image: embedder.imageModel });
      expect(status).toMatchObject({ products: 7, textIndexed: 7, withPhoto: 5, imageIndexed: 5, outdated: 0 });
      const passage = embedded.find((t) => t.startsWith("Stahlhelm M40 Heer"))!;
      expect(passage).toContain("Country: Germany");
      expect(passage).toContain("Type: Helmets");

      embedded.length = 0;
      const again = await reindexTenant(tenantId, { embedder });
      expect(again.textEmbedded).toBe(0);
      expect(again.imageEmbedded).toBe(0);
      expect(again.skipped).toBe(7);
      expect(embedded).toEqual([]);

      await db.product.update({ where: { id: p.m34.id }, data: { title: "Dutch M34 helmet, mariniers, 1938" } });
      const changed = await indexProducts(tenantId, [p.m34.id, p.m40.id], { embedder });
      expect(changed).toMatchObject({ textEmbedded: 1, skipped: 1 });
      expect(embedded).toHaveLength(1);
    });

    it("removes the image embedding when the photo is gone; ignores other tenants' ids", async () => {
      await db.productImage.deleteMany({ where: { productId: p.m34.id } });
      const res = await indexProducts(tenantId, [p.m34.id, p.other.id], { embedder });
      expect(res).toMatchObject({ products: 1, imageRemoved: 1 });
      expect((await productVectors(tenantId, p.m34.id)).image).toBeNull();
      expect((await productVectors(tenantId, p.other.id)).text).toBeNull(); // other tenant's row is not visible here
    });

    it("runs as a job and is queued by audit() for product changes and taxonomy changes", async () => {
      await db.$executeRaw`DELETE FROM product_embeddings WHERE "productId" = ${p.bluse.id}`;
      await runJobNow("search.embed-product", { tenantId, productId: p.bluse.id });
      expect((await productVectors(tenantId, p.bluse.id)).text).toHaveLength(384);

      const jobs: EnqueuedJob[] = [];
      setJobTransportForTests((j) => void jobs.push(j));
      await audit({ action: "product.update", tenantId, entity: "Product", entityId: p.m40.id });
      await audit({ action: "facet.value_update", tenantId, entity: "FacetValue", entityId: v.germany });
      await audit({ action: "order.note", tenantId, entity: "Order", entityId: "x" });
      expect(jobs.map((j) => [j.name, j.options.singletonKey])).toEqual([
        ["search.embed-product", p.m40.id],
        ["search.reindex-tenant", tenantId],
      ]);
    });
  });

  describe("searchProducts", () => {
    const ids = (r: { items: { id: string }[] }) => r.items.map((i) => i.id);

    it("understands 'duitse helm' as Germany + Helmets and applies the catalog visibility", async () => {
      const r = await searchProducts(tenantId, { q: "duitse helm" });
      expect(r.interpretation.facets).toEqual(["country.germany", "type.helmets"]);
      expect(r.interpretation.chips.map((c) => c.label)).toEqual(["Country: Germany", "Type: Helmets"]);
      // m40 + the blurred one (shown locked by the UI) + the restricted one (no country rule here);
      // never the sold, draft or other-tenant items.
      expect(new Set(ids(r))).toEqual(new Set([p.m40.id, p.blurred.id, p.restricted.id]));
      expect(r.items.find((i) => i.id === p.blurred.id)?.blurred).toBe(true);
      expect(r.facets?.facets.find((f) => f.slug === "country")?.values.find((x) => x.slug === "germany")?.selected).toBe(true);
      expect(r.timing.semantic).toBe("used");
    });

    it("applies the visitor's country compliance (hidden products never appear)", async () => {
      const r = await searchProducts(tenantId, { q: "stahlhelm", scope: { mode: "shop", categoryIds: null, hide: { categoryIds: [], restrictedSymbols: true, ageRestricted: false, deactivatedWeapons: false } } });
      expect(ids(r)).not.toContain(p.restricted.id);
      expect(ids(r)).toContain(p.m40.id);
    });

    it("never returns another tenant's product, also not through vectors", async () => {
      const r = await searchProducts(tenantId, { q: "Stahlhelm M40 Heer original German steel helmet" });
      expect(ids(r)).not.toContain(p.other.id);
      const { text } = await productVectors(otherTenant, p.other.id);
      const where = whereSql(tenantId, { mode: "shop", categoryIds: null }, { q: null, tags: [], min: null, max: null, selection: [] });
      const hits = await vectorSearch(tenantId, where, text!, { kind: "text", dim: 384, limit: 50 });
      expect(hits.map((h) => h.id)).not.toContain(p.other.id);
      expect(hits[0].id).toBe(p.m40.id); // identical passage in this tenant
    });

    it("ranks exact title matches first and pins an exact stock number", async () => {
      const r = await searchProducts(tenantId, { q: "feldbluse" });
      expect(ids(r)[0]).toBe(p.bluse.id);
      const byCode = await searchProducts(tenantId, { q: `nr ${p.m34.stockCode}` });
      expect(ids(byCode)[0]).toBe(p.m34.id);
      expect(byCode.interpretation.chips[0].kind).toBe("stock");
    });

    it("tolerates typos (trigram) and expands synonyms", async () => {
      expect(ids(await searchProducts(tenantId, { q: "stahlhem" }))).toContain(p.m40.id);
      // "kraagspiegels" → term group "collar tabs" (matched in the description? no: synonyms only hit titles)
      const tabs = await searchProducts(tenantId, { q: "veldbluse" });
      expect(ids(tabs)).toContain(p.bluse.id);
    });

    it("prices from the query and explicit filters both apply", async () => {
      const cheap = await searchProducts(tenantId, { q: "helm onder 1000 euro" });
      expect(cheap.interpretation.max).toBe(1000);
      expect(ids(cheap)).toContain(p.m34.id);
      expect(ids(cheap)).not.toContain(p.m40.id); // €1,450
      const explicit = await searchProducts(tenantId, { q: "helm", filters: { facets: ["country.netherlands"] } });
      expect(ids(explicit)).toEqual([p.m34.id]);
    });

    it("'verkochte' searches the sold archive", async () => {
      const r = await searchProducts(tenantId, { q: "verkochte stahlhelm" });
      expect(r.mode).toBe("archive");
      expect(ids(r)).toEqual([p.sold.id]);
    });

    it("relaxes understood facets when nothing matches them", async () => {
      const r = await searchProducts(tenantId, { q: "nederlandse feldbluse" });
      expect(r.interpretation.relaxed).toBe(true);
      expect(ids(r)).toEqual([p.bluse.id]);
    });

    it("sorts search results by price on request; filters-only queries list in the fallback order", async () => {
      const r = await searchProducts(tenantId, { q: "helm", sort: "price_asc" });
      const prices = r.items.map((i) => i.price);
      expect(prices).toEqual([...prices].sort((a, b) => a - b));
      const listing = await searchProducts(tenantId, { q: "duits", fallbackSort: "price_desc" });
      expect(listing.interpretation.text).toBe("");
      expect(listing.items[0].id).toBe(p.bluse.id); // most expensive German item for sale
    });

    it("falls back to lexical search when the embedder is cold or absent", async () => {
      clearQueryEmbeddingCache(); // a cached query vector would still be used (that is fine in production)
      setEmbedderForTests(createFakeEmbedder({ cold: ["text", "imageText"] }));
      const cold = await searchProducts(tenantId, { q: "feldbluse" });
      expect(cold.timing.semantic).toBe("cold");
      expect(ids(cold)[0]).toBe(p.bluse.id);
      setEmbedderForTests(null);
      const none = await searchProducts(tenantId, { q: "feldbluse" });
      expect(none.timing.semantic).toBe("off");
      expect(ids(none)).toEqual([p.bluse.id]);
    });
  });

  describe("suggest", () => {
    it("offers facet values for a prefix and a few products", async () => {
      const s = await suggest(tenantId, "duit");
      expect(s.facets.map((f) => f.token)).toContain("country.germany");
      const h = await suggest(tenantId, "stahl");
      expect(h.products.map((x) => x.id)).toContain(p.m40.id);
      expect(h.products.map((x) => x.id)).not.toContain(p.sold.id);
      expect(h.products.length).toBeLessThanOrEqual(5);
    });
  });

  describe("photo search and similar items", () => {
    it("finds the products whose main photo looks like the upload", async () => {
      const red = await searchByImage(tenantId, await rgbOf({ r: 210, g: 15, b: 25 }));
      expect(red.items[0].id).toBe(p.m40.id);
      expect(red.items.map((i) => i.id)).not.toContain(p.sold.id); // sold: not in the shop scope
      expect(red.items.map((i) => i.id)).not.toContain(p.other.id);
      const blue = await searchByImage(tenantId, await rgbOf({ r: 10, g: 30, b: 220 }));
      expect(blue.items[0].id).toBe(p.m34.id);
    });

    it("refines a photo search with text (filters from the text apply)", async () => {
      const r = await searchByImage(tenantId, await rgbOf(RED), { q: "duitse helm" });
      expect(r.interpretation.facets).toEqual(["country.germany", "type.helmets"]);
      expect(r.items[0].id).toBe(p.m40.id);
      expect(r.items.map((i) => i.id)).not.toContain(p.m34.id);
      const none = await searchByImage(tenantId, await rgbOf(RED), { q: "nederlands" });
      expect(none.items).toEqual([]); // the only Dutch item looks nothing like it
    });

    it("refuses photo search without an embedder", async () => {
      setEmbedderForTests(null);
      await expect(searchByImage(tenantId, await rgbOf(RED))).rejects.toThrow("not available");
    });

    it("similar products: visible neighbours, never the product itself", async () => {
      const sim = await similarProducts(tenantId, p.m40.id);
      const simIds = sim.map((c) => c.id);
      expect(simIds).not.toContain(p.m40.id);
      expect(simIds).not.toContain(p.sold.id);
      expect(simIds).not.toContain(p.other.id);
    });
  });
});

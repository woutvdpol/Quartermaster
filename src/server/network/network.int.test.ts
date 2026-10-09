import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { LocalDriver, setStorageForTests } from "@/server/media/storage";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { setEmbedderForTests } from "@/server/search/embedder";
import { createFakeEmbedder } from "@/server/search/fake-embedder";
import { reindexTenant, toRgb } from "@/server/search/indexing";
import { clearQueryEmbeddingCache } from "@/server/search/service";
import { loadNetworkDirectory, runNetworkSearch, searchNetworkByImage } from "./service";
import { parseNetworkParams } from "./params";

/*
 * Network search across shops against a real Postgres: only opted-in, live dealers with a primary domain,
 * only their eligible products, each dealer's country rules, absolute links into the dealer's shop.
 */

const RED = { r: 200, g: 20, b: 20 };
let uploads: string;
let code = 70000;

type Opts = { title: string; status?: "ACTIVE" | "RESERVED" | "SOLD"; blurred?: boolean; restricted?: boolean; ageRestricted?: boolean; fairHoldId?: string; categoryId?: string; photo?: boolean };

async function product(tenantId: string, o: Opts) {
  code += 1;
  const p = await db.product.create({
    data: {
      tenantId,
      stockCode: code,
      slug: `item-${code}`,
      title: o.title,
      status: o.status ?? "ACTIVE",
      price: 145000,
      quantity: o.status === "SOLD" ? 0 : 1,
      blurred: o.blurred ?? false,
      restrictedSymbols: o.restricted ?? false,
      ageRestricted: o.ageRestricted ?? false,
      fairHoldId: o.fairHoldId ?? null,
      categoryId: o.categoryId ?? null,
      publishedAt: new Date(Date.UTC(2026, 0, 1, 0, code % 60)),
    },
  });
  if (o.photo) {
    const key = `${tenantId}/products/${p.id}/img-${code}.png`;
    await new LocalDriver(uploads).put(key, await sharp({ create: { width: 64, height: 64, channels: 3, background: RED } }).png().toBuffer(), "image/png");
    await db.productImage.create({ data: { tenantId, productId: p.id, storageKey: key, sortOrder: 0 } });
  }
  return p;
}

async function dealer(opts: { optIn: boolean; host?: string | null; pending?: boolean }) {
  const { tenantId } = await createTenantContext();
  await db.tenant.update({
    where: { id: tenantId },
    data: { networkOptIn: opts.optIn, ...(opts.pending ? { setupState: { basics: { done: true, at: "" } } } : {}) },
  });
  if (opts.host) await db.tenantDomain.create({ data: { tenantId, host: opts.host, isPrimary: true } });
  return tenantId;
}

describe("network search (integration)", () => {
  const embedder = createFakeEmbedder();
  let a: string;
  let ids: Record<string, string>;

  beforeAll(() => {
    uploads = mkdtempSync(path.join(tmpdir(), "qm-network-"));
    setStorageForTests(new LocalDriver(uploads));
  });
  afterAll(() => {
    setStorageForTests(null);
    setEmbedderForTests(undefined);
    rmSync(uploads, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetDb();
    setEmbedderForTests(embedder);
    clearQueryEmbeddingCache();
    a = await dealer({ optIn: true, host: "a-shop.example" });
    const notOptedIn = await dealer({ optIn: false, host: "b-shop.example" });
    const noDomain = await dealer({ optIn: true, host: null });
    const pending = await dealer({ optIn: true, host: "d-shop.example", pending: true });
    const fair = await db.fair.create({ data: { tenantId: a, name: "Militaria Fair", startsOn: new Date("2026-10-10"), status: "LIVE" } });
    const banned = await db.category.create({ data: { tenantId: a, title: "Edged weapons", slug: "edged" } });
    await db.complianceRule.create({ data: { tenantId: a, name: "No edged weapons to DE", match: "CATEGORY", categoryId: banned.id, countries: ["DE"], action: "NO_SHIPPING" } });
    ids = {
      ok: (await product(a, { title: "Stahlhelm M40 Heer", photo: true })).id,
      edged: (await product(a, { title: "Stahlhelm with bayonet set", categoryId: banned.id })).id,
      reserved: (await product(a, { title: "Stahlhelm M35 reserved", status: "RESERVED" })).id,
      sold: (await product(a, { title: "Stahlhelm M42 sold", status: "SOLD" })).id,
      blurred: (await product(a, { title: "Stahlhelm M16 sensitive", blurred: true, photo: true })).id,
      restricted: (await product(a, { title: "Stahlhelm decal restricted", restricted: true })).id,
      age: (await product(a, { title: "Stahlhelm age restricted", ageRestricted: true })).id,
      onFair: (await product(a, { title: "Stahlhelm on the fair", fairHoldId: fair.id })).id,
      other: (await product(notOptedIn, { title: "Stahlhelm M40 Heer", photo: true })).id,
      noDomain: (await product(noDomain, { title: "Stahlhelm M40 Heer" })).id,
      pending: (await product(pending, { title: "Stahlhelm M40 Heer" })).id,
    };
    for (const t of [a, notOptedIn, noDomain, pending]) await reindexTenant(t, { embedder });
  });

  it("lists only opted-in, live dealers with a primary domain", async () => {
    const dir = await loadNetworkDirectory();
    expect(dir.dealers.map((d) => d.id)).toEqual([a]);
    expect(dir.dealers[0]).toMatchObject({ host: "a-shop.example", shopUrl: "https://a-shop.example/", productCount: 2 });
  });

  it("returns only eligible products of network dealers, with absolute links into the dealer's shop", async () => {
    const dir = await loadNetworkDirectory();
    const res = await runNetworkSearch(dir, parseNetworkParams({ q: "stahlhelm" }), "NL");
    expect(res.items.map((c) => c.id).sort()).toEqual([ids.ok, ids.edged].sort());
    const ok = res.items.find((c) => c.id === ids.ok)!;
    expect(ok.href).toMatch(/^https:\/\/a-shop\.example\/product\/\d+\/item-\d+$/);
    expect(ok.dealer.slug).toBe(dir.dealers[0].slug);
    expect(ok.image?.src).toMatch(new RegExp(`^/uploads/${a}/products/`));
    expect(res.perDealer).toEqual({ [dir.dealers[0].slug]: 2 });

    // Listing without a query: same set, newest first.
    const listing = await runNetworkSearch(dir, parseNetworkParams({}), "NL");
    expect(listing.items.map((c) => c.id).sort()).toEqual([ids.ok, ids.edged].sort());
  });

  it("applies the dealer's country rules for the visitor (any action excludes)", async () => {
    const dir = await loadNetworkDirectory();
    const de = await runNetworkSearch(dir, parseNetworkParams({ q: "stahlhelm" }), "DE");
    expect(de.items.map((c) => c.id)).toEqual([ids.ok]);
  });

  it("filters by dealer and by ships-to", async () => {
    const dir = await loadNetworkDirectory();
    expect((await runNetworkSearch(dir, parseNetworkParams({ q: "stahlhelm", dealer: "nobody" }), "NL")).total).toBe(0);
    // Dealer A has no shipping zones: nothing ships to NL.
    expect((await runNetworkSearch(dir, parseNetworkParams({ q: "stahlhelm", ships: "1" }), "NL")).total).toBe(0);
    await db.shippingZone.create({ data: { tenantId: a, name: "Benelux", countries: ["BE", "NL"] } });
    const dir2 = await loadNetworkDirectory();
    expect((await runNetworkSearch(dir2, parseNetworkParams({ q: "stahlhelm", ships: "1" }), "NL")).total).toBe(2);
  });

  it("photo search only finds eligible products of network dealers", async () => {
    const res = await searchNetworkByImage(await toRgb(await sharp({ create: { width: 64, height: 64, channels: 3, background: RED } }).png().toBuffer()), "NL");
    expect(res.items.map((c) => c.id)).toEqual([ids.ok]);
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { ServiceContext } from "@/server/context";
import { LocalDriver, setStorageForTests } from "@/server/media/storage";
import { runJobNow, setJobTransportForTests, type EnqueuedJob } from "@/server/jobs/queue";
import { updateSettings } from "@/server/settings";
import { checkDuplicates } from "@/server/duplicates";
import { shopServedLocales } from "@/server/i18n/served-locales";
import { enabledLocales } from "@/server/translations/sync";
import { getEntityTranslations, listTranslations, saveGlossaryTerm } from "@/server/translations/service";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { setEmbedderForTests, type RgbImage } from "./embedder";
import { createFakeEmbedder } from "./fake-embedder";
import { reindexTenant, toRgb } from "./indexing";
import { invalidateShopDictionary } from "./dictionary";
import { syncOutdated } from "./admin";
import { clearQueryEmbeddingCache, searchByImage, searchProducts, similarProducts, suggest } from "./service";

/*
 * Paid modules "Smart search" and "Translations" (docs/modules.md) against a real Postgres:
 * a START shop (neither module) searches lexically, has no photo search / similar items / duplicate
 * check, its admin translation calls are refused and it serves English only — even with embeddings
 * and language settings left over from a bigger package. A COMPLETE shop behaves as before.
 */

const RED = { r: 200, g: 20, b: 20 };
let uploads: string;
let code = 70000;

async function solidPng(c: { r: number; g: number; b: number }) {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: c } }).png().toBuffer();
}

async function rgbOf(c: { r: number; g: number; b: number }): Promise<RgbImage> {
  return toRgb(await solidPng(c));
}

async function product(tenantId: string, title: string, color = RED) {
  code += 1;
  const p = await db.product.create({
    data: { tenantId, stockCode: code, slug: `item-${code}`, title, status: "ACTIVE", price: 10000, quantity: 1, publishedAt: new Date(Date.UTC(2026, 0, 1, 0, code % 60)) },
  });
  const key = `${tenantId}/products/${p.id}/img-${code}.png`;
  await new LocalDriver(uploads).put(key, await solidPng(color), "image/png");
  const image = await db.productImage.create({ data: { tenantId, productId: p.id, storageKey: key, sortOrder: 0 } });
  return { ...p, imageId: image.id };
}

describe("paid modules: smart search and translations (integration)", () => {
  let start: ServiceContext;
  let complete: ServiceContext;
  let s: Record<string, { id: string; imageId: string }>;
  let c: Record<string, { id: string; imageId: string }>;
  let jobs: EnqueuedJob[];
  const embedder = createFakeEmbedder();

  beforeAll(() => {
    uploads = mkdtempSync(path.join(tmpdir(), "qm-modules-"));
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
    clearQueryEmbeddingCache();
    jobs = [];
    setJobTransportForTests((j) => void jobs.push(j));
    start = await createTenantContext({ plan: "START" });
    complete = await createTenantContext({ plan: "COMPLETE" });
    for (const ctx of [start, complete]) {
      invalidateShopDictionary(ctx.tenantId);
      await updateSettings(ctx.tenantId, "i18n", { locales: ["nl", "de"] }, ctx.actor);
    }
    s = { m40: await product(start.tenantId, "Stahlhelm M40 Heer"), m35: await product(start.tenantId, "Stahlhelm M35 Luftwaffe") };
    c = { m40: await product(complete.tenantId, "Stahlhelm M40 Heer"), m35: await product(complete.tenantId, "Stahlhelm M35 Luftwaffe") };
    // Embeddings for both shops — for START as if left over from a bigger package.
    await reindexTenant(start.tenantId, { embedder });
    await reindexTenant(complete.tenantId, { embedder });
    jobs.length = 0;
  });

  describe("START (no Smart search, no Translations)", () => {
    it("storefront search still answers, through the lexical path", async () => {
      const r = await searchProducts(start.tenantId, { q: "stahlhelm" });
      expect(r.items.map((i) => i.id).sort()).toEqual([s.m40.id, s.m35.id].sort());
      expect(r.timing.semantic).toBe("off");
      expect(r.timing.imageText).toBe("off");
      const typo = await searchProducts(start.tenantId, { q: "stahlhem" });
      expect(typo.items.map((i) => i.id)).toContain(s.m40.id);
      const sg = await suggest(start.tenantId, "stahl");
      expect(sg.products.map((p) => p.id)).toContain(s.m40.id);
      expect(sg.timing.semantic).not.toBe("used");
    });

    it("has no photo search, similar items or duplicate check", async () => {
      await expect(searchByImage(start.tenantId, await rgbOf(RED))).rejects.toMatchObject({ name: "SearchUnavailableError", reason: "module" });
      expect(await similarProducts(start.tenantId, s.m40.id)).toEqual([]);
      expect(await checkDuplicates(start, { productId: s.m40.id, imageIds: [s.m40.imageId], embedder })).toEqual({ state: "unavailable", candidates: [] });
    });

    it("search jobs and the sync cron do no embedder work for the shop", async () => {
      await db.$executeRaw`DELETE FROM product_embeddings WHERE "tenantId" = ${start.tenantId}`;
      expect(await runJobNow("search.embed-product", { tenantId: start.tenantId, productId: s.m40.id })).toEqual({ skipped: "module" });
      expect(await runJobNow("search.reindex-tenant", { tenantId: start.tenantId })).toEqual({ skipped: "module" });
      expect(await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM product_embeddings WHERE "tenantId" = ${start.tenantId}`).toEqual([{ n: 0 }]);
      await db.$executeRaw`DELETE FROM product_embeddings WHERE "tenantId" = ${complete.tenantId} AND "productId" = ${c.m40.id}`;
      await syncOutdated();
      const queued = jobs.filter((j) => j.name === "search.embed-product").map((j) => (j.data as { tenantId: string }).tenantId);
      expect(queued).toEqual([complete.tenantId]);
    });

    it("rejects admin translation calls with UNAVAILABLE and hides the product editor card", async () => {
      await expect(listTranslations(start, { view: "review" })).rejects.toMatchObject({ code: "UNAVAILABLE" });
      await expect(saveGlossaryTerm(start, { locale: "nl", source: "liner", target: "voering" })).rejects.toMatchObject({ code: "UNAVAILABLE" });
      expect((await getEntityTranslations(start, "PRODUCT", s.m40.id)).locales).toEqual([]);
      expect(await runJobNow("translations.sync", { tenantId: start.tenantId, scope: "all" })).toEqual({ skipped: "module" });
      expect(await db.translation.count({ where: { tenantId: start.tenantId } })).toBe(0);
    });

    it("serves the base language only (settings kept)", async () => {
      expect(await shopServedLocales(start.tenantId)).toEqual(["en"]);
      expect(await enabledLocales(start.tenantId)).toEqual([]);
      const row = await db.setting.findFirst({ where: { tenantId: start.tenantId, group: "i18n" } });
      expect((row?.data as { locales?: string[] } | null)?.locales).toEqual(["nl", "de"]);
    });
  });

  describe("COMPLETE behaves as before", () => {
    it("hybrid search, photo search and similar items", async () => {
      const r = await searchProducts(complete.tenantId, { q: "stahlhelm" });
      expect(r.items.map((i) => i.id)).toContain(c.m40.id);
      expect(r.timing.semantic).toBe("used");
      const photo = await searchByImage(complete.tenantId, await rgbOf(RED));
      expect(photo.items.map((i) => i.id)).toContain(c.m40.id);
      expect(photo.items.map((i) => i.id)).not.toContain(s.m40.id);
      const sim = await similarProducts(complete.tenantId, c.m40.id);
      expect(sim.map((x) => x.id)).not.toContain(c.m40.id);
      const dup = await checkDuplicates(complete, { productId: c.m40.id, imageIds: [c.m40.imageId], embedder });
      expect(dup.state).toBe("ok");
    });

    it("translations and extra languages", async () => {
      expect(await shopServedLocales(complete.tenantId)).toEqual(["en", "nl", "de"]);
      expect(await enabledLocales(complete.tenantId)).toEqual(["nl", "de"]);
      await expect(listTranslations(complete, { view: "review" })).resolves.toMatchObject({ total: 0 });
      await expect(saveGlossaryTerm(complete, { locale: "nl", source: "liner", target: "voering" })).resolves.toMatchObject({ source: "liner" });
    });
  });
});

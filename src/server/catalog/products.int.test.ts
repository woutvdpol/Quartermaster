import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { ServiceContext } from "@/server/context";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import {
  bulkUpdate,
  bumpToTop,
  createProduct,
  deleteProduct,
  duplicateProduct,
  getProduct,
  listProducts,
  setStatus,
  updateProduct,
} from "./products";
import { createCategory } from "./categories";
import { createTag } from "./tags";
import { adjustStock } from "@/server/stock/ledger";
import { releaseReservation, reserveProduct } from "@/server/stock/reservations";
import { setJobTransportForTests, type EnqueuedJob } from "@/server/jobs/queue";

async function newCart(tenantId: string) {
  return db.cart.create({ data: { tenantId, tokenHash: `cart-${Math.random()}`, expiresAt: new Date(Date.now() + 86400_000) } });
}

describe("catalog/products", () => {
  let a: ServiceContext;
  let b: ServiceContext;
  beforeEach(async () => {
    await resetDb();
    a = await createTenantContext();
    b = await createTenantContext();
  });

  describe("createProduct", () => {
    it("issues per-tenant stockCodes from the sequence and books opening stock", async () => {
      const p1 = await createProduct(a, { title: "Helmet", price: 10000 });
      const p2 = await createProduct(a, { title: "Cap", quantity: 3 });
      const pb = await createProduct(b, { title: "Helmet" });
      expect([p1.stockCode, p2.stockCode, pb.stockCode]).toEqual([50000, 50001, 50000]);

      const full = await getProduct(a, p2.id);
      expect(full.status).toBe("DRAFT");
      expect(full.quantity).toBe(3);
      const moves = await db.stockMovement.findMany({ where: { productId: p2.id } });
      expect(moves).toHaveLength(1);
      expect(moves[0]).toMatchObject({ delta: 3, quantityAfter: 3, reason: "ADJUSTMENT", actorId: a.actor.id });
      expect(await db.auditLog.count({ where: { action: "product.create", tenantId: a.tenantId } })).toBe(2);
    });

    it("issues unique stockCodes under concurrency", async () => {
      const created = await Promise.all(Array.from({ length: 8 }, (_, i) => createProduct(a, { title: `Item ${i}` })));
      expect(new Set(created.map((p) => p.stockCode)).size).toBe(8);
    });

    it("leaves no stockCode gap when creation fails", async () => {
      await createProduct(a, { title: "One", sku: "SKU-1" });
      await expect(createProduct(a, { title: "Two", sku: "SKU-1" })).rejects.toMatchObject({ code: "CONFLICT" });
      const next = await createProduct(a, { title: "Three" });
      expect(next.stockCode).toBe(50001);
    });

    it("generates unique slugs per tenant with -2, -3 suffixes (also concurrently)", async () => {
      const s1 = await createProduct(a, { title: "Field Cap M43" });
      const s2 = await createProduct(a, { title: "Field cap m43" });
      const s3 = await createProduct(a, { title: "Field Cap — M43" });
      const other = await createProduct(b, { title: "Field Cap M43" });
      expect([s1.slug, s2.slug, s3.slug]).toEqual(["field-cap-m43", "field-cap-m43-2", "field-cap-m43-3"]);
      expect(other.slug).toBe("field-cap-m43");

      const many = await Promise.all(Array.from({ length: 5 }, () => createProduct(a, { title: "Dagger" })));
      expect(new Set(many.map((p) => p.slug)).size).toBe(5);
    });

    it("can create ACTIVE only with price and stock", async () => {
      await expect(createProduct(a, { title: "Free", status: "ACTIVE" })).rejects.toMatchObject({ code: "INVALID" });
      await expect(createProduct(a, { title: "None", price: 100, quantity: 0, status: "ACTIVE" })).rejects.toMatchObject({ code: "INVALID" });
      const ok = await createProduct(a, { title: "Ok", price: 100, status: "ACTIVE" });
      expect((await getProduct(a, ok.id)).publishedAt).toBeInstanceOf(Date);
    });

    it("validates input and references", async () => {
      await expect(createProduct(a, { title: "" })).rejects.toMatchObject({ code: "INVALID" });
      await expect(createProduct(a, { title: "x", price: -1 })).rejects.toMatchObject({ code: "INVALID" });
      await expect(createProduct(a, { title: "x", price: 1.5 })).rejects.toMatchObject({ code: "INVALID" });
      const catB = await createCategory(b, { title: "B's" });
      await expect(createProduct(a, { title: "x", categoryId: catB.id })).rejects.toMatchObject({ code: "INVALID" });
    });
  });

  describe("updateProduct", () => {
    it("patches fields, replaces tags, keeps slug unless asked", async () => {
      const p = await createProduct(a, { title: "Old title", price: 500 });
      const t1 = await createTag(a, { name: "Navy" });
      const t2 = await createTag(a, { name: "Army" });
      let full = await updateProduct(a, p.id, { title: "New title", purchasePrice: 200, tagIds: [t1.id, t2.id] });
      expect(full).toMatchObject({ title: "New title", slug: "old-title", purchasePrice: 200, margin: 300 });
      expect(full.tags.map((t) => t.name).sort()).toEqual(["Army", "Navy"]);
      full = await updateProduct(a, p.id, { regenerateSlug: true, tagIds: [t2.id] });
      expect(full.slug).toBe("new-title");
      expect(full.tags.map((t) => t.name)).toEqual(["Army"]);
    });

    it("rejects an explicit slug that is taken, and price 0 on an active product", async () => {
      await createProduct(a, { title: "Taken" });
      const p = await createProduct(a, { title: "Mine", price: 100 });
      await expect(updateProduct(a, p.id, { slug: "taken" })).rejects.toMatchObject({ code: "CONFLICT" });
      await setStatus(a, [p.id], "ACTIVE");
      await expect(updateProduct(a, p.id, { price: 0 })).rejects.toMatchObject({ code: "INVALID" });
    });
  });

  describe("setStatus", () => {
    it("enforces ACTIVE rules and sets publishedAt / soldAt", async () => {
      const free = await createProduct(a, { title: "Free" });
      const empty = await createProduct(a, { title: "Empty", price: 100, quantity: 0 });
      const ok = await createProduct(a, { title: "Ok", price: 100 });

      await expect(setStatus(a, [free.id], "ACTIVE")).rejects.toMatchObject({ code: "INVALID" });
      await expect(setStatus(a, [empty.id], "ACTIVE")).rejects.toMatchObject({ code: "INVALID" });
      // all-or-nothing
      const err = await setStatus(a, [ok.id, free.id], "ACTIVE").catch((e) => e);
      expect(err).toMatchObject({ code: "INVALID", details: [{ id: free.id, reason: "Price must be above 0" }] });
      expect((await getProduct(a, ok.id)).status).toBe("DRAFT");

      expect(await setStatus(a, [ok.id], "ACTIVE")).toEqual({ updated: 1 });
      const active = await getProduct(a, ok.id);
      expect(active.publishedAt).toBeInstanceOf(Date);

      await setStatus(a, [ok.id], "SOLD");
      const sold = await getProduct(a, ok.id);
      expect(sold.status).toBe("SOLD");
      expect(sold.soldAt).toBeInstanceOf(Date);
      expect(sold.publishedAt).toEqual(active.publishedAt);

      // ARCHIVED from anything, even a product that could never be ACTIVE
      expect(await setStatus(a, [ok.id, free.id, empty.id], "ARCHIVED")).toEqual({ updated: 3 });
      // already in target status → no-op
      expect(await setStatus(a, [ok.id], "ARCHIVED")).toEqual({ updated: 0 });
    });

    it("releases a live cart reservation when leaving ACTIVE", async () => {
      const p = await createProduct(a, { title: "Held", price: 100, status: "ACTIVE" });
      const cart = await newCart(a.tenantId);
      await reserveProduct({ tenantId: a.tenantId, productId: p.id, cartId: cart.id, minutes: 15 });
      await setStatus(a, [p.id], "ARCHIVED");
      expect(await db.reservation.findFirst({ where: { productId: p.id } })).toMatchObject({ status: "RELEASED" });
    });
  });

  describe("tenant isolation", () => {
    it("tenant B cannot read or change tenant A's product", async () => {
      const p = await createProduct(a, { title: "Secret", price: 100 });
      await expect(getProduct(b, p.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(getProduct(b, { stockCode: p.stockCode + 1000 })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(updateProduct(b, p.id, { title: "Hacked" })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(setStatus(b, [p.id], "ARCHIVED")).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(bumpToTop(b, [p.id])).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(bulkUpdate(b, [p.id], { priceAdjustPercent: 50 })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(duplicateProduct(b, p.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(deleteProduct(b, p.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(adjustStock(b, p.id, { quantity: 0 })).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect((await listProducts(b)).rows).toHaveLength(0);
      const still = await getProduct(a, p.id);
      expect(still).toMatchObject({ title: "Secret", status: "DRAFT", price: 100, quantity: 1 });
      // stockCode lookup is per tenant: B's own 50000 is a different product
      const own = await createProduct(b, { title: "B item" });
      expect((await getProduct(b, { stockCode: own.stockCode })).id).toBe(own.id);
      expect((await getProduct(a, { stockCode: p.stockCode })).id).toBe(p.id);
    });
  });

  describe("bulk + misc", () => {
    it("bumps, bulk-updates category / price / tags", async () => {
      const cat = await createCategory(a, { title: "Helmets" });
      const t1 = await createTag(a, { name: "WW2" });
      const t2 = await createTag(a, { name: "Rare" });
      const p1 = await createProduct(a, { title: "One", price: 1999, tagIds: [t2.id] });
      const p2 = await createProduct(a, { title: "Two", price: 15 });
      await bumpToTop(a, [p1.id]);
      expect((await getProduct(a, p1.id)).publishedAt).toBeInstanceOf(Date);

      await bulkUpdate(a, [p1.id, p2.id], { categoryId: cat.id, priceAdjustPercent: 10, tagIdsAdd: [t1.id], tagIdsRemove: [t2.id] });
      const [r1, r2] = await Promise.all([getProduct(a, p1.id), getProduct(a, p2.id)]);
      expect([r1.price, r2.price]).toEqual([2199, 17]); // 2198.9 → 2199, 16.5 → 17
      expect(r1.category?.id).toBe(cat.id);
      expect(r1.tags.map((t) => t.name)).toEqual(["WW2"]);
      expect(r2.tags.map((t) => t.name)).toEqual(["WW2"]);
      await expect(bulkUpdate(a, [p1.id], {})).rejects.toMatchObject({ code: "INVALID" });
    });

    it("duplicates into a new DRAFT without images", async () => {
      const t = await createTag(a, { name: "Navy" });
      const src = await createProduct(a, { title: "Badge", price: 700, sku: "B-1", tagIds: [t.id], status: "ACTIVE" });
      await db.productImage.create({ data: { tenantId: a.tenantId, productId: src.id, storageKey: `${a.tenantId}/x.jpg` } });
      const copy = await duplicateProduct(a, src.id);
      const full = await getProduct(a, copy.id);
      expect(full).toMatchObject({ title: "Badge", status: "DRAFT", sku: null, price: 700, quantity: 1, slug: "badge-2", publishedAt: null });
      expect(full.stockCode).toBe(src.stockCode + 1);
      expect(full.tags.map((x) => x.id)).toEqual([t.id]);
      expect(full.images).toHaveLength(0);
    });

    it("deletes only clean drafts", async () => {
      const draft = await createProduct(a, { title: "Draft" });
      const active = await createProduct(a, { title: "Active", price: 100, status: "ACTIVE" });
      const moved = await createProduct(a, { title: "Moved" });
      await adjustStock(a, moved.id, { delta: 2 });
      await expect(deleteProduct(a, active.id)).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(deleteProduct(a, moved.id)).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await deleteProduct(a, draft.id)).toMatchObject({ stockCode: draft.stockCode, imageStorageKeys: [] });
      await expect(getProduct(a, draft.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("refuses to delete a draft that appears on an order", async () => {
      const p = await createProduct(a, { title: "Ordered" });
      const order = await db.order.create({
        data: { tenantId: a.tenantId, number: 1, email: "x@y.z", customerName: "X", subtotal: 0, total: 0, currency: "EUR" },
      });
      await db.orderLine.create({ data: { tenantId: a.tenantId, orderId: order.id, productId: p.id, title: "Ordered", unitPrice: 0, lineTotal: 0 } });
      await expect(deleteProduct(a, p.id)).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  describe("listProducts", () => {
    async function seed() {
      const cat = await createCategory(a, { title: "Helmets" });
      const tag = await createTag(a, { name: "Rare" });
      const forSale = await createProduct(a, { title: "M35 Helmet", sku: "HLM-35", price: 50000, purchasePrice: 30000, status: "ACTIVE", categoryId: cat.id, tagIds: [tag.id] });
      const inCart = await createProduct(a, { title: "Field Cap", price: 8000, status: "ACTIVE" });
      const draft = await createProduct(a, { title: "Draft Badge", price: 0 });
      const sold = await createProduct(a, { title: "Sold Dagger", price: 20000, status: "ACTIVE" });
      await setStatus(a, [sold.id], "SOLD");
      const archived = await createProduct(a, { title: "Archived Belt", price: 3000 });
      await setStatus(a, [archived.id], "ARCHIVED");
      await db.productImage.createMany({
        data: [
          { tenantId: a.tenantId, productId: forSale.id, storageKey: `${a.tenantId}/h1.jpg`, sortOrder: 1 },
          { tenantId: a.tenantId, productId: forSale.id, storageKey: `${a.tenantId}/h0.jpg`, sortOrder: 0 },
          { tenantId: a.tenantId, productId: sold.id, storageKey: `${a.tenantId}/s0.jpg`, sortOrder: 0 },
        ],
      });
      const cart = await newCart(a.tenantId);
      await reserveProduct({ tenantId: a.tenantId, productId: inCart.id, cartId: cart.id, minutes: 15 });
      await createProduct(b, { title: "Other tenant helmet", price: 100, status: "ACTIVE" });
      return { cat, tag, forSale, inCart, draft, sold, archived };
    }

    it("returns per-view counts and rows with cover, category, margin and reservation", async () => {
      const s = await seed();
      const res = await listProducts(a, { view: "forSale" });
      expect(res.counts).toEqual({ all: 4, forSale: 1, inCart: 1, draft: 1, sold: 1, archived: 1, noPhoto: 2 });
      expect(res.total).toBe(1);
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0]).toMatchObject({
        id: s.forSale.id,
        margin: 20000,
        category: { id: s.cat.id, title: "Helmets" },
        cover: { storageKey: `${a.tenantId}/h0.jpg` },
        reservedUntil: null,
      });
      const cart = await listProducts(a, { view: "inCart" });
      expect(cart.rows.map((r) => r.id)).toEqual([s.inCart.id]);
      expect(cart.rows[0].reservedUntil).toBeInstanceOf(Date);
      expect((await listProducts(a, { view: "noPhoto" })).rows.map((r) => r.id).sort()).toEqual([s.inCart.id, s.draft.id].sort());
      expect((await listProducts(a, { view: "archived" })).rows.map((r) => r.id)).toEqual([s.archived.id]);
    });

    it("filters by search, category, tags, price and applies them to counts", async () => {
      const s = await seed();
      const byTitle = await listProducts(a, { search: "helmet" });
      expect(byTitle.rows.map((r) => r.id)).toEqual([s.forSale.id]);
      expect(byTitle.counts.all).toBe(1);
      expect(byTitle.counts.inCart).toBe(0);
      expect((await listProducts(a, { search: "hlm-3" })).rows.map((r) => r.id)).toEqual([s.forSale.id]);
      expect((await listProducts(a, { search: `#${s.draft.stockCode}` })).rows.map((r) => r.id)).toEqual([s.draft.id]);
      expect((await listProducts(a, { search: "100%_" })).rows).toHaveLength(0);
      expect((await listProducts(a, { categoryId: s.cat.id })).rows.map((r) => r.id)).toEqual([s.forSale.id]);
      expect((await listProducts(a, { categoryId: null })).total).toBe(3);
      expect((await listProducts(a, { tagIds: [s.tag.id] })).rows.map((r) => r.id)).toEqual([s.forSale.id]);
      const priced = await listProducts(a, { priceMin: 8000, priceMax: 20000, sort: "price" });
      expect(priced.rows.map((r) => r.id)).toEqual([s.inCart.id, s.sold.id]);
    });

    it("sorts and paginates by page and by cursor", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 7; i++) ids.push((await createProduct(a, { title: `Item ${i}`, price: 100 * (i + 1) })).id);
      const byCode = await listProducts(a, { sort: "stockCode", dir: "asc", pageSize: 3, page: 2 });
      expect(byCode.rows.map((r) => r.id)).toEqual(ids.slice(3, 6));
      expect(byCode.total).toBe(7);

      for (const sort of ["publishedAt", "price", "stockCode", "title"] as const) {
        const seen: string[] = [];
        let cursor: string | undefined;
        do {
          const page = await listProducts(a, { sort, pageSize: 3, cursor });
          seen.push(...page.rows.map((r) => r.id));
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        expect(new Set(seen).size).toBe(7);
      }
      const desc = await listProducts(a, { sort: "price", dir: "desc", pageSize: 2 });
      expect(desc.rows.map((r) => r.price)).toEqual([700, 600]);
      await expect(listProducts(a, { sort: "price", cursor: desc.nextCursor! })).rejects.toMatchObject({ code: "INVALID" });
      await expect(listProducts(a, { pageSize: 101 })).rejects.toMatchObject({ code: "INVALID" });
    });
  });

  describe("deactivation certificate guard", () => {
    it("blocks ACTIVE for flagged products without a DEACTIVATION_CERT document", async () => {
      await expect(createProduct(a, { title: "Kar98k (deact.)", price: 90000, status: "ACTIVE", requiresDeactivationCert: true })).rejects.toMatchObject({
        code: "INVALID",
      });
      const gun = await createProduct(a, { title: "Kar98k (deact.)", price: 90000, requiresDeactivationCert: true });
      const helmet = await createProduct(a, { title: "Helmet", price: 10000 });
      await expect(setStatus(a, [gun.id, helmet.id], "ACTIVE")).rejects.toMatchObject({
        code: "INVALID",
        details: [{ id: gun.id, stockCode: gun.stockCode, reason: expect.stringMatching(/certificate/i) }],
      });
      // All-or-nothing: the helmet did not change either.
      expect((await getProduct(a, helmet.id)).status).toBe("DRAFT");

      await db.productDocument.create({
        data: { tenantId: a.tenantId, productId: gun.id, kind: "DEACTIVATION_CERT", title: "Cert", storageKey: "k", mimeType: "application/pdf", byteSize: 1 },
      });
      expect(await setStatus(a, [gun.id, helmet.id], "ACTIVE")).toEqual({ updated: 2 });
      // Other target statuses are never blocked.
      const other = await createProduct(a, { title: "Other", price: 100, requiresDeactivationCert: true });
      expect(await setStatus(a, [other.id], "ARCHIVED")).toEqual({ updated: 1 });
    });
  });

  describe("alert hooks", () => {
    let jobs: EnqueuedJob[];
    beforeEach(() => {
      jobs = [];
      setJobTransportForTests((job) => void jobs.push(job));
    });
    afterEach(() => setJobTransportForTests(null));
    const named = (name: string) => jobs.filter((j) => j.name === name).map((j) => j.data);

    it("queues match jobs on publish / bump and price-drop jobs on decreases only", async () => {
      const active = await createProduct(a, { title: "Helmet", price: 10000, status: "ACTIVE" });
      const draft = await createProduct(a, { title: "Cap", price: 5000 });
      expect(named("alerts.match-product")).toEqual([{ tenantId: a.tenantId, productId: active.id }]);

      jobs.length = 0;
      await setStatus(a, [draft.id, active.id], "ACTIVE");
      expect(named("alerts.match-product")).toEqual([{ tenantId: a.tenantId, productId: draft.id }]);

      jobs.length = 0;
      await bumpToTop(a, [active.id]);
      expect(named("alerts.match-product")).toEqual([{ tenantId: a.tenantId, productId: active.id }]);

      jobs.length = 0;
      await updateProduct(a, active.id, { price: 12000 });
      await updateProduct(a, active.id, { title: "Helmet M35" });
      expect(named("alerts.price-drop")).toEqual([]);
      await updateProduct(a, active.id, { price: 9000 });
      expect(named("alerts.price-drop")).toEqual([{ tenantId: a.tenantId, productId: active.id, oldPrice: 12000, newPrice: 9000 }]);

      jobs.length = 0;
      await bulkUpdate(a, [active.id, draft.id], { priceAdjustPercent: -10 });
      expect(named("alerts.price-drop")).toEqual(
        expect.arrayContaining([
          { tenantId: a.tenantId, productId: active.id, oldPrice: 9000, newPrice: 8100 },
          { tenantId: a.tenantId, productId: draft.id, oldPrice: 5000, newPrice: 4500 },
        ]),
      );
      jobs.length = 0;
      await bulkUpdate(a, [active.id], { priceAdjustPercent: 10 });
      expect(named("alerts.price-drop")).toEqual([]);
    });

    it("queues a back-available job (inside the tx) when a cart hold is released", async () => {
      const p = await createProduct(a, { title: "Helmet", price: 10000, status: "ACTIVE" });
      const cart = await newCart(a.tenantId);
      await reserveProduct({ tenantId: a.tenantId, productId: p.id, cartId: cart.id });
      jobs.length = 0;
      expect(await releaseReservation({ tenantId: a.tenantId, productId: p.id, cartId: cart.id })).toBe(1);
      expect(jobs.filter((j) => j.name === "alerts.back-available")).toEqual([
        expect.objectContaining({ data: { tenantId: a.tenantId, productId: p.id, excludeCustomerId: null }, options: expect.objectContaining({ inTransaction: false }) }),
      ]);
      jobs.length = 0;
      expect(await releaseReservation({ tenantId: a.tenantId, productId: p.id })).toBe(0);
      expect(named("alerts.back-available")).toEqual([]);
    });
  });
});

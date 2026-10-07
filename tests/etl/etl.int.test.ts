import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { LocalDriver } from "@/server/media/storage";
import { resetDb } from "../integration/helpers";
import type { EtlOptions } from "../../scripts/etl/context";
import type { ImageDownloader } from "../../scripts/etl/images";
import { MemoryLegacyReader } from "../../scripts/etl/legacy/readers";
import { runEtl } from "../../scripts/etl/run";
import { BCRYPT, CF, legacyFixture } from "./fixture";

/** Test double: a tiny generated JPEG instead of Cloudflare (owner: no real downloads yet). */
class FakeDownloader implements ImageDownloader {
  readonly name = "fake";
  calls: string[] = [];
  async download(id: string) {
    this.calls.push(id);
    const bytes = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#884422" } }).jpeg().toBuffer();
    return { bytes: new Uint8Array(bytes), contentType: "image/jpeg" };
  }
}

const uploads = mkdtempSync(path.join(tmpdir(), "qm-etl-"));
afterAll(() => rmSync(uploads, { recursive: true, force: true }));

const options = (over: Partial<EtlOptions> = {}): EtlOptions => ({
  tenantSlug: "etl-import",
  domain: "etl-import.localhost:3000",
  dryRun: false,
  only: null,
  skipImages: false,
  legacyHosts: ["old.example.test"],
  zoneCountries: {},
  facetMapCsv: "legacy_tag_id,facet_kind,value_name,parent\n1,PERIOD,WW2,\n2,BRANCH,Luftwaffe,",
  force: false,
  now: new Date("2026-10-07T12:00:00Z"),
  ...over,
});

const run = (over: Partial<EtlOptions> = {}, downloader: ImageDownloader | null = null) =>
  runEtl({ prisma: db, legacy: new MemoryLegacyReader(legacyFixture()), options: options(over), downloader, storage: new LocalDriver(uploads) });

async function counts(tenantId: string) {
  const where = { tenantId };
  return {
    products: await db.product.count({ where }),
    images: await db.productImage.count({ where }),
    orders: await db.order.count({ where }),
    lines: await db.orderLine.count({ where }),
    payments: await db.payment.count({ where }),
    events: await db.orderEvent.count({ where }),
    customers: await db.customer.count({ where }),
    users: await db.user.count({ where }),
    addresses: await db.address.count({ where }),
    movements: await db.stockMovement.count({ where }),
    pages: await db.contentPage.count({ where }),
    blocks: await db.contentBlock.count({ where }),
    menus: await db.menuItem.count({ where }),
    redirects: await db.redirect.count({ where }),
    subscribers: await db.newsletterSubscriber.count({ where }),
    campaigns: await db.newsletterCampaign.count({ where }),
    zones: await db.shippingZone.count({ where }),
    productTags: await db.productTag.count({ where }),
    facetLinks: await db.productFacetValue.count({ where }),
  };
}

describe("Concept500 ETL", () => {
  beforeEach(resetDb);

  it("dry run writes nothing", async () => {
    const res = await run({ dryRun: true });
    expect(res.ok, res.error).toBe(true);
    expect(res.report.entity("products").created).toBe(5);
    expect(await db.tenant.count({ where: { slug: "etl-import" } })).toBe(0);
    expect(await db.product.count()).toBe(0);
  });

  it("imports the fixture and is idempotent", async () => {
    const downloader = new FakeDownloader();
    const first = await run({}, downloader);
    expect(first.ok, first.error).toBe(true);
    const tenantId = first.tenantId!;
    const c1 = await counts(tenantId);
    expect(c1).toMatchObject({ products: 5, images: 3, orders: 6, lines: 6, users: 2, customers: 3, addresses: 1, zones: 2, subscribers: 2, campaigns: 2, productTags: 2, facetLinks: 2 });

    // Products: StockCode kept, slugs unique, status derived, SKU duplicate cleared, ledger consistent.
    const products = await db.product.findMany({ where: { tenantId }, orderBy: { stockCode: "asc" } });
    expect(products.map((p) => p.slug)).toEqual(["item-50000", "item-50000-2", "item-50002", "test", "test-2"]);
    expect(products.map((p) => p.status)).toEqual(["ACTIVE", "ACTIVE", "SOLD", "DRAFT", "DRAFT"]);
    expect(products.map((p) => p.sku)).toEqual(["A1", null, null, null, null]);
    expect(products[0].specifications).toEqual([{ label: "Maker", value: "EF" }]);
    for (const p of products) {
      const sum = await db.stockMovement.aggregate({ where: { productId: p.id }, _sum: { delta: true } });
      expect(sum._sum.delta ?? 0).toBe(p.quantity);
    }
    const helmets = await db.category.findFirstOrThrow({ where: { tenantId, legacyId: 2 } });
    expect(helmets.parentId).not.toBeNull();

    // Images downloaded through the fake, in photo order.
    expect(downloader.calls.sort()).toEqual([...CF].sort());
    const imgs = await db.productImage.findMany({ where: { tenantId, product: { stockCode: 50000 } }, orderBy: { sortOrder: "asc" } });
    expect(imgs.map((i) => i.legacyCloudflareId)).toEqual([CF[0], CF[1]]);
    expect(imgs.every((i) => i.processedAt && i.variants)).toBe(true);

    // Orders: numbers kept, reconstructed prices, statuses, totals consistent.
    const orders = await db.order.findMany({ where: { tenantId }, include: { lines: true, payments: true, addresses: true }, orderBy: { number: "asc" } });
    const byNo = new Map(orders.map((o) => [o.number, o]));
    expect(byNo.get(2)!.paymentStatus).toBe("PENDING");
    expect(byNo.get(2)!.lines.map((l) => [l.quantity, l.unitPrice, l.lineTotal])).toEqual([
      [2, 4462, 8924],
      [1, 175, 175],
    ]);
    expect(byNo.get(3)!.paymentStatus).toBe("PENDING"); // manual + order_paid_on: never inferred as paid
    expect(byNo.get(4)!.paymentStatus).toBe("FAILED");
    expect(byNo.get(5)!.archivedAt).not.toBeNull();
    expect((byNo.get(5)!.legacyData as Record<string, unknown>).legacyNoLines).toBe(true);
    expect(byNo.get(6)!.addresses[0].countryCode).toBe("ZZ");
    for (const o of orders) {
      expect(o.subtotal - o.discountTotal + o.shippingTotal + o.surchargeTotal).toBe(o.total);
      expect(o.lines.every((l) => l.priceReconstructed)).toBe(true);
    }
    expect(byNo.get(1)!.payments).toMatchObject([{ provider: "MANUAL", status: "PAID", amount: 9462 }]);
    expect(first.report.revenue).toMatchObject({ legacyPaidTotal: 14837, newPaidTotal: 14837, newPaidOrders: 3 });

    // Users: bcrypt hash kept with prefix; customer linked to user; order 6 linked to that customer.
    const owner = await db.user.findFirstOrThrow({ where: { tenantId, role: "OWNER" } });
    expect(owner.passwordHash).toBe(`bcrypt$${BCRYPT}`);
    const customerUser = await db.user.findFirstOrThrow({ where: { tenantId, role: "CUSTOMER" }, include: { customer: true } });
    expect(byNo.get(6)!.customerId).toBe(customerUser.customer!.id);
    expect(await db.wishlistItem.count({ where: { tenantId } })).toBe(1);

    // Sequences advanced.
    const seq = await db.tenantSequence.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
    expect(seq.map((s) => [s.name, s.value])).toEqual([
      ["order.number", 6],
      ["product.stockCode", 50004],
    ]);

    // Content: home + reserved slug, blocks valid, links relative, NEWS draft (setting off).
    const home = await db.contentPage.findFirstOrThrow({ where: { tenantId, systemKey: "HOME" }, include: { blocks: { orderBy: { sortOrder: "asc" } } } });
    expect(home.blocks.map((b) => b.type)).toEqual(["HERO", "NEW_ITEMS", "NEWSLETTER_SIGNUP"]);
    expect((home.blocks[0].data as { cta: { href: string } }).cta.href).toBe("/shop");
    const shopPage = await db.contentPage.findFirstOrThrow({ where: { tenantId, legacyId: 2 } });
    expect(shopPage.slug).toBe("shop-2");
    const news = await db.contentPage.findFirstOrThrow({ where: { tenantId, slug: "news" } });
    expect(news.publishedAt).toBeNull();
    const footer = await db.menuItem.findMany({ where: { tenantId, location: "FOOTER" } });
    expect(footer.some((m) => m.parentId !== null)).toBe(true);

    // Redirects: normalised, relative targets, no rows for runtime-handled patterns.
    const redirects = await db.redirect.findMany({ where: { tenantId } });
    expect(redirects.every((r) => r.source === "LEGACY" && r.toPath.startsWith("/"))).toBe(true);
    expect(redirects.map((r) => r.fromPath)).toEqual(expect.arrayContaining(["/pages/shop", "/shop/category/head gear", "/home"]));
    expect(redirects.some((r) => r.fromPath.startsWith("/product/") || r.fromPath.startsWith("/shop.php?"))).toBe(false);

    // Payment surcharges: legacy "Paypal" 5% → Mollie `paypal` rule (500 bp).
    const paymentsRow = await db.setting.findUniqueOrThrow({ where: { tenantId_group: { tenantId, group: "payments" } } });
    expect((paymentsRow.data as { surcharges: unknown }).surcharges).toEqual({ paypal: { percentBps: 500, fixed: 0, cap: null, label: "PayPal fee" } });

    // ── second run: same result, nothing new ──
    const second = await run({}, downloader);
    expect(second.ok, second.error).toBe(true);
    expect(await counts(tenantId)).toEqual(c1);
    for (const entity of ["products", "orders", "categories", "tags", "redirects", "users (staff)", "customers (uit orders)", "product images"]) {
      expect(second.report.entity(entity).created, entity).toBe(0);
    }
    expect(second.report.entity("products").unchanged).toBe(5);
    expect(second.report.entity("orders").unchanged).toBe(6);
    expect(downloader.calls).toHaveLength(3); // no re-download
    expect(second.report.revenue?.newPaidTotal).toBe(first.report.revenue?.newPaidTotal);
    expect(second.report.entity("payment surcharges")).toMatchObject({ created: 0, unchanged: 1 });
  });

  it("does not overwrite a password that was rehashed after migration", async () => {
    const first = await run({ skipImages: true });
    const owner = await db.user.findFirstOrThrow({ where: { tenantId: first.tenantId!, role: "OWNER" } });
    await db.user.update({ where: { id: owner.id }, data: { passwordHash: "scrypt$32768$8$1$salt$hash" } });
    await run({ skipImages: true, only: ["users"] });
    expect((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).passwordHash).toBe("scrypt$32768$8$1$salt$hash");
    // Without a downloader, images stay placeholders for a later run.
    expect(await db.productImage.count({ where: { tenantId: first.tenantId!, processedAt: null } })).toBe(3);
  });

  it("refuses a tenant with non-ETL catalog data", async () => {
    const tenant = await db.tenant.create({ data: { slug: "etl-import", name: "Demo" } });
    await db.product.create({ data: { tenantId: tenant.id, stockCode: 1, slug: "x", title: "x", price: 1, legacyData: { demo: true } } });
    const res = await run();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not imported by this ETL/);
  });
});

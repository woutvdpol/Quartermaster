import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { db } from "@/server/db";
import type { ServiceContext } from "@/server/context";
import { LocalDriver, setStorageForTests } from "@/server/media/storage";
import { createPurchaseRecord, createSupplier, listPurchaseRecords, marginReport, setPurchasePrices } from "@/server/purchasing";
import { getInsightsOverview, repriceStaleItem } from "@/server/insights";
import { addProductDocument, deleteProductDocument, listProductDocuments, updateProductDocument } from "./documents";
import { issueCertificate, listCertificates, revokeCertificate, verifyCertificate } from "./certificates";

/*
 * Paid modules "provenance" and "insights" (docs/modules.md): a START shop is refused new module
 * activity, while certificates already issued to buyers keep verifying after a downgrade.
 */

let stock = 70000;
let root: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "qm-modules-trust-int-"));
  setStorageForTests(new LocalDriver(root));
});
afterAll(async () => {
  setStorageForTests(null);
  await fs.rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
  await resetDb();
});

async function createProduct(ctx: ServiceContext) {
  stock += 1;
  return db.product.create({ data: { tenantId: ctx.tenantId, stockCode: stock, slug: `p-${stock}`, title: `Helmet M35 #${stock}`, price: 1000, status: "ACTIVE" } });
}

const pdf = () => ({ name: "Letter.pdf", bytes: new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n") });
const unavailable = { code: "UNAVAILABLE" };

describe("module gating: provenance and insights", () => {
  it("START: module activity is refused with UNAVAILABLE", async () => {
    const ctx = await createTenantContext({ plan: "START" });
    const product = await createProduct(ctx);

    await expect(createSupplier(ctx, { name: "Estate sale" })).rejects.toMatchObject({ ...unavailable, details: { module: "provenance" } });
    await expect(createPurchaseRecord(ctx, { purchasedAt: new Date() })).rejects.toMatchObject(unavailable);
    await expect(marginReport(ctx, { from: new Date(Date.now() - 86_400_000), to: new Date(), groupBy: "month" })).rejects.toMatchObject(unavailable);
    await expect(issueCertificate(ctx, product.id)).rejects.toMatchObject(unavailable);
    await expect(addProductDocument(ctx, product.id, { kind: "PROVENANCE", file: pdf() })).rejects.toMatchObject(unavailable);
    await expect(getInsightsOverview(ctx, {}, { cached: false })).rejects.toMatchObject({ ...unavailable, details: { module: "insights" } });
    await expect(repriceStaleItem(ctx, { productId: product.id, expectedPrice: 1000, price: 900 })).rejects.toMatchObject(unavailable);
    expect(await db.certificate.count()).toBe(0);
    expect(await db.supplier.count()).toBe(0);
  });

  it("START: core product fields and inventory reads keep working", async () => {
    const ctx = await createTenantContext({ plan: "START" });
    const product = await createProduct(ctx);
    await expect(setPurchasePrices(ctx, { prices: [{ productId: product.id, purchasePrice: 400 }] })).resolves.toMatchObject({ updated: 1 });
    await expect(listPurchaseRecords(ctx)).resolves.toMatchObject({ items: [], total: 0 });
  });

  it("an issued certificate stays verifiable (and revocable) after a downgrade to START", async () => {
    const ctx = await createTenantContext({ plan: "COMPLETE" });
    const product = await createProduct(ctx);
    const cert = await issueCertificate(ctx, product.id);
    const doc = await addProductDocument(ctx, product.id, { kind: "PROVENANCE", isPublic: true, file: pdf() });

    await db.tenantPlan.update({ where: { tenantId: ctx.tenantId }, data: { plan: "START" } });

    await expect(verifyCertificate(ctx.tenantId, cert.code)).resolves.toMatchObject({ status: "valid", certificate: { code: cert.code } });
    await expect(listCertificates(ctx, product.id)).resolves.toHaveLength(1);
    await expect(listProductDocuments(ctx, product.id)).resolves.toHaveLength(1);
    // Wind-down stays possible; new activity does not.
    await expect(updateProductDocument(ctx, doc.id, { title: "Renamed" })).rejects.toMatchObject(unavailable);
    await expect(updateProductDocument(ctx, doc.id, { isPublic: false })).resolves.toMatchObject({ isPublic: false });
    await expect(revokeCertificate(ctx, cert.id, "Sold as a replica")).resolves.toMatchObject({ valid: false });
    await expect(verifyCertificate(ctx.tenantId, cert.code)).resolves.toMatchObject({ status: "revoked" });
    await expect(issueCertificate(ctx, product.id)).rejects.toMatchObject(unavailable);
    await deleteProductDocument(ctx, doc.id);
  });

  it("COMPLETE: every module service works", async () => {
    const ctx = await createTenantContext({ plan: "COMPLETE" });
    const product = await createProduct(ctx);
    const supplier = await createSupplier(ctx, { name: "Estate sale" });
    const record = await createPurchaseRecord(ctx, { purchasedAt: new Date(), supplierId: supplier.id, productIds: [product.id] });
    expect(record.supplierId).toBe(supplier.id);
    await expect(listPurchaseRecords(ctx)).resolves.toMatchObject({ total: 1 });
    await expect(marginReport(ctx, { from: new Date(Date.now() - 86_400_000), to: new Date(), groupBy: "supplier" })).resolves.toMatchObject({ groups: [] });
    await expect(issueCertificate(ctx, product.id)).resolves.toMatchObject({ valid: true });
    await expect(getInsightsOverview(ctx, {}, { cached: false })).resolves.toBeDefined();
  });
});

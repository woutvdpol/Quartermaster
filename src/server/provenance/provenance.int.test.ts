import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { db } from "@/server/db";
import type { ServiceContext } from "@/server/context";
import type { Prisma } from "@/generated/prisma/client";
import type { ProductStatus } from "@/generated/prisma/enums";
import { LocalDriver, setStorageForTests } from "@/server/media/storage";
import { addProductImages, tenantStorageUsage } from "@/server/media/product-images";
import {
  addProductDocument,
  deleteProductDocument,
  listProductDocuments,
  listPublicDocuments,
  resolveDocumentAccess,
  tenantTotalStorageUsage,
  updateProductDocument,
} from "./documents";
import { getProvenance, updateProvenance } from "./provenance";
import {
  VERIFY_RATE_LIMIT,
  findCertificateForStaff,
  issueCertificate,
  listCertificates,
  revokeCertificate,
  setCodeGeneratorForTests,
  verifyCertificate,
  verifyCertificateForVisitor,
} from "./certificates";
import { queryPublicProvenance } from "./public";
import { CERTIFICATE_CODE_PATTERN } from "./code";

// Route handlers: no Next request scope here; the session / host are injected per test.
const auth = vi.hoisted(() => ({ user: null as null | { id: string; role: "SUPERADMIN" | "OWNER" | "CUSTOMER"; tenantId: string | null; email: string } }));
const host = vi.hoisted(() => ({ tenant: null as null | { id: string } }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/server/auth/guards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/guards")>()),
  currentUser: async () => auth.user,
}));
vi.mock("@/server/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/tenant")>()),
  getRequestTenant: async () => host.tenant,
}));

let root: string;
let driver: LocalDriver;
let stock = 50000;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "qm-provenance-int-"));
  driver = new LocalDriver(root);
  setStorageForTests(driver);
});
afterAll(async () => {
  setStorageForTests(null);
  await fs.rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
  await resetDb();
  auth.user = null;
  host.tenant = null;
  setCodeGeneratorForTests(null);
});

async function createProduct(ctx: ServiceContext, data: Partial<Prisma.ProductUncheckedCreateInput> = {}) {
  stock += 1;
  return db.product.create({
    data: { tenantId: ctx.tenantId, stockCode: stock, slug: `p-${stock}`, title: `Helmet M35 #${stock}`, price: 1000, status: "ACTIVE", ...data },
  });
}

const pdfBytes = () => ({ name: "Letter_1944.pdf", bytes: new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n") });
async function jpegBytes(name = "label.jpg") {
  const bytes = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 120, g: 90, b: 40 } } }).jpeg().toBuffer();
  return { name, bytes: new Uint8Array(bytes) };
}
const owner = (ctx: ServiceContext) => ({ id: ctx.actor.id, role: "OWNER" as const, tenantId: ctx.tenantId, email: ctx.actor.email });

describe("provenance text", () => {
  it("updates only provenance + guarantee, audits product.provenance, tenant-scoped", async () => {
    const ctx = await createTenantContext();
    const other = await createTenantContext();
    const product = await createProduct(ctx, { notes: "internal" });
    const updated = await updateProvenance(ctx, product.id, { provenance: "  From the **Smith** collection.\r\n", authenticityGuaranteed: true });
    expect(updated).toMatchObject({ provenance: "From the **Smith** collection.", authenticityGuaranteed: true, status: "ACTIVE" });
    const row = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(row.notes).toBe("internal");
    expect(await db.auditLog.count({ where: { action: "product.provenance", tenantId: ctx.tenantId } })).toBe(1);

    await updateProvenance(ctx, product.id, { provenance: "", authenticityGuaranteed: false });
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).provenance).toBeNull();
    await expect(getProvenance(other, product.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateProvenance(other, product.id, { provenance: "x", authenticityGuaranteed: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateProvenance(ctx, product.id, { provenance: "x".repeat(20_001), authenticityGuaranteed: true })).rejects.toMatchObject({ code: "INVALID" });
  });
});

describe("documents", () => {
  it("stores PDFs and re-encoded images under the product docs prefix and counts them in the quota", async () => {
    const ctx = await createTenantContext();
    const product = await createProduct(ctx);
    const pdf = await addProductDocument(ctx, product.id, { kind: "PROVENANCE", file: pdfBytes() });
    expect(pdf).toMatchObject({ title: "Letter 1944", mimeType: "application/pdf", isPublic: false, url: `/api/documents/${pdf.id}` });
    expect(pdf.id).toMatch(/^d[0-9a-f]{24}$/);
    const row = await db.productDocument.findUniqueOrThrow({ where: { id: pdf.id } });
    expect(row.storageKey).toBe(`${ctx.tenantId}/products/${product.id}/docs/${pdf.id}.pdf`);
    expect(await driver.exists(row.storageKey)).toBe(true);

    const img = await addProductDocument(ctx, product.id, { kind: "DEACTIVATION_CERT", title: "EU cert", isPublic: true, file: await jpegBytes() });
    expect(img).toMatchObject({ title: "EU cert", mimeType: "image/jpeg", isPublic: true });
    expect((await listProductDocuments(ctx, product.id)).map((d) => d.id)).toEqual([pdf.id, img.id]);

    expect(await tenantStorageUsage(ctx.tenantId)).toBe(0); // media counts images only
    expect(await tenantTotalStorageUsage(ctx.tenantId)).toBe(pdf.byteSize + img.byteSize);
    expect(await db.auditLog.count({ where: { action: "product.document.added" } })).toBe(2);
  });

  it("rejects bad files, foreign products and quota overruns without leaving files", async () => {
    const ctx = await createTenantContext();
    const other = await createTenantContext();
    const product = await createProduct(ctx);
    await expect(
      addProductDocument(ctx, product.id, { kind: "OTHER", file: { name: "x.pdf", bytes: new TextEncoder().encode("<html>") } }),
    ).rejects.toMatchObject({ code: "INVALID", details: { field: "file", reason: "UNSUPPORTED_FORMAT" } });
    await expect(addProductDocument(ctx, product.id, { kind: "NOPE" as never, file: pdfBytes() })).rejects.toMatchObject({ code: "INVALID" });
    await expect(addProductDocument(other, product.id, { kind: "OTHER", file: pdfBytes() })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Quota includes images + documents.
    await db.setting.create({ data: { tenantId: ctx.tenantId, group: "platform", data: { storageQuotaGb: 100_000 / 1024 ** 3 } } });
    await addProductImages(ctx, product.id, [{ type: "image/jpeg", ...(await jpegBytes("a.jpg")) }]);
    const big = { name: "big.pdf", bytes: new Uint8Array(Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(120_000, 32)])) };
    await expect(addProductDocument(ctx, product.id, { kind: "OTHER", file: big })).rejects.toMatchObject({ code: "CONFLICT", message: "Storage quota exceeded" });
    expect(await db.productDocument.count()).toBe(0);
    const files = await fs.readdir(path.join(root, ctx.tenantId, "products", product.id, "docs")).catch(() => []);
    expect(files).toEqual([]);
  });

  it("toggles public, deletes row + file, and is tenant-scoped", async () => {
    const ctx = await createTenantContext();
    const other = await createTenantContext();
    const product = await createProduct(ctx);
    const doc = await addProductDocument(ctx, product.id, { kind: "PROVENANCE", file: pdfBytes() });
    await expect(updateProductDocument(other, doc.id, { isPublic: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await updateProductDocument(ctx, doc.id, { isPublic: true, title: "Letter" })).isPublic).toBe(true);
    expect((await listPublicDocuments(ctx.tenantId, product.id)).map((d) => d.title)).toEqual(["Letter"]);

    await expect(deleteProductDocument(other, doc.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const key = (await db.productDocument.findUniqueOrThrow({ where: { id: doc.id } })).storageKey;
    await deleteProductDocument(ctx, doc.id);
    expect(await db.productDocument.count()).toBe(0);
    expect(await driver.exists(key)).toBe(false);
  });

  describe("access rules", () => {
    async function setup() {
      const ctx = await createTenantContext();
      const other = await createTenantContext();
      const product = await createProduct(ctx);
      const pub = await addProductDocument(ctx, product.id, { kind: "PROVENANCE", isPublic: true, file: pdfBytes() });
      const priv = await addProductDocument(ctx, product.id, { kind: "INVOICE_HISTORIC", isPublic: false, file: pdfBytes() });
      return { ctx, other, product, pub, priv };
    }

    it("staff of the tenant (and superadmin) see every document, on any host", async () => {
      const { ctx, other, pub, priv } = await setup();
      for (const id of [pub.id, priv.id]) {
        expect(await resolveDocumentAccess(id, { user: owner(ctx), hostTenantId: null })).toMatchObject({ via: "staff" });
        expect(await resolveDocumentAccess(id, { user: { id: "sa", role: "SUPERADMIN", tenantId: null }, hostTenantId: other.tenantId })).toMatchObject({ via: "staff" });
      }
      // The owner of another shop is no staff here: only what the public sees, and not on their own host.
      expect(await resolveDocumentAccess(priv.id, { user: owner(other), hostTenantId: ctx.tenantId })).toBeNull();
      expect(await resolveDocumentAccess(pub.id, { user: owner(other), hostTenantId: other.tenantId })).toBeNull();
      expect(await resolveDocumentAccess(pub.id, { user: owner(other), hostTenantId: ctx.tenantId })).toMatchObject({ via: "public" });
    });

    it("the public sees only public documents of visible products on that shop's host", async () => {
      const { ctx, other, product, pub, priv } = await setup();
      const guest = (hostTenantId: string | null) => ({ user: null, hostTenantId });
      expect(await resolveDocumentAccess(pub.id, guest(ctx.tenantId))).toMatchObject({ via: "public" });
      expect(await resolveDocumentAccess(priv.id, guest(ctx.tenantId))).toBeNull();
      expect(await resolveDocumentAccess(pub.id, guest(other.tenantId))).toBeNull();
      expect(await resolveDocumentAccess(pub.id, guest(null))).toBeNull();
      expect(await resolveDocumentAccess("nope", guest(ctx.tenantId))).toBeNull();

      for (const status of ["RESERVED", "SOLD"] as ProductStatus[]) {
        await db.product.update({ where: { id: product.id }, data: { status } });
        expect(await resolveDocumentAccess(pub.id, guest(ctx.tenantId))).not.toBeNull();
      }
      for (const status of ["DRAFT", "ARCHIVED", "STOLEN"] as ProductStatus[]) {
        await db.product.update({ where: { id: product.id }, data: { status } });
        expect(await resolveDocumentAccess(pub.id, guest(ctx.tenantId))).toBeNull();
        expect(await listPublicDocuments(ctx.tenantId, product.id)).toEqual([]);
      }
    });

    it("sensitive (blurred) products need a signed-in shop user", async () => {
      const { ctx, product, pub } = await setup();
      await db.product.update({ where: { id: product.id }, data: { blurred: true } });
      expect(await resolveDocumentAccess(pub.id, { user: null, hostTenantId: ctx.tenantId })).toBeNull();
      const customer = { id: "c1", role: "CUSTOMER" as const, tenantId: ctx.tenantId };
      expect(await resolveDocumentAccess(pub.id, { user: customer, hostTenantId: ctx.tenantId })).toMatchObject({ via: "public" });
    });

    it("GET /api/documents/[id] streams allowed documents and 404s the rest", async () => {
      const { ctx, pub, priv } = await setup();
      const { GET } = await import("@/app/api/documents/[id]/route");
      const get = (id: string) => GET(new Request(`http://shop.test/api/documents/${id}`), { params: Promise.resolve({ id }) } as RouteContext<"/api/documents/[id]">);

      host.tenant = { id: ctx.tenantId };
      const ok = await get(pub.id);
      expect(ok.status).toBe(200);
      expect(ok.headers.get("content-type")).toBe("application/pdf");
      expect(ok.headers.get("content-disposition")).toContain('filename="Letter 1944.pdf"');
      expect((await ok.text()).startsWith("%PDF-")).toBe(true);
      expect((await get(priv.id)).status).toBe(404);

      auth.user = { ...owner(ctx), role: "OWNER" };
      host.tenant = null;
      const staff = await get(priv.id);
      expect(staff.status).toBe(200);
      expect(staff.headers.get("cache-control")).toBe("private, no-store");
    });
  });
});

describe("certificates", () => {
  it("issues with a unique code + snapshot + photo copy, one valid at a time", async () => {
    const ctx = await createTenantContext();
    await db.tenantDomain.create({ data: { tenantId: ctx.tenantId, host: "shop.example", isPrimary: true } });
    const product = await createProduct(ctx, {
      specifications: [{ label: "Maker", value: "ET" }, { label: "", value: "dropped" }],
      provenance: "From the **Smith** collection.",
      authenticityGuaranteed: true,
    });
    await addProductImages(ctx, product.id, [{ type: "image/jpeg", ...(await jpegBytes("a.jpg")) }]);

    const cert = await issueCertificate(ctx, product.id);
    expect(cert.code).toMatch(CERTIFICATE_CODE_PATTERN);
    expect(cert.valid).toBe(true);
    expect(cert.verifyUrl).toBe(`https://shop.example/verify/${cert.code}`);
    expect(cert.pdfUrl).toBe(`/api/certificates/${cert.code}/pdf`);
    expect(cert.issuedByEmail).toBe(ctx.actor.email);
    expect(cert.snapshot).toMatchObject({
      title: product.title,
      stockCode: product.stockCode,
      specifications: [{ label: "Maker", value: "ET" }],
      provenanceExcerpt: "From the Smith collection.",
      shopName: expect.any(String),
      shopHost: "shop.example",
      authenticityGuaranteed: true,
      blurred: false,
    });
    expect(cert.snapshot.coverImageKey).toMatch(new RegExp(`^${ctx.tenantId}/products/${product.id}/`));
    expect(cert.snapshot.photoKey).toBe(`${ctx.tenantId}/certificates/${cert.id}/photo.jpg`);
    expect(await driver.exists(cert.snapshot.photoKey!)).toBe(true);
    expect(await db.auditLog.count({ where: { action: "product.certificate.issued" } })).toBe(1);

    await expect(issueCertificate(ctx, product.id)).rejects.toMatchObject({ code: "CONFLICT" });

    // The snapshot does not follow later edits.
    await db.product.update({ where: { id: product.id }, data: { title: "Changed" } });
    expect((await listCertificates(ctx, product.id))[0].snapshot.title).toBe(product.title);
  });

  it("refuses drafts / archived items and foreign products", async () => {
    const ctx = await createTenantContext();
    const other = await createTenantContext();
    const draft = await createProduct(ctx, { status: "DRAFT" });
    await expect(issueCertificate(ctx, draft.id)).rejects.toMatchObject({ code: "INVALID" });
    const active = await createProduct(ctx);
    await expect(issueCertificate(other, active.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listCertificates(other, active.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("retries on a code collision and gives up after repeated collisions", async () => {
    const ctx = await createTenantContext();
    const a = await createProduct(ctx);
    const b = await createProduct(ctx);
    const c = await createProduct(ctx);
    const codes = ["QM-AAAA-AAAA", "QM-AAAA-AAAA", "QM-BBBB-BBBB"];
    setCodeGeneratorForTests(() => codes.shift() ?? "QM-AAAA-AAAA");
    expect((await issueCertificate(ctx, a.id)).code).toBe("QM-AAAA-AAAA");
    expect((await issueCertificate(ctx, b.id)).code).toBe("QM-BBBB-BBBB"); // first try collided
    await expect(issueCertificate(ctx, c.id)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(await db.certificate.count({ where: { productId: c.id } })).toBe(0);
  });

  it("revokes (reason required, once) and verification reflects it, shop-scoped", async () => {
    const ctx = await createTenantContext();
    const other = await createTenantContext();
    const product = await createProduct(ctx, { blurred: true });
    const cert = await issueCertificate(ctx, product.id);

    const valid = await verifyCertificate(ctx.tenantId, cert.code.toLowerCase().replace(/-/g, " "));
    expect(valid).toMatchObject({ status: "valid", certificate: { code: cert.code, title: product.title, photoUrl: null, revokedAt: null } });
    expect(JSON.stringify(valid)).not.toContain(ctx.actor.email);
    expect(await verifyCertificate(other.tenantId, cert.code)).toEqual({ status: "unknown", code: cert.code });
    expect(await verifyCertificate(ctx.tenantId, "QM-0000-0000")).toEqual({ status: "unknown", code: "QM-0000-0000" });
    expect(await verifyCertificate(ctx.tenantId, "garbage")).toEqual({ status: "unknown", code: null });

    await expect(revokeCertificate(other, cert.id, "wrong shop")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(revokeCertificate(ctx, cert.id, "")).rejects.toMatchObject({ code: "INVALID" });
    const revoked = await revokeCertificate(ctx, cert.id, "Found to be a reproduction");
    expect(revoked).toMatchObject({ valid: false, reason: "Found to be a reproduction" });
    await expect(revokeCertificate(ctx, cert.id, "again")).rejects.toMatchObject({ code: "CONFLICT" });

    const after = await verifyCertificate(ctx.tenantId, cert.code);
    expect(after.status).toBe("revoked");
    expect(JSON.stringify(after)).not.toContain("reproduction");
    // A new certificate may be issued after revocation.
    expect((await issueCertificate(ctx, product.id)).valid).toBe(true);
  });

  it("rate-limits public lookups per IP", async () => {
    const ctx = await createTenantContext();
    for (let i = 0; i < VERIFY_RATE_LIMIT.limit; i++) {
      expect((await verifyCertificateForVisitor(ctx.tenantId, "QM-0000-0000", "10.0.0.1")).status).toBe("unknown");
    }
    expect((await verifyCertificateForVisitor(ctx.tenantId, "QM-0000-0000", "10.0.0.1")).status).toBe("rate_limited");
    expect((await verifyCertificateForVisitor(ctx.tenantId, "QM-0000-0000", "10.0.0.2")).status).toBe("unknown");
  });

  it("public provenance reports the certificate badge and public documents", async () => {
    const ctx = await createTenantContext();
    const product = await createProduct(ctx, { provenance: "History" });
    expect(await queryPublicProvenance(ctx.tenantId, product.id)).toMatchObject({ certificateIncluded: false, documents: [], provenance: "History" });
    const cert = await issueCertificate(ctx, product.id);
    await addProductDocument(ctx, product.id, { kind: "PROVENANCE", isPublic: true, file: pdfBytes() });
    await addProductDocument(ctx, product.id, { kind: "OTHER", isPublic: false, file: pdfBytes() });
    const data = await queryPublicProvenance(ctx.tenantId, product.id);
    expect(data?.certificateIncluded).toBe(true);
    expect(data?.documents).toHaveLength(1);
    await revokeCertificate(ctx, cert.id, "test revoke");
    expect((await queryPublicProvenance(ctx.tenantId, product.id))?.certificateIncluded).toBe(false);
    await db.product.update({ where: { id: product.id }, data: { status: "DRAFT" } });
    expect(await queryPublicProvenance(ctx.tenantId, product.id)).toBeNull();
  });

  it("GET /api/certificates/[code]/pdf renders a PDF for staff only (and caches it while valid)", async () => {
    const ctx = await createTenantContext();
    const other = await createTenantContext();
    await db.tenantDomain.create({ data: { tenantId: ctx.tenantId, host: "shop.example", isPrimary: true } });
    const product = await createProduct(ctx, { specifications: [{ label: "Maker", value: "ET – Eisenhüttenwerke" }], provenance: "Ex **Smith** collection.", authenticityGuaranteed: true });
    await addProductImages(ctx, product.id, [{ type: "image/jpeg", ...(await jpegBytes("a.jpg")) }]);
    const cert = await issueCertificate(ctx, product.id);
    const { GET } = await import("@/app/api/certificates/[code]/pdf/route");
    const get = (code: string) => GET(new Request(`http://localhost/api/certificates/${code}/pdf`), { params: Promise.resolve({ code }) } as RouteContext<"/api/certificates/[code]/pdf">);

    expect((await get(cert.code)).status).toBe(401);
    auth.user = { ...owner(other), role: "OWNER" };
    expect((await get(cert.code)).status).toBe(404);
    expect(await findCertificateForStaff(cert.code, { role: "CUSTOMER", tenantId: ctx.tenantId })).toBeNull();

    auth.user = { ...owner(ctx), role: "OWNER" };
    const res = await get(cert.code);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(body.byteLength).toBeGreaterThan(2000);
    const row = await db.certificate.findUniqueOrThrow({ where: { id: cert.id } });
    expect(row.storageKey).toBe(`${ctx.tenantId}/certificates/${cert.id}/certificate.pdf`);
    expect(await driver.exists(row.storageKey!)).toBe(true);

    await revokeCertificate(ctx, cert.id, "test revoke");
    expect(await driver.exists(row.storageKey!)).toBe(false);
    const revoked = await get(cert.code);
    expect(revoked.status).toBe(200);
    expect((await db.certificate.findUniqueOrThrow({ where: { id: cert.id } })).storageKey).toBeNull();
  }, 60_000);
});

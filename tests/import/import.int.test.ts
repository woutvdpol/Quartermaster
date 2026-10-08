import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { ServiceContext } from "@/server/context";
import { LocalDriver, setStorageForTests } from "@/server/media/storage";
import { runJobNow, setJobTransportForTests, type EnqueuedJob } from "@/server/jobs/queue";
import { seedDefaultFacets } from "@/server/facets";
import { listProducts } from "@/server/catalog/products";
import { safeFetch } from "@/server/security/safe-fetch";
import {
  cancelImport,
  createImportJob,
  deleteImportedDrafts,
  discardImport,
  getImportJob,
  listImportJobs,
  retryImport,
  runImportProducts,
  setImportImageFetcherForTests,
  startImport,
} from "@/server/import";
import { createTenantContext, resetDb } from "../integration/helpers";

// Photos come from a local HTTP server; URLs in the fixtures use the reserved `.invalid` TLD and are
// mapped onto it by the injected fetcher (which still runs the real SSRF-safe fetch code path).
let root: string;
let server: http.Server;
let port: number;
let photo: Buffer;
let jobs: EnqueuedJob[] = [];

const fixture = (name: string) => fs.readFile(path.join(__dirname, "fixtures", name));

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "qm-import-int-"));
  setStorageForTests(new LocalDriver(root));
  photo = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 90, g: 90, b: 60 } } }).jpeg().toBuffer();
  server = http.createServer((req, res) => {
    if ((req.url ?? "").includes("m35-side")) {
      res.writeHead(404);
      return res.end();
    }
    if ((req.url ?? "").includes("km-buckle-back")) {
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      return res.end("not really a jpeg");
    }
    res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": photo.length });
    res.end(photo);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  setStorageForTests(null);
  setImportImageFetcherForTests(null);
  setJobTransportForTests(null);
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await fs.rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetDb();
  jobs = [];
  setJobTransportForTests((job) => void jobs.push(job));
  setImportImageFetcherForTests((url, signal) =>
    safeFetch(`http://photos.test:${port}${new URL(url).pathname}`, {
      signal,
      ports: null,
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
      isAllowedAddress: (ip) => ip === "127.0.0.1",
    }),
  );
});

async function upload(ctx: ServiceContext, source: "WOOCOMMERCE" | "SHOPIFY", file: string) {
  return createImportJob(ctx, { source, fileName: file, bytes: new Uint8Array(await fixture(file)) });
}

/** Runs the queued import jobs like the worker would (continuations included). */
async function drain() {
  for (let guard = 0; jobs.length && guard < 200; guard++) {
    const job = jobs.shift()!;
    if (job.name.startsWith("import.")) await runJobNow(job.name, job.data);
  }
}

const importedProducts = (tenantId: string, jobId: string) =>
  db.product.findMany({
    where: { tenantId, legacyData: { path: ["importJobId"], equals: jobId } },
    include: { category: { include: { parent: true } }, tags: { include: { tag: true } }, productFacetValues: { include: { facetValue: true } }, images: true },
    orderBy: { stockCode: "asc" },
  });

describe("product import (WooCommerce)", () => {
  it("upload → preview → run → photos → idempotent re-run → undo", async () => {
    const ctx = await createTenantContext();
    await seedDefaultFacets(ctx.tenantId);
    await db.category.create({ data: { tenantId: ctx.tenantId, title: "Helmets", slug: "helmets" } });

    // Upload + preview
    const job = await upload(ctx, "WOOCOMMERCE", "woocommerce-products.csv");
    expect(job.status).toBe("UPLOADED");
    const pv = job.preview!;
    expect(pv).toMatchObject({ rows: 10, products: 7, itemsIfSplit: 9, itemsIfSingle: 7, multiStock: 1, images: 9, skippedCount: 3 });
    expect(pv.categories.existing).toBe(1); // "Helmets"
    expect(pv.categories.new).toBe(pv.categories.total - 1);
    expect(pv.tags.facetMatched.map((t) => t.tag)).toEqual(expect.arrayContaining(["WW2", "Germany", "Heer", "Kriegsmarine", "Soviet Union", "Netherlands", "Interbellum"]));
    expect(pv.tags.unmatchedSample).toEqual(expect.arrayContaining(["Great Britain", "United States", "Reproduction"]));
    expect(pv.columns.find((c) => c.column === "Name")).toMatchObject({ becomes: "Title", example: "M35 Stahlhelm, single decal (Heer)" });
    expect(pv.sample[0]).toMatchObject({ title: "M35 Stahlhelm, single decal (Heer)", price: 125000 });
    const key = (await db.importJob.findUniqueOrThrow({ where: { id: job.id } })).fileKey;
    expect(key).toBe(`${ctx.tenantId}/imports/${job.id}.csv`);
    await expect(fs.stat(path.join(root, key))).resolves.toBeTruthy();

    // Start
    const started = await startImport(ctx, job.id, { publish: true, tagsAs: "facets", stockMode: "split", images: true });
    expect(started.status).toBe("RUNNING");
    expect(jobs).toEqual([expect.objectContaining({ name: "import.run", options: expect.objectContaining({ singletonKey: job.id, inTransaction: true }) })]);
    await expect(startImport(ctx, job.id, {})).rejects.toMatchObject({ code: "CONFLICT" });

    await drain();
    const done = await getImportJob(ctx, job.id);
    expect(done.status).toBe("DONE");
    expect(done.progress).toMatchObject({ phase: "done", created: 9, failed: 0, published: 6, imagesTotal: 11, imagesDone: 9 });

    const products = await importedProducts(ctx.tenantId, job.id);
    expect(products).toHaveLength(9);
    expect(products.every((p) => p.quantity === (p.title.startsWith("US M1") ? 0 : 1))).toBe(true);
    const m35 = products.find((p) => p.title.startsWith("M35"))!;
    expect(m35).toMatchObject({ status: "ACTIVE", price: 125000, sku: "DM-H-0101", weightGrams: 1100, onSale: false });
    expect(m35.description).toContain("- Liner size 57, shell size 64");
    expect(m35.description).not.toMatch(/<[a-z]/i);
    expect(m35.category?.title).toBe("German");
    expect(m35.category?.parent?.title).toBe("Helmets");
    expect(m35.productFacetValues.map((f) => f.facetValue.name).sort()).toEqual(["Germany", "Heer", "WW2"]);
    expect(m35.legacyData).toMatchObject({ importJobId: job.id, sourceId: "id:101", sourceKey: "id:101#1", imagesState: "done" });
    expect(m35.images).toHaveLength(1); // m35-side.jpg → 404

    const p37 = products.filter((p) => p.title === "British P37 webbing set");
    expect(p37.map((p) => p.sku)).toEqual(["DM-E-0102", "DM-E-0102-2", "DM-E-0102-3"]);
    expect(p37.every((p) => p.price === 14950 && p.onSale && p.images.length === 1)).toBe(true);
    expect(p37[0].tags.map((t) => t.tag.name)).toEqual(["Great Britain"]);

    const ssh = products.find((p) => p.title.startsWith("Soviet"))!;
    expect(ssh.status).toBe("DRAFT"); // unpublished in WooCommerce
    expect(ssh.tags.map((t) => t.tag.name)).toEqual(["Pristine, unissued"]);
    expect(products.find((p) => p.title.startsWith("Reproduction"))).toMatchObject({ status: "DRAFT", price: 4500 });

    expect(done.imageFailures.map((f) => f.reason).join("\n")).toMatch(/m35-side\.jpg: HTTP 404/);
    expect(done.imageFailures.map((f) => f.reason).join("\n")).toMatch(/km-buckle-back\.jpg: .*(not a supported image|Unsupported)/i);

    // Re-running the job does not duplicate anything.
    await db.importJob.update({ where: { id: job.id }, data: { status: "RUNNING" } });
    await runImportProducts(ctx.tenantId, job.id);
    expect(await importedProducts(ctx.tenantId, job.id)).toHaveLength(9);
    const rerun = await getImportJob(ctx, job.id);
    expect(rerun.progress).toMatchObject({ created: 9, existing: 9 });
    expect(rerun.status).toBe("DONE"); // no pending photos left

    // The inventory list can filter by import job.
    const listed = await listProducts(ctx, { view: "all", importJobId: job.id, pageSize: 50 });
    expect(listed.total).toBe(9);

    // Undo: only drafts are deleted.
    const undo = await deleteImportedDrafts(ctx, job.id);
    expect(undo).toEqual({ deleted: 3, kept: 6 });
    const audits = await db.auditLog.findMany({ where: { tenantId: ctx.tenantId, action: { startsWith: "import." } }, select: { action: true } });
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["import.upload", "import.start", "import.products_done", "import.done", "import.undo"]));
  });

  it("time-boxed slices continue where they stopped", async () => {
    const ctx = await createTenantContext();
    const job = await upload(ctx, "SHOPIFY", "shopify-products.csv");
    await startImport(ctx, job.id, { stockMode: "single", images: false });
    jobs = [];
    let cursor = 0;
    let slices = 0;
    for (;;) {
      const res = await runImportProducts(ctx.tenantId, job.id, { cursor, budgetMs: 0 });
      slices++;
      if (res.done) break;
      expect(res.cursor).toBe(cursor + 1);
      cursor = res.cursor;
    }
    expect(slices).toBe(4);
    const view = await getImportJob(ctx, job.id);
    expect(view.status).toBe("DONE");
    const products = await importedProducts(ctx.tenantId, job.id);
    expect(products.map((p) => p.title)).toEqual([
      "French M15 Adrian helmet, infantry",
      "US M1943 field jacket",
      "Reenactor ankle boots (reproduction)",
      "French kepi, 1914 pattern",
    ]);
    expect(products.every((p) => p.status === "DRAFT")).toBe(true);
    expect(products[1]).toMatchObject({ price: 26000, onSale: true, purchasePrice: 12000 });
    expect(products[3].category?.title).toBe("Hats");
  });

  it("cancel stops the import; retry only after a failure; discard only before start", async () => {
    const ctx = await createTenantContext();
    const job = await upload(ctx, "SHOPIFY", "shopify-products.csv");
    await startImport(ctx, job.id, {});
    await cancelImport(ctx, job.id);
    await drain();
    expect(await importedProducts(ctx.tenantId, job.id)).toHaveLength(0);
    expect((await getImportJob(ctx, job.id)).status).toBe("CANCELED");
    await expect(retryImport(ctx, job.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(discardImport(ctx, job.id)).rejects.toMatchObject({ code: "CONFLICT" });

    const other = await upload(ctx, "WOOCOMMERCE", "woocommerce-products.csv");
    await discardImport(ctx, other.id);
    expect(await db.importJob.count({ where: { id: other.id } })).toBe(0);
    await expect(fs.stat(path.join(root, `${ctx.tenantId}/imports/${other.id}.csv`))).rejects.toThrow();
  });

  it("refuses wrong, empty and oversized files", async () => {
    const ctx = await createTenantContext();
    await expect(upload(ctx, "WOOCOMMERCE", "shopify-products.csv")).rejects.toThrow(/Shopify export/);
    await expect(createImportJob(ctx, { source: "SHOPIFY", fileName: "x.csv", bytes: new Uint8Array() })).rejects.toThrow(/empty/);
    await expect(createImportJob(ctx, { source: "SHOPIFY", fileName: "x.csv", bytes: new Uint8Array(21 * 1024 * 1024).fill(65) })).rejects.toThrow(/20 MB/);
    await expect(createImportJob(ctx, { source: "SHOPIFY", fileName: "x.png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]) })).rejects.toThrow(/not a CSV/);
    expect(await db.importJob.count()).toBe(0);
  });

  it("isolates tenants", async () => {
    const a = await createTenantContext();
    const b = await createTenantContext();
    const job = await upload(a, "WOOCOMMERCE", "woocommerce-products.csv");
    for (const call of [
      () => getImportJob(b, job.id),
      () => startImport(b, job.id, {}),
      () => cancelImport(b, job.id),
      () => discardImport(b, job.id),
      () => deleteImportedDrafts(b, job.id),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(await listImportJobs(b)).toEqual([]);
    await startImport(a, job.id, { images: false });
    // A worker payload with the wrong tenant does nothing.
    await runImportProducts(b.tenantId, job.id);
    expect(await db.product.count({ where: { tenantId: b.tenantId } })).toBe(0);
    await drain();
    expect(await db.product.count({ where: { tenantId: a.tenantId } })).toBe(9);
    expect((await listProducts(b, { view: "all", importJobId: job.id })).total).toBe(0);
  });

  it("the default fetcher refuses loopback photo URLs (SSRF) and records why", async () => {
    setImportImageFetcherForTests(null);
    const ctx = await createTenantContext();
    const csv = `ID,Type,SKU,Name,Published,Regular price,Images\n1,simple,X1,Test helmet,1,10,http://127.0.0.1:${port}/a.jpg\n2,simple,X2,Test cap,1,10,http://169.254.169.254/latest/meta-data/x.jpg\n`;
    const job = await createImportJob(ctx, { source: "WOOCOMMERCE", fileName: "ssrf.csv", bytes: new TextEncoder().encode(csv) });
    await startImport(ctx, job.id, {});
    await drain();
    const view = await getImportJob(ctx, job.id);
    expect(view.status).toBe("DONE");
    expect(view.imageFailures).toHaveLength(2);
    // Port 80/443 only by default; 169.254.169.254 is refused by address.
    expect(view.imageFailures[0].reason).toMatch(/Port|non-public/);
    expect(view.imageFailures[1].reason).toMatch(/non-public address/);
    expect(await db.productImage.count()).toBe(0);
  });
});


import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { LocalDriver, setStorageForTests } from "@/server/media/storage";
import { setJobTransportForTests } from "@/server/jobs/queue";
import { setEmbedderForTests } from "@/server/search/embedder";
import { createFakeEmbedder } from "@/server/search/fake-embedder";
import { indexProducts } from "@/server/search/indexing";
import type { ServiceContext } from "@/server/context";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { checkDuplicates } from "./service";
import { copyProvenanceFromPrevious, getLineage, setPreviousProduct } from "./lineage";

/*
 * Duplicate check against a real Postgres (pgvector) with the deterministic fake embedder (photo
 * vector = average colour, like CI's `npm run search -- reindex --all --fake`): same colour ≈ same
 * photo. Tenant isolation, exclude self, drafts + sold included, embedder down / slow, lineage.
 */

type Rgb = { r: number; g: number; b: number };
const RED: Rgb = { r: 200, g: 20, b: 20 };
const NEAR_RED: Rgb = { r: 200, g: 30, b: 20 };
const BLUE: Rgb = { r: 20, g: 20, b: 200 };

let uploads: string;
let code = 70000;
const fake = createFakeEmbedder();

const png = (c: Rgb) => sharp({ create: { width: 64, height: 64, channels: 3, background: c } }).png().toBuffer();

async function addImage(tenantId: string, productId: string, c: Rgb, sortOrder = 0) {
  code += 1;
  const key = `${tenantId}/products/${productId}/img-${code}.png`;
  await new LocalDriver(uploads).put(key, await png(c), "image/png");
  return db.productImage.create({ data: { tenantId, productId, storageKey: key, sortOrder } });
}

async function product(tenantId: string, o: { title: string; status?: "ACTIVE" | "DRAFT" | "SOLD"; color?: Rgb; provenance?: string }) {
  code += 1;
  const p = await db.product.create({
    data: {
      tenantId,
      stockCode: code,
      slug: `item-${code}`,
      title: o.title,
      status: o.status ?? "ACTIVE",
      price: 10000,
      quantity: o.status === "SOLD" ? 0 : 1,
      soldAt: o.status === "SOLD" ? new Date(Date.UTC(2026, 6, 14)) : null,
      provenance: o.provenance ?? null,
    },
  });
  if (o.color) await addImage(tenantId, p.id, o.color);
  return p;
}

describe("duplicate photo check (integration)", () => {
  let ctx: ServiceContext;
  let other: ServiceContext;

  beforeAll(() => {
    uploads = mkdtempSync(path.join(tmpdir(), "qm-dup-"));
    setStorageForTests(new LocalDriver(uploads));
    // audit() → search hooks enqueue index jobs; swallow them.
    setJobTransportForTests(() => {});
  });
  afterAll(() => {
    setStorageForTests(null);
    setEmbedderForTests(undefined);
    setJobTransportForTests(null);
    rmSync(uploads, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetDb();
    setEmbedderForTests(fake);
    ctx = await createTenantContext();
    other = await createTenantContext();
  });

  async function scenario() {
    const sold = await product(ctx.tenantId, { title: "Bayonet 84/98 with frog", status: "SOLD", color: RED, provenance: "From the Van Dijk collection." });
    const draft = await product(ctx.tenantId, { title: "Bayonet 84/98, no frog", status: "DRAFT", color: NEAR_RED });
    const blue = await product(ctx.tenantId, { title: "Blue helmet", color: BLUE });
    const foreign = await product(other.tenantId, { title: "Other shop's bayonet", color: RED });
    // The product being edited: already indexed with the same photo (must not match itself).
    const current = await product(ctx.tenantId, { title: "New bayonet", status: "DRAFT", color: RED });
    await indexProducts(ctx.tenantId, [sold.id, draft.id, blue.id, current.id], { embedder: fake });
    await indexProducts(other.tenantId, [foreign.id], { embedder: fake });
    const uploaded = await addImage(ctx.tenantId, current.id, RED, 1);
    return { sold, draft, blue, foreign, current, uploaded };
  }

  it("finds sold and draft look-alikes of the same tenant, never itself or another shop", async () => {
    const s = await scenario();
    const r = await checkDuplicates(ctx, { productId: s.current.id, imageIds: [s.uploaded.id] });
    expect(r.state).toBe("ok");
    expect(r.candidates.map((c) => c.productId)).toEqual([s.sold.id, s.draft.id]);
    const [sold, draft] = r.candidates;
    expect(sold).toMatchObject({ stockCode: s.sold.stockCode, title: "Bayonet 84/98 with frog", status: "SOLD", band: "very_close", isPrevious: false });
    expect(sold.soldAt?.toISOString()).toBe("2026-07-14T00:00:00.000Z");
    expect(sold.thumbUrl).toMatch(/^\/uploads\/.+\/thumb\.webp$/);
    expect(draft.status).toBe("DRAFT");
  });

  it("accepts raw image bytes (no product yet)", async () => {
    const s = await scenario();
    const r = await checkDuplicates(ctx, { imageBuffers: [new Uint8Array(await png(BLUE))] });
    expect(r.candidates.map((c) => c.productId)).toEqual([s.blue.id]);
  });

  it("ignores image ids of another tenant", async () => {
    const s = await scenario();
    const foreignImage = await db.productImage.findFirstOrThrow({ where: { productId: s.foreign.id } });
    const r = await checkDuplicates(ctx, { imageIds: [foreignImage.id] });
    expect(r).toEqual({ state: "no_images", candidates: [] });
    await expect(checkDuplicates(ctx, { productId: s.foreign.id, imageIds: [foreignImage.id] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns no candidates quietly when the embedder is missing, cold, failing or slow", async () => {
    const s = await scenario();
    const input = { productId: s.current.id, imageIds: [s.uploaded.id] };
    expect(await checkDuplicates(ctx, { ...input, embedder: null })).toEqual({ state: "unavailable", candidates: [] });
    expect(await checkDuplicates(ctx, { ...input, embedder: createFakeEmbedder({ cold: ["image"] }) })).toEqual({ state: "unavailable", candidates: [] });
    const failing = { ...fake, embedImage: async () => Promise.reject(new Error("connection refused")) };
    expect(await checkDuplicates(ctx, { ...input, embedder: failing })).toEqual({ state: "unavailable", candidates: [] });
    const slow = { ...fake, embedImage: (img: Parameters<typeof fake.embedImage>[0]) => new Promise<number[]>((res) => setTimeout(() => res(fake.embedImage(img)), 1000)) };
    const started = Date.now();
    expect(await checkDuplicates(ctx, { ...input, embedder: slow, timeoutMs: 150 })).toEqual({ state: "timeout", candidates: [] });
    expect(Date.now() - started).toBeLessThan(900);
  });

  it("links the earlier listing (audited), flags it, and copies provenance on request", async () => {
    const s = await scenario();
    const lineage = await setPreviousProduct(ctx, s.current.id, s.sold.id);
    expect(lineage.previous).toMatchObject({ id: s.sold.id, stockCode: s.sold.stockCode, status: "SOLD", hasProvenance: true });
    expect((await getLineage(ctx, s.sold.id)).later.map((l) => l.id)).toEqual([s.current.id]);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "product.lineage", entityId: s.current.id } });
    expect(log.data).toMatchObject({ previousProductId: s.sold.id, previousStockCode: s.sold.stockCode });

    const r = await checkDuplicates(ctx, { productId: s.current.id, imageIds: [s.uploaded.id] });
    expect(r.candidates.find((c) => c.productId === s.sold.id)?.isPrevious).toBe(true);

    expect(await copyProvenanceFromPrevious(ctx, s.current.id)).toEqual({ copied: true });
    expect((await db.product.findUniqueOrThrow({ where: { id: s.current.id } })).provenance).toBe("From the Van Dijk collection.");
    expect(await copyProvenanceFromPrevious(ctx, s.current.id)).toEqual({ copied: false }); // already there

    await setPreviousProduct(ctx, s.current.id, null);
    expect((await getLineage(ctx, s.current.id)).previous).toBeNull();
  });

  it("rejects self links, cycles and products of another tenant", async () => {
    const s = await scenario();
    await expect(setPreviousProduct(ctx, s.current.id, s.current.id)).rejects.toMatchObject({ code: "INVALID" });
    await setPreviousProduct(ctx, s.current.id, s.sold.id);
    await expect(setPreviousProduct(ctx, s.sold.id, s.current.id)).rejects.toMatchObject({ code: "INVALID" });
    await expect(setPreviousProduct(ctx, s.current.id, s.foreign.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setPreviousProduct(other, s.current.id, s.sold.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

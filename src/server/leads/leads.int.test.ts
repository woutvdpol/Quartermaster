import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { LocalDriver, setStorageForTests, type StorageDriver } from "@/server/media/storage";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { installHarness, setSettings } from "../../../tests/integration/mail-harness";
import { createLeadDraft, deleteDraftPhoto, getLead, listLeads, saveLeadNote, setLeadStatus, submitLead, uploadLeadPhoto } from "./index";
import { cleanupOrphanLeadPhotos } from "./cleanup";
import { newLeadId } from "./draft";

let root: string;
let h: ReturnType<typeof installHarness>;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "qm-leads-int-"));
  setStorageForTests(new LocalDriver(root));
});
afterAll(async () => {
  setStorageForTests(null);
  await fs.rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
  await resetDb();
  h = installHarness();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  h.uninstall();
  vi.restoreAllMocks();
});

async function jpeg(): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width: 640, height: 480, channels: 3, background: "#884422" } }).jpeg().withMetadata().toBuffer());
}

const form = (photos: string[] = []) => ({
  name: "Jan",
  email: "jan@example.test",
  phone: "",
  itemsDescription: "A Dutch M34 helmet with liner.",
  message: "",
  consent: true,
  photos,
});

describe("lead service", () => {
  it("uploads re-encoded photos, submits, queues both mails and lists tenant-scoped", async () => {
    const ctx = await createTenantContext();
    const other = await createTenantContext();
    await setSettings(ctx.tenantId, "general", { contactEmail: "owner@shop.test" });
    const draft = createLeadDraft(ctx.tenantId);

    const up = await uploadLeadPhoto({ tenantId: ctx.tenantId, draftToken: draft, bytes: await jpeg(), ip: "1.1.1.1" });
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    const svg = await uploadLeadPhoto({ tenantId: ctx.tenantId, draftToken: draft, bytes: new TextEncoder().encode("<svg/>"), ip: "1.1.1.1" });
    expect(svg).toMatchObject({ ok: false, error: "invalid" });
    expect(await uploadLeadPhoto({ tenantId: other.tenantId, draftToken: draft, bytes: await jpeg(), ip: null })).toMatchObject({ error: "expired" });

    const res = await submitLead({ tenantId: ctx.tenantId, draftToken: draft, data: form([up.photo.file]), ip: "1.1.1.1", turnstileToken: null });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(h.jobs.map((j) => (j.data as { template: string }).template)).toEqual(["lead-received", "lead-received-confirmation"]);

    // Stored file is a re-encoded JPEG under the tenant's lead folder; a thumbnail exists.
    const lead = await db.lead.findUniqueOrThrow({ where: { id: res.leadId } });
    const [photo] = lead.photos as { key: string }[];
    expect(photo.key.startsWith(`${ctx.tenantId}/leads/${res.leadId}/`)).toBe(true);
    const meta = await sharp(path.join(root, photo.key)).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
    await fs.access(path.join(root, photo.key.replace(/\.jpg$/, "_t.webp")));

    // Re-submitting the same draft is refused; no uploads after submit.
    expect(await submitLead({ tenantId: ctx.tenantId, draftToken: draft, data: form(), ip: "1.1.1.2", turnstileToken: null })).toMatchObject({ ok: false });
    expect(await uploadLeadPhoto({ tenantId: ctx.tenantId, draftToken: draft, bytes: await jpeg(), ip: null })).toMatchObject({ error: "expired" });

    await h.drain();
    const [owner, seller] = h.mails;
    expect(owner).toMatchObject({ to: "owner@shop.test", replyTo: "jan@example.test" });
    expect(String(owner.html)).toContain("_t.webp");
    expect(seller).toMatchObject({ to: "jan@example.test" });

    expect((await listLeads(ctx)).counts).toMatchObject({ ALL: 1, NEW: 1 });
    expect((await listLeads(other)).total).toBe(0);
    expect(await getLead(other, res.leadId)).toBeNull();

    await setLeadStatus(ctx, res.leadId, "CONTACTED");
    await saveLeadNote(ctx, res.leadId, "Called, coming Friday");
    const detail = await getLead(ctx, res.leadId);
    expect(detail).toMatchObject({ status: "CONTACTED", note: "Called, coming Friday", handledBy: { id: ctx.actor.id } });
    expect(detail?.photos[0].thumbUrl).toMatch(/^\/uploads\/.+_t\.webp$/);
    await expect(setLeadStatus(other, res.leadId, "BOUGHT")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setLeadStatus(ctx, res.leadId, "NOPE")).rejects.toMatchObject({ code: "INVALID" });
    const actions = (await db.auditLog.findMany({ where: { entityId: res.leadId }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["lead.created", "lead.status_changed", "lead.note_updated"]);
  });

  it("rejects photos that this draft did not upload and supports removing draft photos", async () => {
    const ctx = await createTenantContext();
    const draftA = createLeadDraft(ctx.tenantId);
    const draftB = createLeadDraft(ctx.tenantId);
    const up = await uploadLeadPhoto({ tenantId: ctx.tenantId, draftToken: draftA, bytes: await jpeg(), ip: null });
    if (!up.ok) throw new Error("upload failed");
    expect(await submitLead({ tenantId: ctx.tenantId, draftToken: draftB, data: form([up.photo.file]), ip: null, turnstileToken: null })).toMatchObject({
      ok: false,
      error: "photos",
    });
    expect(await deleteDraftPhoto({ tenantId: ctx.tenantId, draftToken: draftA, file: up.photo.file })).toBe(true);
    expect(await submitLead({ tenantId: ctx.tenantId, draftToken: draftA, data: form([up.photo.file]), ip: null, turnstileToken: null })).toMatchObject({
      ok: false,
      error: "photos",
    });
  });

  it("validates and rate-limits submissions per email", async () => {
    const ctx = await createTenantContext();
    expect(await submitLead({ tenantId: ctx.tenantId, draftToken: createLeadDraft(ctx.tenantId), data: { ...form(), consent: false }, ip: null, turnstileToken: null })).toMatchObject({
      ok: false,
      error: "invalid",
      fieldErrors: { consent: expect.any(String) },
    });
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push((await submitLead({ tenantId: ctx.tenantId, draftToken: createLeadDraft(ctx.tenantId), data: form(), ip: `10.0.0.${i}`, turnstileToken: null })).ok);
    }
    expect(results).toEqual([true, true, true, false]);
  });
});

describe("orphaned lead photo cleanup", () => {
  it("removes old folders without a lead and keeps recent ones and real leads", async () => {
    const ctx = await createTenantContext();
    const orphanOld = newLeadId();
    const orphanNew = newLeadId();
    const lead = await db.lead.create({ data: { id: newLeadId(), tenantId: ctx.tenantId, name: "Jan", email: "jan@example.test", itemsDescription: "Helmet" } });
    const folder = (id: string) => path.join(root, ctx.tenantId, "leads", id);
    for (const id of [orphanOld, orphanNew, lead.id]) {
      await fs.mkdir(folder(id), { recursive: true });
      await fs.writeFile(path.join(folder(id), "p1_10x10.jpg"), "x");
    }
    const old = new Date(Date.now() - 26 * 60 * 60 * 1000);
    for (const id of [orphanOld, lead.id]) await fs.utimes(folder(id), old, old);

    expect(await cleanupOrphanLeadPhotos()).toMatchObject({ removed: 1 });
    await expect(fs.stat(folder(orphanOld))).rejects.toThrow();
    await expect(fs.stat(folder(orphanNew))).resolves.toBeTruthy();
    await expect(fs.stat(folder(lead.id))).resolves.toBeTruthy();
  });

  it("skips drivers that cannot list", async () => {
    const noList: StorageDriver = {
      put: async () => {},
      head: async () => null,
      get: async () => null,
      exists: async () => false,
      delete: async () => {},
      deletePrefix: async () => {},
    };
    expect(await cleanupOrphanLeadPhotos({ storage: noList })).toEqual({ scanned: 0, removed: 0, skipped: "unsupported-driver" });
  });
});

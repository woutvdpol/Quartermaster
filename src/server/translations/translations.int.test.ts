import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { ServiceContext } from "@/server/context";
import { runJobNow, setJobTransportForTests, type EnqueuedJob } from "@/server/jobs/queue";
import { updateSettings } from "@/server/settings";
import { createProduct, updateProduct } from "@/server/catalog/products";
import { createCategory } from "@/server/catalog/categories";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { approveMany, approveTranslation, getEntityTranslations, listTranslations, saveGlossaryTerm, suggestTranslation } from "./service";
import { setTranslatorForTests, TranslatorUnavailableError, type Translator } from "./translator";

/** Fake embedder /translate: "[nl] <sentence>", placeholders kept. `log` collects the Dutch input. */
function fakeTranslator(log: string[][] = []): Translator {
  return {
    async translate(locale, texts) {
      if (locale === "nl") log.push(texts);
      return texts.map((t) => `[${locale}] ${t}`);
    },
  };
}

/** Runs the queued jobs of the given name (and anything they enqueue) in-process. */
async function drain(jobs: EnqueuedJob[]) {
  for (let i = 0; i < 20 && jobs.length; i++) {
    const job = jobs.shift()!;
    await runJobNow(job.name, job.data);
  }
}

describe("translations: queue → job → MACHINE → approve", () => {
  let a: ServiceContext;
  let b: ServiceContext;
  let jobs: EnqueuedJob[];

  beforeEach(async () => {
    await resetDb();
    a = await createTenantContext();
    b = await createTenantContext();
    jobs = [];
    setJobTransportForTests((j) => {
      if (j.name.startsWith("translations.")) jobs.push(j);
    });
    await updateSettings(a.tenantId, "i18n", { locales: ["nl", "de"] }, a.actor);
  });

  afterEach(() => {
    setJobTransportForTests(null);
    setTranslatorForTests(undefined);
  });

  it("queues new texts per enabled language, translates them, and only approve publishes", async () => {
    const log: string[][] = [];
    setTranslatorForTests(fakeTranslator(log));
    await saveGlossaryTerm(a, { locale: "nl", source: "liner", target: "voering" });
    const p = await createProduct(a, { title: "Stahlhelm M40", description: "Maker ET64. Leather liner complete.", price: 10000 });

    // product.create → audit hook → translations.sync (debounced job)
    expect(jobs.map((j) => j.name)).toEqual(["translations.sync"]);
    await drain(jobs); // sync → QUEUED rows → translations.translate → MACHINE
    const rows = await db.translation.findMany({ where: { tenantId: a.tenantId, entityId: p.id }, orderBy: [{ field: "asc" }, { locale: "asc" }] });
    expect(rows.map((r) => `${r.field}/${r.locale}/${r.status}`)).toEqual(["description/de/MACHINE", "description/nl/MACHINE", "title/de/MACHINE", "title/nl/MACHINE"]);
    const nlDesc = rows.find((r) => r.field === "description" && r.locale === "nl")!;
    expect(nlDesc.value).toBe("[nl] Maker ET64. [nl] Leather voering complete.");
    // Sentences were sent with placeholders, never the raw code or the glossary term.
    expect(log.flat().join(" ")).not.toMatch(/ET64|liner|M40/);

    // Nothing is approved yet: the shop's read contract sees no rows.
    expect(await db.translation.count({ where: { tenantId: a.tenantId, status: "APPROVED" } })).toBe(0);
    const queue = await listTranslations(a, { view: "review" });
    expect(queue.counts.review).toBe(4);
    expect(queue.rows[0]).toMatchObject({ label: expect.stringContaining("Stahlhelm M40"), source: expect.any(String) });

    await approveTranslation(a, { entity: "PRODUCT", entityId: p.id, field: "title", locale: "nl", value: "Stahlhelm M40 (Heer)" });
    const approved = await db.translation.findUniqueOrThrow({ where: { tenantId_entity_entityId_field_locale: { tenantId: a.tenantId, entity: "PRODUCT", entityId: p.id, field: "title", locale: "nl" } } });
    expect(approved).toMatchObject({ status: "APPROVED", value: "Stahlhelm M40 (Heer)", approvedBy: a.actor.id, stale: false });
    expect(await db.auditLog.count({ where: { tenantId: a.tenantId, action: "translation.approve" } })).toBe(1);

    // Bulk approve the remaining proposals as they are.
    const rest = (await listTranslations(a, { view: "review" })).rows.map((r) => r.id);
    expect(await approveMany(a, rest)).toEqual({ approved: 3, skipped: 0 });
    expect((await listTranslations(a, { view: "review" })).counts.review).toBe(0);

    // Tenant isolation: the other shop sees nothing and cannot approve a's rows.
    expect((await listTranslations(b, { view: "all" })).total).toBe(0);
    expect(await approveMany(b, rest)).toEqual({ approved: 0, skipped: 3 });
  });

  it("source changes: unreviewed rows are re-queued, approved rows stay online but go stale", async () => {
    setTranslatorForTests(fakeTranslator());
    const p = await createProduct(a, { title: "Helmet", description: "Good condition.", price: 100 });
    await drain(jobs);
    await approveTranslation(a, { entity: "PRODUCT", entityId: p.id, field: "title", locale: "de", value: "Helm" });

    await updateProduct(a, p.id, { title: "Helmet M35", description: "Very good condition." });
    expect(jobs.map((j) => j.name)).toEqual(["translations.sync"]);
    await runJobNow("translations.sync", jobs.shift()!.data);
    const rowsAfterSync = await db.translation.findMany({ where: { tenantId: a.tenantId, entityId: p.id } });
    const byKey = (f: string, l: string) => rowsAfterSync.find((r) => r.field === f && r.locale === l)!;
    expect(byKey("title", "de")).toMatchObject({ status: "APPROVED", value: "Helm", stale: true });
    expect(byKey("title", "nl")).toMatchObject({ status: "QUEUED" });
    expect(byKey("description", "nl")).toMatchObject({ status: "QUEUED" });

    await drain(jobs);
    const editor = await getEntityTranslations(a, "PRODUCT", p.id);
    const title = editor.fields.find((f) => f.field === "title")!;
    expect(title.source).toBe("Helmet M35");
    expect(title.cells.de).toMatchObject({ status: "APPROVED", value: "Helm", stale: true });
    expect(title.cells.nl).toMatchObject({ status: "MACHINE", value: "[nl] Helmet M35" });
    expect((await listTranslations(a, { view: "review", locale: "de" })).rows.map((r) => `${r.field}:${r.stale}`).sort()).toEqual(["description:false", "title:true"]);

    // "Translate again" on the stale approved row: a suggestion only, the online value is untouched.
    const suggestion = await suggestTranslation(a, { entity: "PRODUCT", entityId: p.id, field: "title", locale: "de" });
    expect(suggestion).toMatchObject({ value: "[de] Helmet M35", stored: false });
    expect((await getEntityTranslations(a, "PRODUCT", p.id)).fields.find((f) => f.field === "title")!.cells.de).toMatchObject({ value: "Helm", stale: true });

    // Re-approving clears stale.
    await approveTranslation(a, { entity: "PRODUCT", entityId: p.id, field: "title", locale: "de", value: "Helm M35" });
    expect((await getEntityTranslations(a, "PRODUCT", p.id)).fields.find((f) => f.field === "title")!.cells.de).toMatchObject({ value: "Helm M35", stale: false, status: "APPROVED" });
  });

  it("embedder down: rows stay QUEUED and the job fails for a retry; the save itself succeeds", async () => {
    setTranslatorForTests({
      translate: async () => {
        throw new TranslatorUnavailableError("down");
      },
    });
    const c = await createCategory(a, { title: "Helmets" });
    await runJobNow("translations.sync", jobs.shift()!.data);
    expect(await db.translation.count({ where: { tenantId: a.tenantId, entityId: c.id, status: "QUEUED" } })).toBe(2);
    const translate = jobs.find((j) => j.name === "translations.translate")!;
    await expect(runJobNow("translations.translate", translate.data)).rejects.toBeInstanceOf(TranslatorUnavailableError);
    expect(await db.translation.count({ where: { tenantId: a.tenantId, entityId: c.id, status: "QUEUED" } })).toBe(2);

    // Back up: the retry translates them.
    setTranslatorForTests(fakeTranslator());
    await runJobNow("translations.translate", translate.data);
    expect(await db.translation.count({ where: { tenantId: a.tenantId, entityId: c.id, status: "MACHINE" } })).toBe(2);
  });

  it("shops without extra languages create no rows and no jobs", async () => {
    setTranslatorForTests(fakeTranslator());
    await createProduct(b, { title: "Cap", price: 100 });
    expect(jobs).toEqual([]);
    expect(await db.translation.count({ where: { tenantId: b.tenantId } })).toBe(0);
  });

  it("bulk: translations.sync scope stock queues existing unsold products and taxonomy", async () => {
    setTranslatorForTests(null); // no translator: rows stay QUEUED, job reports skipped
    await db.product.createMany({
      data: [
        { tenantId: a.tenantId, stockCode: 9001, slug: "a", title: "Old helmet", price: 1, status: "ACTIVE" },
        { tenantId: a.tenantId, stockCode: 9002, slug: "b", title: "Sold cap", price: 1, status: "SOLD" },
      ],
    });
    await db.category.create({ data: { tenantId: a.tenantId, title: "Caps", slug: "caps" } });
    jobs.length = 0;
    await runJobNow("translations.sync", { tenantId: a.tenantId, scope: "stock" });
    const rows = await db.translation.findMany({ where: { tenantId: a.tenantId }, select: { entity: true, field: true, locale: true } });
    expect(rows.filter((r) => r.entity === "PRODUCT")).toHaveLength(2); // title × nl/de, only the unsold one
    expect(rows.filter((r) => r.entity === "CATEGORY")).toHaveLength(2);
    expect(jobs.map((j) => j.name)).toEqual(["translations.translate"]);
    expect(await runJobNow("translations.translate", jobs[0].data)).toMatchObject({ translated: 0, remaining: 4, skipped: expect.stringContaining("no translator") });
  });
});

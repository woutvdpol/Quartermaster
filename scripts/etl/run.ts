import type { PrismaClient } from "../../src/generated/prisma/client";
import type { StorageDriver } from "../../src/server/media/storage";
import { STEP_NAMES, json, type EtlContext, type EtlOptions, type StepName, type Tx } from "./context";
import type { ImageDownloader } from "./images";
import { CachingLegacyReader } from "./legacy/readers";
import type { LegacyReader } from "./legacy/types";
import { EtlReport } from "./report";
import { categoriesStep, purchasingStep, tagsStep } from "./steps/catalog";
import { contentStep } from "./steps/content";
import { facetsStep } from "./steps/facets";
import { redirectsStep, sequencesStep } from "./steps/finish";
import { downloadPendingImages, imagesStep } from "./steps/images";
import { newsletterStep } from "./steps/newsletter";
import { ordersStep } from "./steps/orders";
import { productsStep } from "./steps/products";
import { settingsStep } from "./steps/settings";
import { paymentsStep, shippingStep } from "./steps/shipping";
import { EtlAbort, ensureTenant } from "./steps/tenant";
import { usersStep } from "./steps/users";
import { legacySettingValue } from "./transforms/settings";

const STEPS: Record<StepName, (ctx: EtlContext) => Promise<void>> = {
  settings: settingsStep,
  categories: categoriesStep,
  tags: tagsStep,
  purchasing: purchasingStep,
  products: productsStep,
  images: imagesStep,
  facets: facetsStep,
  shipping: shippingStep,
  payments: paymentsStep,
  users: usersStep,
  orders: ordersStep,
  content: contentStep,
  newsletter: newsletterStep,
  redirects: redirectsStep,
  sequences: sequencesStep,
};

/** Thrown inside the dry-run transaction to roll everything back after the report is complete. */
class DryRunRollback extends Error {}

const TX_OPTIONS = { timeout: 30 * 60_000, maxWait: 60_000 };

export type RunEtlInput = {
  prisma: PrismaClient;
  legacy: LegacyReader;
  options: EtlOptions;
  downloader?: ImageDownloader | null;
  storage?: StorageDriver | null;
  log?: (line: string) => void;
};

export type RunEtlResult = { report: EtlReport; tenantId: string | null; ok: boolean; error?: string };

/**
 * Runs the ETL.
 *  - Real run: the tenant step and every step commit in their own transaction (each step is
 *    idempotent, so a failed run can simply be repeated). Photo downloads run after the images step,
 *    outside any transaction.
 *  - Dry run (--dry-run): ALL steps run in ONE transaction that is rolled back at the end — the
 *    report shows exactly what a real run would do against the current target DB; nothing is written
 *    and no photos are downloaded.
 */
export async function runEtl(input: RunEtlInput): Promise<RunEtlResult> {
  const { prisma, options } = input;
  const legacy = new CachingLegacyReader(input.legacy);
  const report = new EtlReport();
  const log = input.log ?? (() => {});
  const now = options.now ?? new Date();
  const steps = STEP_NAMES.filter((s) => !options.only || options.only.includes(s));
  report.meta["Modus"] = options.dryRun ? "dry-run (transactie teruggedraaid)" : "echte run";
  report.meta["Tenant"] = options.tenantSlug;
  report.meta["Stappen"] = steps.join(", ");
  report.meta["Foto-download"] = options.dryRun || options.skipImages || !input.downloader ? "nee (placeholders)" : input.downloader.name;

  const shopNameRow = (await legacy.read("settings")).find((s) => s.key === "shop_name");
  const legacyShopName = shopNameRow ? legacySettingValue(shopNameRow) : null;
  let tenantId: string | null = null;

  const runSteps = async (tx: Tx | null) => {
    const tenant = tx
      ? await ensureTenant(tx, options, report, legacyShopName)
      : await prisma.$transaction((t) => ensureTenant(t, options, report, legacyShopName), TX_OPTIONS);
    tenantId = tenant.tenantId;
    const ctx: EtlContext = {
      tx: tx as Tx,
      prisma,
      legacy,
      report,
      options,
      tenantId: tenant.tenantId,
      currency: tenant.currency,
      downloader: input.downloader ?? null,
      storage: input.storage ?? null,
      now,
    };
    for (const name of steps) {
      const started = Date.now();
      log(`▶ ${name}`);
      try {
        if (tx) await STEPS[name]({ ...ctx, tx });
        else await prisma.$transaction((t) => STEPS[name]({ ...ctx, tx: t }), TX_OPTIONS);
        // ctx.currency may be changed by the settings step
        if (name === "settings") ctx.currency = (await (tx ?? prisma).tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } })).currency;
        report.steps.push({ name, ms: Date.now() - started, status: "ok" });
      } catch (err) {
        report.steps.push({ name, ms: Date.now() - started, status: "failed", note: (err as Error).message.slice(0, 200) });
        throw err;
      }
      if (name === "images" && !tx && !options.skipImages && input.downloader && input.storage) {
        const started2 = Date.now();
        log("▶ images (download)");
        await downloadPendingImages({ prisma, tenantId: ctx.tenantId, downloader: input.downloader, storage: input.storage, report });
        report.steps.push({ name: "images (download)", ms: Date.now() - started2, status: "ok" });
      }
    }
    if (!tx) {
      await prisma.auditLog.create({
        data: { tenantId: ctx.tenantId, action: "etl.import", entity: "Tenant", entityId: ctx.tenantId, data: json({ source: "Concept500", report: report.toJSON().entities }) },
      });
    }
  };

  try {
    if (options.dryRun) {
      await prisma
        .$transaction(async (tx) => {
          await runSteps(tx);
          throw new DryRunRollback();
        }, TX_OPTIONS)
        .catch((err) => {
          if (!(err instanceof DryRunRollback)) throw err;
        });
    } else {
      await runSteps(null);
    }
    report.finishedAt = new Date();
    return { report, tenantId, ok: true };
  } catch (err) {
    report.finishedAt = new Date();
    const message = err instanceof EtlAbort ? err.message : `${(err as Error).name}: ${(err as Error).message}`;
    report.warn(`ETL afgebroken: ${message.slice(0, 500)}`);
    return { report, tenantId, ok: false, error: message };
  } finally {
    await legacy.close();
  }
}

import type { SettingsGroup } from "../../../src/server/settings/schema";
import { json, stableJson, type EtlContext } from "../context";
import { mapLegacySettings, mergeAndValidate } from "../transforms/settings";
import { planFromLegacy, type LegacyPlatformSettings } from "../../../src/server/modules/legacy";

/** Legacy `settings` (+ `currencies` for display currencies) → Setting rows and Tenant columns. */
export async function settingsStep(ctx: EtlContext) {
  const { tx, report, tenantId } = ctx;
  const rows = await ctx.legacy.read("settings");
  const currencies = (await ctx.legacy.read("currencies")).map((c) => c.code);
  report.legacy("settings (keys)", rows.length);

  const mapped = mapLegacySettings(rows, currencies);
  for (const [group, patch] of Object.entries(mapped.groups) as [SettingsGroup, Record<string, unknown>][]) {
    const existing = await tx.setting.findUnique({ where: { tenantId_group: { tenantId, group } } });
    const { data, rejected } = mergeAndValidate(group, existing?.data, patch);
    for (const key of rejected) report.warn(`settings.${group}.${key}: legacy value rejected by the schema → kept current/default`);
    if (existing) {
      if (stableJson(existing.data) === stableJson(data)) report.unchanged("settings (groups)");
      else {
        await tx.setting.update({ where: { id: existing.id }, data: { data: json(data) } });
        report.updated("settings (groups)");
      }
    } else {
      await tx.setting.create({ data: { tenantId, group, data: json(data) } });
      report.created("settings (groups)");
    }
  }

  // Package (docs/modules.md): the Concept500 tier and limits, now in the platform group, → TenantPlan.
  const platform = await tx.setting.findUnique({ where: { tenantId_group: { tenantId, group: "platform" } } });
  const legacy = planFromLegacy((platform?.data ?? {}) as LegacyPlatformSettings);
  const planData = {
    plan: legacy.plan,
    productLimit: legacy.productLimit,
    photoLimit: legacy.photoLimit,
    newsletterQuota: legacy.newsletterQuota,
    source: "LEGACY" as const,
  };
  await tx.tenantPlan.upsert({ where: { tenantId }, create: { tenantId, ...planData }, update: planData });
  if (legacy.newsletterModule) {
    await tx.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: "newsletter" } },
      create: { tenantId, moduleId: "newsletter", status: "ACTIVE", source: "LEGACY" },
      update: { status: "ACTIVE", source: "LEGACY" },
    });
  }
  report.note("Pakket", `${legacy.plan}${legacy.newsletterModule ? " + nieuwsbrief" : ""} (uit Concept500-abonnement)`);

  const tenantPatch: { currency?: string; timezone?: string } = {};
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  if (mapped.tenant.currency && mapped.tenant.currency !== tenant.currency) tenantPatch.currency = mapped.tenant.currency;
  if (mapped.tenant.timezone && mapped.tenant.timezone !== tenant.timezone) tenantPatch.timezone = mapped.tenant.timezone;
  if (Object.keys(tenantPatch).length) {
    await tx.tenant.update({ where: { id: tenantId }, data: tenantPatch });
    if (tenantPatch.currency) ctx.currency = tenantPatch.currency;
  }

  const e = report.entity("settings (keys)");
  e.created += mapped.applied.length;
  report.skip("settings (keys)", "leeg/standaard", mapped.empty.length);
  report.skip("settings (keys)", "bewust vervallen", mapped.dropped.length);
  report.skip("settings (keys)", "geen mapping", mapped.unmapped.length);
  for (const d of mapped.dropped) report.note("Settings: vervallen keys", `\`${d.key}\` — ${d.reason}`);
  for (const k of mapped.unmapped) report.note("Settings: niet-gemapte keys", `\`${k}\``);
  for (const img of mapped.images) report.note("Settings: afbeeldingen niet gemigreerd (Cloudflare)", `\`${img.key}\`: ${img.ids.length} image-id(s)`);
  for (const w of mapped.warnings) report.warn(`settings: ${w}`);
}

import { PaymentMethod } from "@mollie/api-client";
import { isCountryCode } from "../../../src/server/shipping/countries";
import { PAYMENTS_SETTINGS_GROUP, parseStoredPaymentsSettings, paymentsSettingsSchema } from "../../../src/server/payments/settings";
import { MAX_SURCHARGE_BPS } from "../../../src/server/payments/surcharge";
import { methodLabel } from "../../../src/server/payments/method-labels";

const MOLLIE_METHOD_IDS = new Set<string>(Object.values(PaymentMethod));
import type { EtlContext } from "../context";
import { toCountryCode } from "../transforms/people";

export const PICKUP_NAME = /pick\s*-?\s*up|afhalen|ophalen|collect|abholung/i;

/** "12.50" (DECIMAL major units) → 1250 minor units; null when not a number. */
export function decimalToMinor(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/**
 * Legacy `regions` + `weights` + `region_weights` → ShippingZone + ShippingRate (decision 21: zones
 * per ISO country, weight tiers per zone). Legacy regions are free names without countries, so the
 * country list comes from --zone-countries "Region=NL,BE" or, failing that, is inferred from the
 * countries of legacy orders in that region (reported for the owner to verify). A country may be in
 * only one delivery zone; a zone without countries is created inactive. "Pickup in store"-like
 * regions become pickup zones. Zones are matched by name (no legacy id column).
 */
export async function shippingStep(ctx: EtlContext) {
  const { tx, report, tenantId } = ctx;
  const regions = await ctx.legacy.read("regions");
  const weights = new Map((await ctx.legacy.read("weights")).map((w) => [w.id, w.weight]));
  const regionWeights = await ctx.legacy.read("region_weights");
  const orders = await ctx.legacy.read("orders");
  report.legacy("shipping zones", regions.length);
  report.legacy("shipping rates", regionWeights.length);

  const claimed = new Set<string>();
  const otherZones = await tx.shippingZone.findMany({ where: { tenantId, isPickup: false } });
  const regionNames = new Set(regions.map((r) => r.title.trim().toLowerCase()));
  for (const z of otherZones) if (!regionNames.has(z.name.trim().toLowerCase())) z.countries.forEach((c) => claimed.add(c));

  for (const [index, region] of regions.entries()) {
    const name = region.title.trim() || `Region ${region.id}`;
    const isPickup = PICKUP_NAME.test(name);
    let countries: string[] = [];
    let source = "";
    if (!isPickup) {
      const explicit = Object.entries(ctx.options.zoneCountries).find(([k]) => k.trim().toLowerCase() === name.toLowerCase());
      if (explicit) {
        countries = explicit[1].map((c) => c.trim().toUpperCase()).filter((c) => c === "*" || isCountryCode(c));
        source = "--zone-countries";
      } else {
        const inferred = new Set<string>();
        for (const o of orders) {
          if ((o.region ?? "").trim().toLowerCase() !== name.toLowerCase()) continue;
          const cc = toCountryCode(o.country);
          if (cc) inferred.add(cc);
        }
        countries = [...inferred].sort();
        source = "afgeleid uit orders";
        report.note("Verzendregio's zonder landkoppeling (controleren!)", `"${name}": landen ${countries.length ? countries.join(", ") : "geen"} (${source})`);
      }
      const conflicts = countries.filter((c) => claimed.has(c));
      if (conflicts.length) {
        report.warn(`shipping zone "${name}": ${conflicts.join(", ")} already in another zone → removed`);
        countries = countries.filter((c) => !claimed.has(c));
      }
      countries.forEach((c) => claimed.add(c));
    }
    const isActive = isPickup || countries.length > 0;
    if (!isActive) report.warn(`shipping zone "${name}" has no countries → created inactive (assign countries in Admin → Shipping)`);

    let zone = await tx.shippingZone.findFirst({ where: { tenantId, name } });
    if (zone) {
      const same = zone.countries.join(",") === countries.join(",") && zone.isPickup === isPickup && zone.isActive === isActive && zone.sortOrder === index;
      if (same) report.unchanged("shipping zones");
      else {
        zone = await tx.shippingZone.update({ where: { id: zone.id }, data: { countries, isPickup, isActive, sortOrder: index } });
        report.updated("shipping zones");
      }
    } else {
      zone = await tx.shippingZone.create({ data: { tenantId, name, countries, isPickup, isActive, sortOrder: index } });
      report.created("shipping zones");
    }

    const wanted = new Map<number, number>();
    for (const rw of regionWeights.filter((x) => x.region_id === region.id)) {
      const maxWeightGrams = weights.get(rw.weight_id);
      const price = decimalToMinor(rw.delivery_charge);
      if (!maxWeightGrams || maxWeightGrams <= 0) {
        report.skip("shipping rates", "gewicht ontbreekt/0");
        continue;
      }
      if (price === null || price < 0) {
        report.skip("shipping rates", "ongeldig tarief");
        continue;
      }
      wanted.set(maxWeightGrams, price);
    }
    // Pickup: one free tier when legacy had none.
    if (isPickup && wanted.size === 0) wanted.set(30_000, 0);
    const current = await tx.shippingRate.findMany({ where: { zoneId: zone.id } });
    for (const c of current) if (!wanted.has(c.maxWeightGrams)) await tx.shippingRate.delete({ where: { id: c.id } });
    for (const [maxWeightGrams, price] of wanted) {
      const cur = current.find((c) => c.maxWeightGrams === maxWeightGrams);
      if (!cur) {
        await tx.shippingRate.create({ data: { tenantId, zoneId: zone.id, maxWeightGrams, price } });
        report.created("shipping rates");
      } else if (cur.price !== price) {
        await tx.shippingRate.update({ where: { id: cur.id }, data: { price } });
        report.updated("shipping rates");
      } else report.unchanged("shipping rates");
    }
  }
  const orphanRegions = new Set(regionWeights.map((r) => r.region_id).filter((id) => !regions.some((r) => r.id === id)));
  if (orphanRegions.size) report.skip("shipping rates", "regio bestaat niet", regionWeights.filter((r) => orphanRegions.has(r.region_id)).length);
}

/**
 * Legacy `payment_methods` are not migrated as methods: Quartermaster takes payments through Mollie only
 * (decision 16); bank transfer/cash survive as PaymentProvider.MANUAL on imported orders. A legacy
 * surcharge % (Concept500: PayPal 5%) becomes a surcharge rule for the matching Mollie method id in the
 * "payments" setting (src/server/payments/surcharge.ts). Rules the owner already configured are never
 * overwritten (re-runs leave them alone). The % is also used to recognise surcharges inside legacy order
 * totals (steps/orders.ts → Order.surchargeTotal).
 */
export async function paymentsStep(ctx: EtlContext) {
  const { report, tx, tenantId } = ctx;
  const methods = await ctx.legacy.read("payment_methods");
  report.legacy("payment methods", methods.length);
  const row = await tx.setting.findUnique({ where: { tenantId_group: { tenantId, group: PAYMENTS_SETTINGS_GROUP } } });
  if (row && !paymentsSettingsSchema.safeParse(row.data).success) {
    // Never rewrite a row we can't fully parse (it holds the encrypted Mollie key).
    report.warn("payments-setting is ongeldig — toeslagen niet overgenomen");
    return;
  }
  const current = parseStoredPaymentsSettings(row?.data);
  const surcharges = { ...current.surcharges };
  let changed = false;
  for (const m of methods) {
    const pct = Number(m.surcharge ?? 0) || 0;
    const methodId = m.name.trim().toLowerCase().replace(/[\s_-]+/g, "");
    if (pct <= 0) {
      report.skip("payment methods", /mollie/i.test(m.name) ? "Mollie: configureer API-key in Admin → Payments" : "alleen Mollie (besluit 16)");
      continue;
    }
    if (!MOLLIE_METHOD_IDS.has(methodId)) {
      report.skip("payment surcharges", "geen Mollie-methode");
      report.note("Betaalmethoden", `"${m.name}" had een toeslag van ${pct}% — geen bijbehorende Mollie-methode, niet overgenomen`);
      continue;
    }
    const percentBps = Math.round(pct * 100);
    if (surcharges[methodId]) {
      report.unchanged("payment surcharges");
      continue;
    }
    if (percentBps > MAX_SURCHARGE_BPS) {
      report.skip("payment surcharges", "toeslag > 20%");
      continue;
    }
    surcharges[methodId] = { percentBps, fixed: 0, cap: null, label: `${methodLabel(methodId)} fee` };
    changed = true;
    report.created("payment surcharges");
    report.note("Betaalmethoden", `"${m.name}" toeslag ${pct}% → Mollie-methode \`${methodId}\` (${percentBps} bp, label "${methodLabel(methodId)} fee")`);
  }
  if (changed) {
    const data = JSON.parse(JSON.stringify({ ...current, surcharges }));
    if (row) await tx.setting.update({ where: { id: row.id }, data: { data } });
    else await tx.setting.create({ data: { tenantId, group: PAYMENTS_SETTINGS_GROUP, data } });
  }
}

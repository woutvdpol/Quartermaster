import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { ServiceError } from "@/server/context";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { createZone, deleteZone, getCoverage, getZone, listZones, reorderZones, setZoneRates, updateZone } from "./zones";
import { quoteShipping } from "./quote";

const code = (p: Promise<unknown>) =>
  p.then(
    () => "OK",
    (e) => (e instanceof ServiceError ? e.code : `THREW ${String(e)}`),
  );

describe("shipping zones service", () => {
  beforeEach(resetDb);

  it("creates zones with sorted tiers, lists in display order and audits", async () => {
    const ctx = await createTenantContext();
    const benelux = await createZone(ctx, {
      name: "Benelux",
      countries: ["nl", "BE", "LU"],
      rates: [{ maxWeightGrams: 5000, price: 900 }, { maxWeightGrams: 1000, price: 500 }],
    });
    expect(benelux.countries).toEqual(["BE", "LU", "NL"]);
    expect(benelux.rates.map((r) => r.maxWeightGrams)).toEqual([1000, 5000]);
    expect(benelux.rates.every((r) => r.tenantId === ctx.tenantId)).toBe(true);
    const world = await createZone(ctx, { name: "World", countries: ["*"] });
    expect(world.sortOrder).toBe(benelux.sortOrder + 1);

    expect((await listZones(ctx)).map((z) => z.name)).toEqual(["Benelux", "World"]);
    expect((await getZone(ctx, benelux.id)).rates).toHaveLength(2);
    const audits = await db.auditLog.findMany({ where: { tenantId: ctx.tenantId, action: "shipping.zone.create" } });
    expect(audits).toHaveLength(2);
  });

  it("validates input", async () => {
    const ctx = await createTenantContext();
    expect(await code(createZone(ctx, { name: "Bad", countries: ["XX"] }))).toBe("INVALID");
    expect(await code(createZone(ctx, { name: "Empty", countries: [] }))).toBe("INVALID");
    expect(await code(createZone(ctx, { name: "Dup", countries: ["NL"], rates: [{ maxWeightGrams: 1, price: 1 }, { maxWeightGrams: 1, price: 2 }] }))).toBe("INVALID");
    expect(await db.shippingZone.count()).toBe(0);
  });

  it("enforces one delivery zone per country (and one rest-of-world zone)", async () => {
    const ctx = await createTenantContext();
    const benelux = await createZone(ctx, { name: "Benelux", countries: ["BE", "NL", "LU"] });
    const eu = await createZone(ctx, { name: "EU", countries: ["DE", "FR"] });
    await createZone(ctx, { name: "World", countries: ["*"] });

    const err = await createZone(ctx, { name: "Netherlands", countries: ["NL"] }).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect(err.code).toBe("CONFLICT");
    expect(err.details).toEqual({ conflicts: [{ country: "NL", zoneId: benelux.id, zoneName: "Benelux" }] });
    expect(await code(createZone(ctx, { name: "World 2", countries: ["*"] }))).toBe("CONFLICT");
    // Inactive zones still own their countries.
    expect(await code(createZone(ctx, { name: "Netherlands", countries: ["NL"], isActive: false }))).toBe("CONFLICT");
    // Pickup zones are exempt.
    expect(await code(createZone(ctx, { name: "Pickup", countries: ["NL"], isPickup: true }))).toBe("OK");

    expect(await code(updateZone(ctx, eu.id, { countries: ["DE", "FR", "BE"] }))).toBe("CONFLICT");
    // Moving a country: remove it from Benelux first, then add it elsewhere.
    await updateZone(ctx, benelux.id, { countries: ["BE", "LU"] });
    expect((await updateZone(ctx, eu.id, { countries: ["DE", "FR", "NL"] })).countries).toEqual(["DE", "FR", "NL"]);

    // Turning a pickup zone into a delivery zone re-checks the rule.
    const pickup = (await listZones(ctx)).find((z) => z.isPickup)!;
    expect(await code(updateZone(ctx, pickup.id, { isPickup: false }))).toBe("CONFLICT");
    // A delivery zone can't end up with no countries.
    expect(await code(updateZone(ctx, eu.id, { countries: [] }))).toBe("INVALID");
  });

  it("serialises concurrent creates so the rule can't race", async () => {
    const ctx = await createTenantContext();
    const results = await Promise.all(Array.from({ length: 4 }, (_, i) => code(createZone(ctx, { name: `NL ${i}`, countries: ["NL"] }))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect(results.filter((r) => r === "CONFLICT")).toHaveLength(3);
  });

  it("replaces rates atomically and rejects duplicates", async () => {
    const ctx = await createTenantContext();
    const z = await createZone(ctx, { name: "NL", countries: ["NL"], rates: [{ maxWeightGrams: 1000, price: 500 }] });
    const updated = await setZoneRates(ctx, z.id, [
      { maxWeightGrams: 20000, price: 1500, insurancePrice: 300, maxInsuredValue: 100000 },
      { maxWeightGrams: 2000, price: 700 },
    ]);
    expect(updated.rates.map((r) => [r.maxWeightGrams, r.price, r.insurancePrice])).toEqual([
      [2000, 700, null],
      [20000, 1500, 300],
    ]);
    expect(await code(setZoneRates(ctx, z.id, [{ maxWeightGrams: 5, price: 1 }, { maxWeightGrams: 5, price: 1 }]))).toBe("INVALID");
    expect((await getZone(ctx, z.id)).rates).toHaveLength(2);
    expect((await setZoneRates(ctx, z.id, [])).rates).toEqual([]);
  });

  it("reorders and deletes zones (orders keep their snapshot)", async () => {
    const ctx = await createTenantContext();
    const a = await createZone(ctx, { name: "A", countries: ["NL"], rates: [{ maxWeightGrams: 1, price: 1 }] });
    const b = await createZone(ctx, { name: "B", countries: ["BE"] });
    await reorderZones(ctx, [b.id, a.id]);
    expect((await listZones(ctx)).map((z) => z.name)).toEqual(["B", "A"]);
    expect(await code(reorderZones(ctx, [a.id]))).toBe("INVALID");

    await deleteZone(ctx, a.id);
    expect(await db.shippingRate.count({ where: { zoneId: a.id } })).toBe(0);
    expect(await code(getZone(ctx, a.id))).toBe("NOT_FOUND");
    expect(await code(deleteZone(ctx, a.id))).toBe("NOT_FOUND");
  });

  it("reports coverage / rest of world", async () => {
    const ctx = await createTenantContext();
    await createZone(ctx, { name: "Benelux", countries: ["BE", "NL", "LU"] });
    const cov = await getCoverage(ctx);
    expect(cov.restOfWorldZoneId).toBeNull();
    expect(cov.uncovered).toContain("DE");
    expect(cov.uncovered).not.toContain("NL");
    const world = await createZone(ctx, { name: "World", countries: ["*"] });
    expect(await getCoverage(ctx)).toEqual({ restOfWorldZoneId: world.id, uncovered: [] });
  });

  it("isolates tenants", async () => {
    const a = await createTenantContext();
    const b = await createTenantContext();
    const zoneA = await createZone(a, { name: "NL", countries: ["NL"], rates: [{ maxWeightGrams: 1000, price: 500 }] });
    // Same country in another tenant is fine.
    await createZone(b, { name: "NL too", countries: ["NL"], rates: [{ maxWeightGrams: 1000, price: 999 }] });

    expect((await listZones(b)).map((z) => z.name)).toEqual(["NL too"]);
    expect(await code(getZone(b, zoneA.id))).toBe("NOT_FOUND");
    expect(await code(updateZone(b, zoneA.id, { name: "hijack" }))).toBe("NOT_FOUND");
    expect(await code(setZoneRates(b, zoneA.id, []))).toBe("NOT_FOUND");
    expect(await code(deleteZone(b, zoneA.id))).toBe("NOT_FOUND");
    expect(await code(reorderZones(b, [zoneA.id]))).toBe("INVALID");
    expect((await getZone(a, zoneA.id)).name).toBe("NL");

    const qa = await quoteShipping(a.tenantId, { countryCode: "NL", totalWeightGrams: 500, subtotal: 1000 });
    const qb = await quoteShipping(b.tenantId, { countryCode: "NL", totalWeightGrams: 500, subtotal: 1000 });
    expect(qa.deliverable && qa.options.map((o) => o.price)).toEqual([500]);
    expect(qb.deliverable && qb.options.map((o) => o.price)).toEqual([999]);
  });

  it("quotes from the database, ignoring inactive zones", async () => {
    const ctx = await createTenantContext();
    const nl = await createZone(ctx, { name: "NL", countries: ["NL"], rates: [{ maxWeightGrams: 2000, price: 695 }] });
    await createZone(ctx, { name: "Pickup", isPickup: true });
    const r = await quoteShipping(ctx.tenantId, { countryCode: "NL", totalWeightGrams: 2000, subtotal: 5000 });
    expect(r.deliverable && r.options.map((o) => [o.name, o.price, o.isPickup])).toEqual([
      ["NL", 695, false],
      ["Pickup", 0, true],
    ]);
    await updateZone(ctx, nl.id, { isActive: false });
    const r2 = await quoteShipping(ctx.tenantId, { countryCode: "NL", totalWeightGrams: 2000, subtotal: 5000 });
    expect(r2).toMatchObject({ deliverable: true, deliveryUnavailable: "NO_ZONE" });
    expect(await code(quoteShipping(ctx.tenantId, { countryCode: "NL", totalWeightGrams: -1, subtotal: 0 }))).toBe("INVALID");
  });
});

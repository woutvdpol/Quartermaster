import "server-only";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import { parseInput } from "@/server/catalog/errors";
import type { Prisma } from "@/generated/prisma/client";
import { COUNTRY_CODES, REST_OF_WORLD, type CountryCode } from "./countries";
import {
  createZoneSchema,
  findCountryConflicts,
  ratesSchema,
  updateZoneSchema,
  type CreateZoneInput,
  type Rate,
  type RateInput,
  type UpdateZoneInput,
} from "./validation";

/*
 * Shipping zones admin service (decision 21: zones per country + weight tiers per zone).
 * Rules: see ./validation.ts (one non-pickup zone per country, "*" = rest of world) and ./calc.ts (quote).
 * Zone writes serialise per tenant with a transaction-scoped advisory lock, so the one-zone-per-country
 * check can't race. Hard delete is fine: orders keep a name snapshot (Order.shippingZoneId → SET NULL).
 */

type Tx = Prisma.TransactionClient;

const zoneInclude = { rates: { orderBy: { maxWeightGrams: "asc" } } } satisfies Prisma.ShippingZoneInclude;
export type ShippingZoneWithRates = Prisma.ShippingZoneGetPayload<{ include: typeof zoneInclude }>;

const idSchema = (id: unknown) => (typeof id === "string" && id.length > 0 && id.length <= 64 ? id : null);

async function lockTenantZones(tx: Tx, tenantId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`shipping_zones:${tenantId}`}))`;
}

async function findZoneTx(tx: Tx, tenantId: string, id: unknown) {
  const zoneId = idSchema(id);
  const zone = zoneId ? await tx.shippingZone.findFirst({ where: { id: zoneId, tenantId } }) : null;
  if (!zone) throw new ServiceError("NOT_FOUND", "Shipping zone not found");
  return zone;
}

async function assertNoCountryConflicts(tx: Tx, tenantId: string, candidate: { id: string; name: string; countries: string[]; isPickup: boolean }) {
  if (candidate.isPickup) return;
  const others = await tx.shippingZone.findMany({
    where: { tenantId, isPickup: false, NOT: { id: candidate.id } },
    select: { id: true, name: true, countries: true, isPickup: true },
  });
  const conflicts = findCountryConflicts(candidate, others);
  if (conflicts.length) {
    const list = conflicts.map((c) => `${c.country === REST_OF_WORLD ? "rest of world" : c.country} (in "${c.zoneName}")`).join(", ");
    throw new ServiceError("CONFLICT", `Already in another delivery zone: ${list}`, { conflicts });
  }
}

function rateRows(tenantId: string, zoneId: string, rates: Rate[]): Prisma.ShippingRateCreateManyInput[] {
  return rates.map((r) => ({ tenantId, zoneId, ...r }));
}

/** All zones of the tenant with their rates (tiers ascending), in display order. */
export async function listZones(ctx: ServiceContext): Promise<ShippingZoneWithRates[]> {
  return db.shippingZone.findMany({
    where: { tenantId: ctx.tenantId },
    include: zoneInclude,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
  });
}

export async function getZone(ctx: ServiceContext, id: string): Promise<ShippingZoneWithRates> {
  const zoneId = idSchema(id);
  const zone = zoneId ? await db.shippingZone.findFirst({ where: { id: zoneId, tenantId: ctx.tenantId }, include: zoneInclude }) : null;
  if (!zone) throw new ServiceError("NOT_FOUND", "Shipping zone not found");
  return zone;
}

/**
 * Delivery coverage overview for the admin: which zone is "rest of world", and which countries no
 * active delivery zone serves (empty when an active rest-of-world zone exists).
 */
export async function getCoverage(ctx: ServiceContext): Promise<{ restOfWorldZoneId: string | null; uncovered: CountryCode[] }> {
  const zones = await db.shippingZone.findMany({
    where: { tenantId: ctx.tenantId, isPickup: false, isActive: true },
    select: { id: true, countries: true },
    orderBy: { sortOrder: "asc" },
  });
  const row = zones.find((z) => z.countries.includes(REST_OF_WORLD));
  if (row) return { restOfWorldZoneId: row.id, uncovered: [] };
  const covered = new Set(zones.flatMap((z) => z.countries));
  return { restOfWorldZoneId: null, uncovered: COUNTRY_CODES.filter((c) => !covered.has(c)) };
}

/** Creates a zone (optionally with its weight tiers). New zones go last unless `sortOrder` is given. */
export async function createZone(ctx: ServiceContext, input: CreateZoneInput): Promise<ShippingZoneWithRates> {
  const data = parseInput(createZoneSchema, input);
  const zone = await db.$transaction(async (tx) => {
    await lockTenantZones(tx, ctx.tenantId);
    await assertNoCountryConflicts(tx, ctx.tenantId, { id: "", name: data.name, countries: data.countries, isPickup: data.isPickup });
    let sortOrder = data.sortOrder;
    if (sortOrder === undefined) {
      const last = await tx.shippingZone.aggregate({ where: { tenantId: ctx.tenantId }, _max: { sortOrder: true } });
      sortOrder = (last._max.sortOrder ?? -1) + 1;
    }
    const created = await tx.shippingZone.create({
      data: { tenantId: ctx.tenantId, name: data.name, countries: data.countries, isPickup: data.isPickup, isActive: data.isActive, sortOrder },
    });
    if (data.rates.length) await tx.shippingRate.createMany({ data: rateRows(ctx.tenantId, created.id, data.rates) });
    return tx.shippingZone.findUniqueOrThrow({ where: { id: created.id }, include: zoneInclude });
  });
  await audit({
    action: "shipping.zone.create",
    tenantId: ctx.tenantId,
    actorId: ctx.actor.id,
    entity: "ShippingZone",
    entityId: zone.id,
    data: { name: zone.name, countries: zone.countries, isPickup: zone.isPickup, tiers: zone.rates.length },
  });
  return zone;
}

/** Updates zone fields (not rates — see setZoneRates). Re-checks the one-zone-per-country rule. */
export async function updateZone(ctx: ServiceContext, id: string, patch: UpdateZoneInput): Promise<ShippingZoneWithRates> {
  const data = parseInput(updateZoneSchema, patch);
  const { zone, changed } = await db.$transaction(async (tx) => {
    await lockTenantZones(tx, ctx.tenantId);
    const current = await findZoneTx(tx, ctx.tenantId, id);
    const next = {
      name: data.name ?? current.name,
      countries: data.countries ?? current.countries,
      isPickup: data.isPickup ?? current.isPickup,
      isActive: data.isActive ?? current.isActive,
      sortOrder: data.sortOrder ?? current.sortOrder,
    };
    if (!next.isPickup && next.countries.length === 0) {
      throw new ServiceError("INVALID", "countries: A delivery zone needs at least one country (or * for rest of world)");
    }
    await assertNoCountryConflicts(tx, ctx.tenantId, { id: current.id, ...next });
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
      (k) => JSON.stringify(next[k]) !== JSON.stringify(current[k]),
    );
    if (changed.length) await tx.shippingZone.update({ where: { id: current.id }, data: next });
    return { zone: await tx.shippingZone.findUniqueOrThrow({ where: { id: current.id }, include: zoneInclude }), changed };
  });
  if (changed.length) {
    await audit({
      action: "shipping.zone.update",
      tenantId: ctx.tenantId,
      actorId: ctx.actor.id,
      entity: "ShippingZone",
      entityId: zone.id,
      data: { changed, countries: zone.countries },
    });
  }
  return zone;
}

/** Replaces all weight tiers of a zone atomically (validated: unique tiers, sorted ascending). */
export async function setZoneRates(ctx: ServiceContext, zoneId: string, rates: RateInput[]): Promise<ShippingZoneWithRates> {
  const data = parseInput(ratesSchema, rates);
  const zone = await db.$transaction(async (tx) => {
    await lockTenantZones(tx, ctx.tenantId);
    const current = await findZoneTx(tx, ctx.tenantId, zoneId);
    await tx.shippingRate.deleteMany({ where: { zoneId: current.id, tenantId: ctx.tenantId } });
    if (data.length) await tx.shippingRate.createMany({ data: rateRows(ctx.tenantId, current.id, data) });
    return tx.shippingZone.findUniqueOrThrow({ where: { id: current.id }, include: zoneInclude });
  });
  await audit({
    action: "shipping.rates.update",
    tenantId: ctx.tenantId,
    actorId: ctx.actor.id,
    entity: "ShippingZone",
    entityId: zone.id,
    data: { tiers: zone.rates.map((r) => ({ maxWeightGrams: r.maxWeightGrams, price: r.price, insurancePrice: r.insurancePrice })) },
  });
  return zone;
}

/** Sets display order: `orderedIds` must be exactly the tenant's zone ids. */
export async function reorderZones(ctx: ServiceContext, orderedIds: string[]): Promise<void> {
  if (!Array.isArray(orderedIds) || orderedIds.some((id) => !idSchema(id))) throw new ServiceError("INVALID", "Expected a list of zone ids");
  await db.$transaction(async (tx) => {
    await lockTenantZones(tx, ctx.tenantId);
    const zones = await tx.shippingZone.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true } });
    const known = new Set(zones.map((z) => z.id));
    if (new Set(orderedIds).size !== orderedIds.length || orderedIds.length !== known.size || orderedIds.some((id) => !known.has(id))) {
      throw new ServiceError("INVALID", "The list must contain every zone exactly once");
    }
    for (const [i, id] of orderedIds.entries()) await tx.shippingZone.update({ where: { id }, data: { sortOrder: i } });
  });
  await audit({ action: "shipping.zone.reorder", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "ShippingZone", data: { order: orderedIds } });
}

/** Deletes a zone and its rates. Past orders keep `shippingZoneName`; their zone link becomes null. */
export async function deleteZone(ctx: ServiceContext, id: string): Promise<void> {
  const zone = await db.$transaction(async (tx) => {
    await lockTenantZones(tx, ctx.tenantId);
    const current = await findZoneTx(tx, ctx.tenantId, id);
    await tx.shippingZone.delete({ where: { id: current.id } });
    return current;
  });
  await audit({
    action: "shipping.zone.delete",
    tenantId: ctx.tenantId,
    actorId: ctx.actor.id,
    entity: "ShippingZone",
    entityId: zone.id,
    data: { name: zone.name, countries: zone.countries },
  });
}

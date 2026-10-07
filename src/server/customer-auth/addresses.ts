import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import type { AddressType } from "@/generated/prisma/enums";
import { isCountryCode } from "@/server/shipping/countries";

/*
 * Address book of a signed-in customer. Every query is scoped by (tenantId, customerId), so an id
 * from another customer or shop simply isn't found. At most one default per address type.
 */

export const MAX_ADDRESSES = 20;

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const req = (max: number, msg: string) => z.string().trim().min(1, msg).max(max, `Must be at most ${max} characters`);

export const addressSchema = z.object({
  type: z.enum(["SHIPPING", "BILLING"]).default("SHIPPING"),
  isDefault: z.boolean().default(false),
  firstName: req(100, "Enter a first name"),
  lastName: req(100, "Enter a last name"),
  company: opt(150),
  street: req(200, "Enter a street"),
  houseNumber: opt(20),
  line2: opt(200),
  postalCode: opt(20),
  city: req(100, "Enter a city"),
  region: opt(100),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isCountryCode, "Choose a country"),
  phone: opt(40),
});
export type AddressInput = z.input<typeof addressSchema>;
export type AddressFieldErrors = Partial<Record<keyof AddressInput, string>>;

export type AddressResult = { ok: true; id: string } | { ok: false; error: "invalid" | "not_found" | "limit"; fieldErrors?: AddressFieldErrors };

type Owner = { tenantId: string; customerId: string };

function fieldErrors(error: z.ZodError): AddressFieldErrors {
  const out: AddressFieldErrors = {};
  for (const issue of error.issues) {
    const k = issue.path[0] as keyof AddressInput;
    if (k && !out[k]) out[k] = issue.message;
  }
  return out;
}

export function listAddresses(owner: Owner) {
  return db.address.findMany({
    where: { tenantId: owner.tenantId, customerId: owner.customerId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
}

export function getAddress(owner: Owner, id: string) {
  return db.address.findFirst({ where: { id, tenantId: owner.tenantId, customerId: owner.customerId } });
}

async function clearDefault(tx: Pick<typeof db, "address">, owner: Owner, type: AddressType, exceptId?: string) {
  await tx.address.updateMany({
    where: { tenantId: owner.tenantId, customerId: owner.customerId, type, isDefault: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { isDefault: false },
  });
}

export async function createAddress(owner: Owner, input: AddressInput): Promise<AddressResult> {
  const parsed = addressSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const count = await db.address.count({ where: { tenantId: owner.tenantId, customerId: owner.customerId } });
  if (count >= MAX_ADDRESSES) return { ok: false, error: "limit" };
  const data = parsed.data;
  // The first address of a type becomes its default.
  const hasOfType = await db.address.count({ where: { tenantId: owner.tenantId, customerId: owner.customerId, type: data.type } });
  const isDefault = data.isDefault || hasOfType === 0;
  const row = await db.$transaction(async (tx) => {
    if (isDefault) await clearDefault(tx, owner, data.type);
    return tx.address.create({ data: { ...data, isDefault, tenantId: owner.tenantId, customerId: owner.customerId } });
  });
  return { ok: true, id: row.id };
}

export async function updateAddress(owner: Owner, id: string, input: AddressInput): Promise<AddressResult> {
  const parsed = addressSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const existing = await getAddress(owner, id);
  if (!existing) return { ok: false, error: "not_found" };
  const data = parsed.data;
  // Keep a default when the type doesn't change and it already was one (unchecking needs another default).
  const isDefault = data.isDefault || (existing.isDefault && existing.type === data.type);
  await db.$transaction(async (tx) => {
    if (isDefault) await clearDefault(tx, owner, data.type, id);
    await tx.address.update({ where: { id }, data: { ...data, isDefault } });
  });
  return { ok: true, id };
}

export async function setDefaultAddress(owner: Owner, id: string): Promise<AddressResult> {
  const existing = await getAddress(owner, id);
  if (!existing) return { ok: false, error: "not_found" };
  await db.$transaction(async (tx) => {
    await clearDefault(tx, owner, existing.type, id);
    await tx.address.update({ where: { id }, data: { isDefault: true } });
  });
  return { ok: true, id };
}

export async function deleteAddress(owner: Owner, id: string): Promise<AddressResult> {
  const existing = await getAddress(owner, id);
  if (!existing) return { ok: false, error: "not_found" };
  await db.$transaction(async (tx) => {
    await tx.address.delete({ where: { id } });
    if (existing.isDefault) {
      // Promote the oldest remaining address of that type.
      const next = await tx.address.findFirst({
        where: { tenantId: owner.tenantId, customerId: owner.customerId, type: existing.type },
        orderBy: { createdAt: "asc" },
      });
      if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  });
  return { ok: true, id };
}

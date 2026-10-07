import "server-only";
import { z } from "zod";
import createMollieClient, { MollieApiError, PaymentMethod, type MollieClient } from "@mollie/api-client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { encrypt, decrypt } from "@/server/auth/encryption";
import { ServiceError, type ServiceContext } from "@/server/context";
import type { Prisma } from "@/generated/prisma/client";
import {
  PAYMENTS_SETTINGS_GROUP,
  isValidMollieKeyFormat,
  maskMollieKey,
  mollieModeFromKey,
  parseStoredPaymentsSettings,
  type MollieMode,
  type PaymentsSettings,
} from "./settings";

/*
 * Per-tenant Mollie configuration (decision 16: Mollie is the only live provider).
 * Storage: Setting row group "payments" — see ./settings.ts for why it is outside SETTINGS_SCHEMAS.
 */

type Tx = Prisma.TransactionClient;

const KNOWN_METHODS = new Set<string>(Object.values(PaymentMethod));

export function mollieClient(apiKey: string): MollieClient {
  return createMollieClient({ apiKey, versionStrings: "Quartermaster/1.0" });
}

async function readPaymentsSettings(tenantId: string, tx: Tx | typeof db = db): Promise<PaymentsSettings> {
  const row = await tx.setting.findUnique({ where: { tenantId_group: { tenantId, group: PAYMENTS_SETTINGS_GROUP } } });
  return parseStoredPaymentsSettings(row?.data);
}

/** Read-modify-write of the payments row under a row lock (concurrent saves don't clobber each other). */
async function updatePaymentsSettings(tenantId: string, fn: (current: PaymentsSettings) => PaymentsSettings): Promise<PaymentsSettings> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "settings" WHERE "tenantId" = ${tenantId} AND "group" = ${PAYMENTS_SETTINGS_GROUP} FOR UPDATE`;
    const next = fn(await readPaymentsSettings(tenantId, tx));
    const data = next as unknown as Prisma.InputJsonValue;
    await tx.setting.upsert({
      where: { tenantId_group: { tenantId, group: PAYMENTS_SETTINGS_GROUP } },
      create: { tenantId, group: PAYMENTS_SETTINGS_GROUP, data },
      update: { data },
    });
    return next;
  });
}

/** Maps a Mollie client error: 401/403 → INVALID (bad key), everything else → UNAVAILABLE. */
export function mapMollieError(err: unknown, what: string): ServiceError {
  if (err instanceof MollieApiError && (err.statusCode === 401 || err.statusCode === 403)) {
    return new ServiceError("INVALID", "Mollie rejected the API key");
  }
  const status = err instanceof MollieApiError ? err.statusCode : undefined;
  console.error(`[mollie] ${what} failed`, status ?? "", err instanceof Error ? err.message : err);
  return new ServiceError("UNAVAILABLE", "Mollie is not reachable right now, try again later");
}

/**
 * Server-internal: the decrypted API key + enabled methods for a tenant, or null when not configured.
 * Never return this to a client.
 */
export async function getMollieCredentials(tenantId: string): Promise<{ apiKey: string; mode: MollieMode; enabledMethods: string[] } | null> {
  const { mollie } = await readPaymentsSettings(tenantId);
  if (!mollie.apiKeyEncrypted) return null;
  let apiKey: string;
  try {
    apiKey = decrypt(mollie.apiKeyEncrypted);
  } catch (err) {
    console.error(`[mollie] ${tenantId}: stored API key cannot be decrypted (APP_ENCRYPTION_KEY changed?)`, err instanceof Error ? err.message : err);
    return null;
  }
  const mode = mollieModeFromKey(apiKey);
  return mode ? { apiKey, mode, enabledMethods: mollie.enabledMethods } : null;
}

export type MollieConfigStatus = {
  configured: boolean;
  mode: MollieMode | null;
  /** e.g. "live_••••••••wxyz"; null when not configured. */
  maskedKey: string | null;
  verifiedAt: string | null;
  /** [] = all methods enabled in the Mollie dashboard. */
  enabledMethods: string[];
};

export async function getMollieStatus(ctx: ServiceContext): Promise<MollieConfigStatus> {
  const { mollie } = await readPaymentsSettings(ctx.tenantId);
  const configured = mollie.apiKeyEncrypted !== null;
  return {
    configured,
    mode: configured ? mollie.mode : null,
    maskedKey: configured ? maskMollieKey(mollie.mode, mollie.keyHint) : null,
    verifiedAt: configured ? mollie.verifiedAt : null,
    enabledMethods: mollie.enabledMethods,
  };
}

/**
 * Validates the key format (test_/live_), verifies it against Mollie (`methods.list`), then stores it
 * encrypted. The key itself is never logged or audited.
 */
export async function saveMollieKey(ctx: ServiceContext, key: string): Promise<MollieConfigStatus> {
  const apiKey = typeof key === "string" ? key.trim() : "";
  if (!isValidMollieKeyFormat(apiKey)) {
    throw new ServiceError("INVALID", 'A Mollie API key starts with "test_" or "live_" followed by 30 letters/digits');
  }
  const mode = mollieModeFromKey(apiKey)!;
  try {
    await mollieClient(apiKey).methods.list();
  } catch (err) {
    throw mapMollieError(err, "verifying API key");
  }
  const encrypted = encrypt(apiKey);
  await updatePaymentsSettings(ctx.tenantId, (s) => ({
    ...s,
    mollie: { ...s.mollie, apiKeyEncrypted: encrypted, mode, keyHint: apiKey.slice(-4), verifiedAt: new Date().toISOString() },
  }));
  await audit({ action: "payments.mollie.key_saved", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Setting", entityId: PAYMENTS_SETTINGS_GROUP, data: { mode } });
  return getMollieStatus(ctx);
}

/** Removes the stored key (checkout can no longer start Mollie payments). Enabled methods are kept. */
export async function removeMollieKey(ctx: ServiceContext): Promise<MollieConfigStatus> {
  await updatePaymentsSettings(ctx.tenantId, (s) => ({ ...s, mollie: { ...s.mollie, apiKeyEncrypted: null, mode: null, keyHint: null, verifiedAt: null } }));
  await audit({ action: "payments.mollie.key_removed", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Setting", entityId: PAYMENTS_SETTINGS_GROUP });
  return getMollieStatus(ctx);
}

export type MollieMethodInfo = {
  id: string;
  description: string;
  imageUrl: string | null;
  minimumAmount: { value: string; currency: string } | null;
  maximumAmount: { value: string; currency: string } | null;
  /** Offered in our checkout (true for all when enabledMethods is empty). */
  enabled: boolean;
};

async function fetchActiveMethods(apiKey: string) {
  try {
    return await mollieClient(apiKey).methods.list();
  } catch (err) {
    throw mapMollieError(err, "listing methods");
  }
}

/** Methods activated on the tenant's Mollie account, flagged with whether our checkout offers them. */
export async function listMollieMethods(ctx: ServiceContext): Promise<MollieMethodInfo[]> {
  const creds = await getMollieCredentials(ctx.tenantId);
  if (!creds) throw new ServiceError("CONFLICT", "Mollie is not configured");
  const methods = await fetchActiveMethods(creds.apiKey);
  const enabled = new Set(creds.enabledMethods);
  return methods.map((m) => ({
    id: m.id,
    description: m.description,
    imageUrl: m.image?.svg ?? m.image?.size2x ?? null,
    minimumAmount: m.minimumAmount ?? null,
    maximumAmount: m.maximumAmount ?? null,
    enabled: enabled.size === 0 || enabled.has(m.id),
  }));
}

const methodsSchema = z.array(z.string().trim().toLowerCase().min(1).max(40)).max(50);

/**
 * Restricts which Mollie methods checkout offers. `[]` = all methods active in the Mollie dashboard.
 * Every id must be a known Mollie method that is active on the tenant's account.
 */
export async function setEnabledMethods(ctx: ServiceContext, methods: string[]): Promise<MollieConfigStatus> {
  const parsed = methodsSchema.safeParse(methods);
  if (!parsed.success) throw new ServiceError("INVALID", "Expected a list of Mollie method ids");
  const wanted = [...new Set(parsed.data)];
  const unknown = wanted.filter((m) => !KNOWN_METHODS.has(m));
  if (unknown.length) throw new ServiceError("INVALID", `Unknown Mollie method: ${unknown.join(", ")}`, { unknown });

  const creds = await getMollieCredentials(ctx.tenantId);
  if (!creds) throw new ServiceError("CONFLICT", "Mollie is not configured");
  if (wanted.length) {
    const active = new Set((await fetchActiveMethods(creds.apiKey)).map((m) => m.id as string));
    const inactive = wanted.filter((m) => !active.has(m));
    if (inactive.length) {
      throw new ServiceError("INVALID", `Not active on your Mollie account: ${inactive.join(", ")}`, { inactive });
    }
  }

  const before = creds.enabledMethods;
  await updatePaymentsSettings(ctx.tenantId, (s) => ({ ...s, mollie: { ...s.mollie, enabledMethods: wanted } }));
  if (JSON.stringify(before) !== JSON.stringify(wanted)) {
    await audit({
      action: "payments.mollie.methods_update",
      tenantId: ctx.tenantId,
      actorId: ctx.actor.id,
      entity: "Setting",
      entityId: PAYMENTS_SETTINGS_GROUP,
      data: { before, after: wanted },
    });
  }
  return getMollieStatus(ctx);
}

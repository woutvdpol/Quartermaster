import "server-only";
import { cache } from "react";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { AuthError, canAccessTenant } from "@/server/auth/guards";
import type { SessionUser } from "@/server/auth/session";
import type { Prisma } from "@/generated/prisma/client";
import {
  PLATFORM_ONLY_GROUPS,
  SETTINGS_SCHEMAS,
  changedKeys,
  mergeSettings,
  parseStoredSettings,
  type Settings,
  type SettingsGroup,
  type SettingsPatch,
} from "./schema";

export * from "./schema";

type Actor = Pick<SessionUser, "id" | "role" | "tenantId">;

/**
 * A tenant's settings for one group, with defaults filled in. Memoized per request.
 * No access check: settings are read by the storefront too. Callers must not expose
 * the `platform` group to customers.
 */
export const getSettings = cache(async <G extends SettingsGroup>(tenantId: string, group: G): Promise<Settings<G>> => {
  const row = await db.setting.findUnique({ where: { tenantId_group: { tenantId, group } } });
  const { value, invalidKeys } = parseStoredSettings(group, row?.data);
  if (invalidKeys.length) {
    console.warn(`[settings] ${tenantId}/${group}: invalid stored keys reset to default: ${invalidKeys.join(", ")}`);
  }
  return value;
});

export function canEditSettings(actor: Actor, tenantId: string, group: SettingsGroup): boolean {
  if (PLATFORM_ONLY_GROUPS.has(group)) return actor.role === "SUPERADMIN";
  return canAccessTenant(actor, tenantId);
}

/**
 * Apply a (deep-partial) patch to a group. Validates the merged result strictly, so an invalid
 * patch throws a ZodError and nothing is written. Returns the new settings.
 */
export async function updateSettings<G extends SettingsGroup>(
  tenantId: string,
  group: G,
  patch: SettingsPatch<G>,
  actor: Actor,
): Promise<Settings<G>> {
  if (!canEditSettings(actor, tenantId, group)) throw new AuthError("FORBIDDEN");

  const { next, changed } = await db.$transaction(async (tx) => {
    // Lock the row (if any) so concurrent patches don't overwrite each other.
    await tx.$queryRaw`SELECT 1 FROM "settings" WHERE "tenantId" = ${tenantId} AND "group" = ${group} FOR UPDATE`;
    const row = await tx.setting.findUnique({ where: { tenantId_group: { tenantId, group } } });
    const current = parseStoredSettings(group, row?.data).value;
    const next = SETTINGS_SCHEMAS[group].parse(mergeSettings(current, patch)) as Settings<G>;
    const changed = changedKeys(current, next);
    if (changed.length) {
      const data = next as Prisma.InputJsonValue;
      await tx.setting.upsert({
        where: { tenantId_group: { tenantId, group } },
        create: { tenantId, group, data },
        update: { data },
      });
    }
    return { next, changed };
  });

  if (changed.length) {
    await audit({
      action: "settings.update",
      tenantId,
      actorId: actor.id,
      entity: "Setting",
      entityId: group,
      data: { group, changed },
    });
  }
  return next;
}

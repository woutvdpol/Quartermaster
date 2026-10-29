import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError } from "@/server/context";
import { parseInput } from "@/server/catalog/errors";
import { extendedTrialEnd, TRIAL_DAYS_MAX } from "@/server/onboarding/trial-rules";
import { assertPlatformActor, type PlatformContext } from "./context";

/*
 * Superadmin control over a shop's free trial (docs/signup-modes.md): extend, end now, or convert to a
 * normal shop (no end date; the package is set with the plan form). Audited on the tenant as `trial.*`.
 * Reminder and "ended" mails are sent by the `trials.tick` cron (src/server/onboarding/trials.ts).
 */

const idSchema = z.string().min(1).max(64);
const daysSchema = z.coerce.number().int().min(1, "At least 1 day").max(TRIAL_DAYS_MAX, `At most ${TRIAL_DAYS_MAX} days`);

async function trialTenant(tenantId: string) {
  const id = parseInput(idSchema, tenantId);
  const tenant = await db.tenant.findUnique({ where: { id }, select: { id: true, trialEndsAt: true } });
  if (!tenant) throw new ServiceError("NOT_FOUND", "Tenant not found");
  if (!tenant.trialEndsAt) throw new ServiceError("INVALID", "This shop is not on a trial");
  return { id: tenant.id, trialEndsAt: tenant.trialEndsAt };
}

/** Adds `days` to the trial (from now if it already ended, which reopens the storefront). */
export async function extendTrial(ctx: PlatformContext, tenantId: string, days: number) {
  assertPlatformActor(ctx);
  const tenant = await trialTenant(tenantId);
  const add = parseInput(daysSchema, days);
  const trialEndsAt = extendedTrialEnd(tenant.trialEndsAt, add, new Date());
  // Reminders start over for the new end date.
  await db.tenant.update({ where: { id: tenant.id }, data: { trialEndsAt, trialNotices: 0 } });
  await audit({
    action: "trial.extended",
    tenantId: tenant.id,
    actorId: ctx.actor.id,
    entity: "Tenant",
    entityId: tenant.id,
    data: { from: tenant.trialEndsAt.toISOString(), to: trialEndsAt.toISOString(), days: add },
  });
  return trialEndsAt;
}

/** Ends the trial now: the storefront closes; the owner gets the "trial ended" mail from the cron. */
export async function endTrialNow(ctx: PlatformContext, tenantId: string) {
  assertPlatformActor(ctx);
  const tenant = await trialTenant(tenantId);
  const now = new Date();
  if (tenant.trialEndsAt <= now) throw new ServiceError("INVALID", "The trial has already ended");
  await db.tenant.update({ where: { id: tenant.id }, data: { trialEndsAt: now } });
  await audit({ action: "trial.ended", tenantId: tenant.id, actorId: ctx.actor.id, entity: "Tenant", entityId: tenant.id, data: { was: tenant.trialEndsAt.toISOString() } });
}

/** Makes the shop a normal (paying) shop: no end date, storefront open. The package stays as set. */
export async function convertTrial(ctx: PlatformContext, tenantId: string) {
  assertPlatformActor(ctx);
  const tenant = await trialTenant(tenantId);
  await db.tenant.update({ where: { id: tenant.id }, data: { trialEndsAt: null, trialNotices: 0 } });
  await audit({ action: "trial.converted", tenantId: tenant.id, actorId: ctx.actor.id, entity: "Tenant", entityId: tenant.id, data: { trialEndedAt: tenant.trialEndsAt.toISOString() } });
}

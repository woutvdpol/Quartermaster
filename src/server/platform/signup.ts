import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { parseInput } from "@/server/catalog/errors";
import { TRIAL_DAYS_MAX, TRIAL_DAYS_MIN } from "@/server/onboarding/trial-rules";
import type { SignupMode } from "@/generated/prisma/enums";
import { assertPlatformActor, type PlatformContext } from "./context";

/*
 * How dealers sign up on the platform host (docs/signup-modes.md): APPLY (reviewed by hand), WAITLIST
 * (invited later) or TRIAL (shop created on email verification, straight into the setup wizard).
 * Stored in the single PlatformConfig row; no row = APPLY with a 30-day trial length.
 */

export const SIGNUP_MODES = ["APPLY", "WAITLIST", "TRIAL"] as const satisfies readonly SignupMode[];

export type SignupConfig = { signupMode: SignupMode; trialDays: number };
export const DEFAULT_SIGNUP_CONFIG: SignupConfig = { signupMode: "APPLY", trialDays: 30 };

const configSchema = z.object({
  signupMode: z.enum(SIGNUP_MODES),
  trialDays: z.coerce.number().int().min(TRIAL_DAYS_MIN, `At least ${TRIAL_DAYS_MIN} day`).max(TRIAL_DAYS_MAX, `At most ${TRIAL_DAYS_MAX} days`),
});

/** Current sign-up mode and trial length (public: the /apply page reads it). */
export async function getSignupConfig(): Promise<SignupConfig> {
  const row = await db.platformConfig.findUnique({ where: { id: 1 }, select: { signupMode: true, trialDays: true } });
  return row ?? DEFAULT_SIGNUP_CONFIG;
}

/** SUPERADMIN: change the mode. Applications already submitted keep the mode they were sent in. */
export async function updateSignupConfig(ctx: PlatformContext, input: z.input<typeof configSchema>): Promise<SignupConfig> {
  assertPlatformActor(ctx);
  const data = parseInput(configSchema, input);
  const before = await getSignupConfig();
  const row = await db.platformConfig.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: data,
    select: { signupMode: true, trialDays: true },
  });
  await audit({ action: "platform.signup_config_updated", actorId: ctx.actor.id, entity: "PlatformConfig", entityId: "1", data: { before, after: row } });
  return row;
}

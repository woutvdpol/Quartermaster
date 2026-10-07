import "server-only";
import { cookies } from "next/headers";

/**
 * Age verification ("popup" mode, legal.ageVerification). The visitor's confirmation is stored in a
 * host-only cookie holding the age they confirmed, so raising `minimumAge` asks again.
 * The checkout agent's "checkout" mode stores the confirmation on the order instead.
 */
export const AGE_COOKIE = "qm_age_ok";
export const AGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export async function hasConfirmedAge(minimumAge: number): Promise<boolean> {
  const value = (await cookies()).get(AGE_COOKIE)?.value;
  const age = value ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(age) && age >= minimumAge;
}

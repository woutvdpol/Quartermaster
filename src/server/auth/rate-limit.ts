import "server-only";
import { db } from "@/server/db";

export type RateLimitRule = { limit: number; windowMs: number };

export const RULES = {
  loginPerIp: { limit: 20, windowMs: 15 * 60 * 1000 },
  loginPerAccount: { limit: 5, windowMs: 15 * 60 * 1000 },
  totpPerSession: { limit: 5, windowMs: 10 * 60 * 1000 },
  passwordResetPerEmail: { limit: 3, windowMs: 60 * 60 * 1000 },
} satisfies Record<string, RateLimitRule>;

/** Returns true when the key is over its limit. Does not record a hit. */
export async function isLimited(key: string, rule: RateLimitRule): Promise<boolean> {
  const since = new Date(Date.now() - rule.windowMs);
  const count = await db.rateLimitHit.count({ where: { key, createdAt: { gte: since } } });
  return count >= rule.limit;
}

export async function hit(key: string) {
  await db.rateLimitHit.create({ data: { key } });
}

export async function clear(key: string) {
  await db.rateLimitHit.deleteMany({ where: { key } });
}

/** Housekeeping, run from a cron job. */
export async function pruneRateLimitHits(olderThanMs = 24 * 60 * 60 * 1000) {
  await db.rateLimitHit.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - olderThanMs) } } });
}

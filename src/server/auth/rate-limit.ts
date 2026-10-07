import "server-only";
import { db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";

/*
 * Rate limiting on the `rate_limit_hits` table (one row per counted attempt).
 *
 * Atomicity: `take`, `consume` and `attempt` run "count, decide, insert" inside one transaction
 * that first takes a transaction-scoped Postgres advisory lock on the key
 * (pg_advisory_xact_lock(hashtextextended(key))). Concurrent requests for the same key are
 * serialized, so N parallel requests can never all pass a limit of N-1 (the old isLimited → hit
 * sequence could). Different keys don't block each other (barring 64-bit hash collisions, which
 * only cost a little waiting). The lock is released at commit.
 *
 * Two kinds of limits:
 * - Fixed window (`RateLimitRule`): at most `limit` hits per `windowMs`.
 * - Exponential backoff (`BackoffPolicy`) for credentials: the first `free` failures in the window
 *   cost nothing, after that each further attempt must wait baseMs · 2^(failures − free), capped at
 *   maxMs, since the previous attempt. There is no hard lock-out: the real owner of an account
 *   can always sign in after at most `maxMs`, while an attacker gets ≈ windowMs / maxMs guesses.
 *
 * `isLimited` / `hit` (non-atomic) remain for callers that only count failures after the fact;
 * they're advisory limits on low-value actions.
 */

export type RateLimitRule = { limit: number; windowMs: number };
export type BackoffPolicy = { free: number; baseMs: number; maxMs: number; windowMs: number };

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const RULES = {
  totpPerSession: { limit: 5, windowMs: 10 * MINUTE },
  totpPerUser: { limit: 15, windowMs: HOUR },
  passwordResetPerEmail: { limit: 3, windowMs: HOUR },
  passwordResetPerIp: { limit: 20, windowMs: HOUR },
} satisfies Record<string, RateLimitRule>;

export const BACKOFF = {
  /** Per account (also for unknown emails — same key shape, so no enumeration). */
  loginPerAccount: { free: 5, baseMs: 1000, maxMs: 5 * MINUTE, windowMs: HOUR },
  /** Per client IP across all accounts (credential stuffing). */
  loginPerIp: { free: 20, baseMs: 1000, maxMs: 15 * MINUTE, windowMs: HOUR },
  /** Re-entering the current password for sensitive changes (per user). */
  reauth: { free: 5, baseMs: 1000, maxMs: 5 * MINUTE, windowMs: HOUR },
} satisfies Record<string, BackoffPolicy>;

export type Decision = { allowed: true; hitId: bigint } | { allowed: false; retryAfterMs: number };

/** Runs `fn` in a transaction holding the advisory lock for `key`. */
async function withKeyLock<T>(key: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    return fn(tx);
  });
}

/** Delay before the next attempt is allowed after `failures` failures (0 while within `free`). */
export function backoffDelayMs(failures: number, policy: BackoffPolicy): number {
  if (failures < policy.free) return 0;
  const exp = Math.min(failures - policy.free, 30);
  return Math.min(policy.maxMs, policy.baseMs * 2 ** exp);
}

/** Fixed window, atomic: records a hit and returns `allowed`, or refuses without recording. */
export async function consume(key: string, rule: RateLimitRule): Promise<Decision> {
  return withKeyLock(key, async (tx) => {
    const now = Date.now();
    const since = new Date(now - rule.windowMs);
    const agg = await tx.rateLimitHit.aggregate({
      where: { key, createdAt: { gte: since } },
      _count: { _all: true },
      _min: { createdAt: true },
    });
    if (agg._count._all >= rule.limit) {
      const oldest = agg._min.createdAt?.getTime() ?? now;
      return { allowed: false, retryAfterMs: Math.max(1000, oldest + rule.windowMs - now) };
    }
    const row = await tx.rateLimitHit.create({ data: { key, createdAt: new Date(now) }, select: { id: true } });
    return { allowed: true, hitId: row.id };
  });
}

/** `consume` as a boolean: true = allowed (and counted). */
export async function take(key: string, rule: RateLimitRule): Promise<boolean> {
  return (await consume(key, rule)).allowed;
}

/**
 * Exponential backoff, atomic. An allowed attempt is recorded up front (counted as a failure until
 * the caller `clear`s the key on success or `release`s this one hit), so parallel guesses can't
 * slip through between "check" and "record".
 */
export async function attempt(key: string, policy: BackoffPolicy): Promise<Decision> {
  return withKeyLock(key, async (tx) => {
    const now = Date.now();
    const agg = await tx.rateLimitHit.aggregate({
      where: { key, createdAt: { gte: new Date(now - policy.windowMs) } },
      _count: { _all: true },
      _max: { createdAt: true },
    });
    const delay = backoffDelayMs(agg._count._all, policy);
    const last = agg._max.createdAt?.getTime();
    if (delay > 0 && last !== undefined && now - last < delay) {
      return { allowed: false, retryAfterMs: delay - (now - last) };
    }
    const row = await tx.rateLimitHit.create({ data: { key, createdAt: new Date(now) }, select: { id: true } });
    return { allowed: true, hitId: row.id };
  });
}

/** Un-counts one recorded hit (e.g. a successful login on a per-IP key). */
export async function release(decision: Decision | null | undefined) {
  if (decision?.allowed) await db.rateLimitHit.deleteMany({ where: { id: decision.hitId } });
}

/** Returns true when the key is over its limit. Does not record a hit. Not atomic with `hit`. */
export async function isLimited(key: string, rule: RateLimitRule): Promise<boolean> {
  const since = new Date(Date.now() - rule.windowMs);
  const count = await db.rateLimitHit.count({ where: { key, createdAt: { gte: since } } });
  return count >= rule.limit;
}

export async function hit(key: string) {
  await db.rateLimitHit.create({ data: { key, createdAt: new Date() } });
}

export async function clear(key: string) {
  await db.rateLimitHit.deleteMany({ where: { key } });
}

/** Housekeeping, run from a cron job. Must exceed every window above (longest: 1 h). */
export async function pruneRateLimitHits(olderThanMs = 24 * 60 * 60 * 1000) {
  await db.rateLimitHit.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - olderThanMs) } } });
}

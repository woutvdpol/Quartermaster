import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { attempt, consume, release, take } from "@/server/auth/rate-limit";
import { login } from "@/server/auth/service";
import { hashPassword } from "@/server/auth/password";
import { createTenantContext, resetDb } from "./helpers";

// Security backlog #6: the check and the insert must be atomic, also under concurrency.

beforeEach(resetDb);

describe("atomic rate limiting", () => {
  it("consume: 25 parallel requests against a limit of 5 → exactly 5 allowed", async () => {
    const rule = { limit: 5, windowMs: 60_000 };
    const results = await Promise.all(Array.from({ length: 25 }, () => consume("t:parallel", rule)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(await db.rateLimitHit.count({ where: { key: "t:parallel" } })).toBe(5);
    const denied = results.find((r) => !r.allowed);
    expect(denied && !denied.allowed && denied.retryAfterMs).toBeGreaterThan(0);
  });

  it("take: different keys don't interfere", async () => {
    const rule = { limit: 1, windowMs: 60_000 };
    const results = await Promise.all(["a", "b", "c", "a", "b", "c"].map((k) => take(`t:${k}`, rule)));
    expect(results.filter(Boolean)).toHaveLength(3);
  });

  it("attempt: parallel guesses get exactly the free budget, then must wait", async () => {
    const policy = { free: 3, baseMs: 60_000, maxMs: 600_000, windowMs: 3_600_000 };
    const results = await Promise.all(Array.from({ length: 12 }, () => attempt("t:backoff", policy)));
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
    const waits = results.flatMap((r) => (r.allowed ? [] : [r.retryAfterMs]));
    expect(Math.min(...waits)).toBeGreaterThan(50_000);
  });

  it("attempt: the delay is measured from the last attempt and doubles", async () => {
    const policy = { free: 1, baseMs: 1000, maxMs: 60_000, windowMs: 3_600_000 };
    const now = Date.now();
    await db.rateLimitHit.createMany({ data: [{ key: "t:dbl", createdAt: new Date(now - 10_000) }, { key: "t:dbl", createdAt: new Date(now - 1500) }] });
    // 2 failures → 2 s since the last one (1.5 s ago) → wait ≈ 0.5 s
    const d = await attempt("t:dbl", policy);
    expect(d.allowed).toBe(false);
    expect(!d.allowed && d.retryAfterMs).toBeGreaterThan(0);
    expect(!d.allowed && d.retryAfterMs).toBeLessThanOrEqual(500);
  });

  it("release removes exactly one recorded hit", async () => {
    const rule = { limit: 2, windowMs: 60_000 };
    const first = await consume("t:rel", rule);
    await consume("t:rel", rule);
    await release(first);
    expect(await db.rateLimitHit.count({ where: { key: "t:rel" } })).toBe(1);
  });

  it("login: 10 parallel wrong passwords for one account → only the 5 free attempts are checked", async () => {
    const ctx = await createTenantContext();
    await db.user.update({ where: { id: ctx.actor.id }, data: { passwordHash: await hashPassword("correct horse battery") } });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => login({ email: ctx.actor.email, password: `wrong-${i}`, tenantId: ctx.tenantId, ip: `198.51.100.${i}` })),
    );
    expect(results.filter((r) => !r.ok && r.error === "invalid_credentials")).toHaveLength(5);
    expect(results.filter((r) => !r.ok && r.error === "rate_limited")).toHaveLength(5);
  });
});

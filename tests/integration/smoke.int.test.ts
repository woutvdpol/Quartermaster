import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { nextSequenceValue } from "@/server/sequence";
import { createTenantContext, resetDb } from "./helpers";

describe("integration setup", () => {
  beforeEach(resetDb);

  it("issues per-tenant sequence numbers without sharing between tenants", async () => {
    const a = await createTenantContext();
    const b = await createTenantContext();
    const issue = (tenantId: string) => db.$transaction((tx) => nextSequenceValue(tx, tenantId, "product.stockCode"));
    expect(await issue(a.tenantId)).toBe(50000);
    expect(await issue(a.tenantId)).toBe(50001);
    expect(await issue(b.tenantId)).toBe(50000);
  });

  it("issues unique numbers under concurrency", async () => {
    const a = await createTenantContext();
    const values = await Promise.all(
      Array.from({ length: 10 }, () => db.$transaction((tx) => nextSequenceValue(tx, a.tenantId, "order.number"))),
    );
    expect(new Set(values).size).toBe(10);
  });
});

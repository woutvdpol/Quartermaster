import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ db: {} }));
const { scopeArgs, TENANT_SCOPED_MODELS, TenantScopeError } = await import("./tenant-scope");

describe("TENANT_SCOPED_MODELS", () => {
  it("lists exactly the models with a required tenantId in prisma/schema.prisma", () => {
    const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
    const required = new Set<string>();
    let model: string | null = null;
    for (const line of schema.split("\n")) {
      const m = /^model (\w+)/.exec(line);
      if (m) model = m[1];
      if (model && /^\s+tenantId\s+String(\s|$)/.test(line)) required.add(model);
    }
    expect([...TENANT_SCOPED_MODELS].sort()).toEqual([...required].sort());
  });
});

describe("scopeArgs", () => {
  const T = "tenant-a";

  it("forces tenantId into every where (also unique lookups by id)", () => {
    expect(scopeArgs("Product", "findUnique", { where: { id: "p1" } }, T)).toEqual({ where: { id: "p1", tenantId: T } });
    expect(scopeArgs("Product", "findMany", {}, T)).toEqual({ where: { tenantId: T } });
    expect(scopeArgs("Order", "update", { where: { id: "o1" }, data: { note: "x" } }, T)).toEqual({ where: { id: "o1", tenantId: T }, data: { note: "x" } });
    expect(scopeArgs("Order", "deleteMany", undefined, T)).toEqual({ where: { tenantId: T } });
    expect(scopeArgs("Customer", "count", { where: { AND: [{ email: "x" }] } }, T)).toEqual({ where: { AND: [{ email: "x" }], tenantId: T } });
  });

  it("keeps a matching tenantId and refuses another tenant or a non-literal filter", () => {
    expect(scopeArgs("Product", "findFirst", { where: { tenantId: T } }, T)).toEqual({ where: { tenantId: T } });
    expect(() => scopeArgs("Product", "findFirst", { where: { tenantId: "tenant-b" } }, T)).toThrow(TenantScopeError);
    expect(() => scopeArgs("Product", "findMany", { where: { tenantId: { in: [T, "tenant-b"] } } }, T)).toThrow(TenantScopeError);
  });

  it("fills and checks tenantId on creates", () => {
    expect(scopeArgs("ContentPage", "create", { data: { slug: "x" } }, T)).toEqual({ data: { slug: "x", tenantId: T } });
    expect(scopeArgs("Redirect", "createMany", { data: [{ fromPath: "/a" }, { fromPath: "/b", tenantId: T }] }, T)).toEqual({
      data: [{ fromPath: "/a", tenantId: T }, { fromPath: "/b", tenantId: T }],
    });
    expect(() => scopeArgs("ContentPage", "create", { data: { slug: "x", tenantId: "tenant-b" } }, T)).toThrow(TenantScopeError);
    expect(() => scopeArgs("ContentPage", "create", { data: { slug: "x", tenant: { connect: { id: "tenant-b" } } } }, T)).toThrow(TenantScopeError);
  });

  it("refuses to move rows to another tenant", () => {
    expect(() => scopeArgs("Product", "update", { where: { id: "p" }, data: { tenantId: "tenant-b" } }, T)).toThrow(TenantScopeError);
    expect(() => scopeArgs("Product", "updateMany", { where: {}, data: { tenantId: "tenant-b" } }, T)).toThrow(TenantScopeError);
    expect(() =>
      scopeArgs("Customer", "upsert", { where: { id: "c" }, create: { email: "x" }, update: { tenantId: "tenant-b" } }, T),
    ).toThrow(TenantScopeError);
    expect(scopeArgs("Customer", "upsert", { where: { id: "c" }, create: { email: "x" }, update: {} }, T)).toEqual({
      where: { id: "c", tenantId: T },
      create: { email: "x", tenantId: T },
      update: {},
    });
  });

  it("leaves platform models (User, Tenant, AuditLog, RateLimitHit) alone", () => {
    const args = { where: { id: "u1" } };
    expect(scopeArgs("User", "findUnique", args, T)).toBe(args);
    expect(scopeArgs("Tenant", "findMany", undefined, T)).toBeUndefined();
    expect(scopeArgs("AuditLog", "create", { data: {} }, T)).toEqual({ data: {} });
  });
});

import { describe, expect, it, vi } from "vitest";

// guards.ts pulls in the session/db layer; only the pure function is under test here.
vi.mock("./session", () => ({ getSession: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { canAccessTenant } = await import("./guards");

describe("canAccessTenant", () => {
  it("lets a SUPERADMIN access any tenant", () => {
    expect(canAccessTenant({ role: "SUPERADMIN", tenantId: null }, "t1")).toBe(true);
    expect(canAccessTenant({ role: "SUPERADMIN", tenantId: null }, "t2")).toBe(true);
  });

  it("lets an OWNER access only their own tenant", () => {
    expect(canAccessTenant({ role: "OWNER", tenantId: "t1" }, "t1")).toBe(true);
    expect(canAccessTenant({ role: "OWNER", tenantId: "t1" }, "t2")).toBe(false);
  });

  it("never lets a CUSTOMER access tenant admin, not even their own tenant", () => {
    expect(canAccessTenant({ role: "CUSTOMER", tenantId: "t1" }, "t1")).toBe(false);
    expect(canAccessTenant({ role: "CUSTOMER", tenantId: "t1" }, "t2")).toBe(false);
  });

  it("denies an OWNER without a tenant", () => {
    expect(canAccessTenant({ role: "OWNER", tenantId: null }, "t1")).toBe(false);
    expect(canAccessTenant({ role: "OWNER", tenantId: null }, "")).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("@/generated/prisma/client", () => ({ PrismaClient: class {} }));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: class {} }));

describe("poolMaxFromEnv", () => {
  it("parses DATABASE_POOL_MAX and ignores invalid values", async () => {
    process.env.DATABASE_URL ??= "postgresql://x@localhost/x";
    const { poolMaxFromEnv } = await import("./db");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(poolMaxFromEnv(undefined)).toBeUndefined();
    expect(poolMaxFromEnv(" ")).toBeUndefined();
    expect(poolMaxFromEnv("20")).toBe(20);
    expect(poolMaxFromEnv("0")).toBeUndefined();
    expect(poolMaxFromEnv("2.5")).toBeUndefined();
    expect(poolMaxFromEnv("lots")).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });
});

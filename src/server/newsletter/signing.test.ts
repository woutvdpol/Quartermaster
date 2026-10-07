import { beforeAll, describe, expect, it } from "vitest";
import { signUnsubscribe, unsubscribeQuery, verifyUnsubscribe } from "./signing";

beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
});

describe("unsubscribe HMAC", () => {
  it("signs deterministically and verifies", () => {
    const sig = signUnsubscribe("tenant-a", "sub-1");
    expect(sig).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(signUnsubscribe("tenant-a", "sub-1")).toBe(sig);
    expect(verifyUnsubscribe("tenant-a", "sub-1", sig)).toBe(true);
  });

  it("binds the signature to tenant and subscriber", () => {
    const sig = signUnsubscribe("tenant-a", "sub-1");
    expect(verifyUnsubscribe("tenant-b", "sub-1", sig)).toBe(false);
    expect(verifyUnsubscribe("tenant-a", "sub-2", sig)).toBe(false);
    // No ambiguity from concatenation.
    expect(verifyUnsubscribe("tenant-as", "ub-1", sig)).toBe(false);
  });

  it("rejects tampered, truncated and empty signatures", () => {
    const sig = signUnsubscribe("tenant-a", "sub-1");
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(verifyUnsubscribe("tenant-a", "sub-1", flipped)).toBe(false);
    expect(verifyUnsubscribe("tenant-a", "sub-1", sig.slice(0, 10))).toBe(false);
    expect(verifyUnsubscribe("tenant-a", "sub-1", "")).toBe(false);
    expect(verifyUnsubscribe("", "", sig)).toBe(false);
    expect(verifyUnsubscribe("tenant-a", "sub-1", "x".repeat(500))).toBe(false);
  });

  it("changes with the key", () => {
    const sig = signUnsubscribe("tenant-a", "sub-1");
    const prev = process.env.APP_ENCRYPTION_KEY;
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    try {
      expect(verifyUnsubscribe("tenant-a", "sub-1", sig)).toBe(false);
    } finally {
      process.env.APP_ENCRYPTION_KEY = prev;
    }
  });

  it("builds the query", () => {
    expect(unsubscribeQuery("t1", "s1")).toEqual({ t: "t1", s: "s1", sig: signUnsubscribe("t1", "s1") });
  });
});

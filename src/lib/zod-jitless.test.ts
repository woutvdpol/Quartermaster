import { describe, expect, it } from "vitest";
import { z } from "zod";
import { enableZodJitless } from "./zod-jitless";

describe("enableZodJitless", () => {
  it("sets zod's global jitless option without importing zod", () => {
    const before = z.config().jitless;
    try {
      enableZodJitless();
      expect(z.config().jitless).toBe(true);
      // Parsing still works with JIT off.
      expect(z.object({ a: z.string() }).parse({ a: "x" })).toEqual({ a: "x" });
    } finally {
      z.config({ jitless: before });
    }
  });
});

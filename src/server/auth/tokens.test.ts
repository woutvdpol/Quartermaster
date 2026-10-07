import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateRecoveryCode, generateToken, hashToken, normalizeRecoveryCode } from "./tokens";

describe("generateToken", () => {
  it("returns url-safe tokens of 32 bytes by default", () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(t, "base64url")).toHaveLength(32);
  });

  it("is unique across calls and honours the byte length", () => {
    const set = new Set(Array.from({ length: 1000 }, () => generateToken()));
    expect(set.size).toBe(1000);
    expect(Buffer.from(generateToken(16), "base64url")).toHaveLength(16);
  });
});

describe("hashToken", () => {
  it("is sha256 hex and deterministic", () => {
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashToken("abc")).toBe(createHash("sha256").update("abc").digest("hex"));
    expect(hashToken("abd")).not.toBe(hashToken("abc"));
  });
});

describe("recovery codes", () => {
  it("are xxxxx-xxxxx from the look-alike-free alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRecoveryCode();
      expect(code).toMatch(/^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/);
    }
  });

  it("are unique in practice", () => {
    const set = new Set(Array.from({ length: 1000 }, generateRecoveryCode));
    expect(set.size).toBe(1000);
  });

  it("normalize user input to the stored form", () => {
    const code = generateRecoveryCode();
    expect(normalizeRecoveryCode(code)).toBe(code);
    expect(normalizeRecoveryCode(code.toUpperCase())).toBe(code);
    expect(normalizeRecoveryCode(` ${code.replace("-", "")} `)).toBe(code);
    expect(normalizeRecoveryCode("ABCDE FGHJK")).toBe("abcde-fghjk");
    expect(normalizeRecoveryCode("abcde—fghjk")).toBe("abcde-fghjk");
  });

  it("leaves wrong-length input unformatted so it cannot match", () => {
    expect(normalizeRecoveryCode("abc")).toBe("abc");
    expect(normalizeRecoveryCode("abcde-fghjk-x")).toBe("abcdefghjkx");
  });
});

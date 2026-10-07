import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  generateRecoveryCode,
  generateToken,
  hashRecoveryCode,
  hashToken,
  normalizeRecoveryCode,
  randomSymbols,
  RECOVERY_CODE_LENGTH,
  recoveryCodeLookupHashes,
} from "./tokens";

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
  process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 3).toString("base64");

  it("are xxxxxx-xxxxxx-xxxxxx from the look-alike-free alphabet (≥ 80 bits)", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateRecoveryCode()).toMatch(/^[a-hjkmnp-z2-9]{6}-[a-hjkmnp-z2-9]{6}-[a-hjkmnp-z2-9]{6}$/);
    }
    expect(RECOVERY_CODE_LENGTH * Math.log2(31)).toBeGreaterThanOrEqual(80);
  });

  it("are unique in practice", () => {
    const set = new Set(Array.from({ length: 1000 }, generateRecoveryCode));
    expect(set.size).toBe(1000);
  });

  it("rejection sampling: bytes ≥ 248 are skipped, so no symbol is favoured", () => {
    // 247 → last symbol (247 % 31 = 30); 248..255 must be discarded, not wrapped onto symbols 0..7.
    const feed = [255, 248, 250, 0, 247, 30, 31];
    let i = 0;
    const fake = (n: number) => Uint8Array.from({ length: n }, () => feed[i++ % feed.length]);
    expect(randomSymbols(4, "abcdefghjkmnpqrstuvwxyz23456789", fake)).toBe("a99a");
  });

  it("are uniformly distributed (chi-square sanity check)", () => {
    const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    const counts = new Map<string, number>();
    const sample = randomSymbols(31 * 2000, alphabet);
    for (const c of sample) counts.set(c, (counts.get(c) ?? 0) + 1);
    const expected = 2000;
    const chi = [...alphabet].reduce((sum, c) => sum + ((counts.get(c) ?? 0) - expected) ** 2 / expected, 0);
    expect(chi).toBeLessThan(70); // df = 30; p ≈ 1e-4
  });

  it("normalize user input to the stored form", () => {
    const code = generateRecoveryCode();
    expect(normalizeRecoveryCode(code)).toBe(code);
    expect(normalizeRecoveryCode(code.toUpperCase())).toBe(code);
    expect(normalizeRecoveryCode(` ${code.replaceAll("-", " ")} `)).toBe(code);
    expect(normalizeRecoveryCode("ABCDE FGHJK")).toBe("abcde-fghjk"); // legacy length
    expect(normalizeRecoveryCode("abcde—fghjk")).toBe("abcde-fghjk");
  });

  it("are stored as an HMAC with the server secret, independent of formatting", () => {
    const code = generateRecoveryCode();
    const h = hashRecoveryCode(code);
    expect(h).toMatch(/^h1:[0-9a-f]{64}$/);
    expect(hashRecoveryCode(code.toUpperCase().replaceAll("-", ""))).toBe(h);
    expect(h).not.toContain(createHash("sha256").update(code).digest("hex"));
    expect(recoveryCodeLookupHashes(code)).toEqual([h]);
  });

  it("look up legacy 10-char codes by their old SHA-256 form", () => {
    expect(recoveryCodeLookupHashes("ABCDE FGHJK")).toEqual([hashToken("abcde-fghjk")]);
    expect(recoveryCodeLookupHashes("abc")).toEqual([]);
    expect(recoveryCodeLookupHashes("abcde-fghjk-x")).toEqual([]);
  });
});

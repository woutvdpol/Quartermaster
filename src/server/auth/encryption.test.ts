import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decrypt, encrypt } from "./encryption";

const KEY = randomBytes(32).toString("base64");

describe("encryption (AES-256-GCM)", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.APP_ENCRYPTION_KEY;
    process.env.APP_ENCRYPTION_KEY = KEY;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = saved;
  });

  it("round-trips plaintext, including unicode and empty strings", () => {
    for (const s of ["JBSWY3DPEHPK3PXP", "héllo ✓", ""]) expect(decrypt(encrypt(s))).toBe(s);
  });

  it("uses a fresh IV so equal plaintexts give different ciphertexts", () => {
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
    expect(a.split(".")).toHaveLength(4);
    expect(a.startsWith("v1.")).toBe(true);
    expect(Buffer.from(a.split(".")[1], "base64url")).toHaveLength(12);
  });

  it("rejects tampered ciphertext, tag or iv", () => {
    const [v, iv, tag, data] = encrypt("secret value").split(".");
    const flip = (s: string) => {
      const b = Buffer.from(s, "base64url");
      b[0] ^= 1;
      return b.toString("base64url");
    };
    expect(() => decrypt([v, iv, tag, flip(data)].join("."))).toThrow();
    expect(() => decrypt([v, iv, flip(tag), data].join("."))).toThrow();
    expect(() => decrypt([v, flip(iv), tag, data].join("."))).toThrow();
  });

  it("rejects a truncated auth tag", () => {
    const [v, iv, tag, data] = encrypt("secret value").split(".");
    const short = Buffer.from(tag, "base64url").subarray(0, 4).toString("base64url");
    expect(() => decrypt([v, iv, short, data].join("."))).toThrow();
  });

  it("rejects unknown versions and malformed payloads", () => {
    const [, iv, tag, data] = encrypt("x").split(".");
    expect(() => decrypt(["v2", iv, tag, data].join("."))).toThrow("Unsupported ciphertext");
    expect(() => decrypt("garbage")).toThrow("Unsupported ciphertext");
  });

  it("fails to decrypt with a different key", () => {
    const payload = encrypt("secret");
    process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    expect(() => decrypt(payload)).toThrow();
  });

  it("requires a 32-byte key", () => {
    delete process.env.APP_ENCRYPTION_KEY;
    expect(() => encrypt("x")).toThrow("APP_ENCRYPTION_KEY is not set");
    process.env.APP_ENCRYPTION_KEY = randomBytes(16).toString("base64");
    expect(() => encrypt("x")).toThrow("32 bytes");
  });
});

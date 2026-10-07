import { describe, expect, it } from "vitest";
import { getDummyHash, hashPassword, MAX_PASSWORD_LENGTH, needsRehash, verifyPassword } from "./password";

describe("password hashing", () => {
  it("produces the documented storage format with a random salt", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(a).not.toBe(b);
    expect(Buffer.from(a.split("$")[5], "base64")).toHaveLength(64);
    expect(Buffer.from(a.split("$")[4], "base64")).toHaveLength(16);
  });

  it("verifies the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse batterY", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("normalizes unicode (NFKC) so equivalent inputs match", async () => {
    const stored = await hashPassword("café-password");
    expect(await verifyPassword("café-password", stored)).toBe(true);
  });

  it("rejects passwords over the maximum length", async () => {
    const long = "a".repeat(MAX_PASSWORD_LENGTH + 1);
    await expect(hashPassword(long)).rejects.toThrow();
    const stored = await hashPassword("a".repeat(MAX_PASSWORD_LENGTH));
    expect(await verifyPassword("a".repeat(MAX_PASSWORD_LENGTH), stored)).toBe(true);
    expect(await verifyPassword(long, stored)).toBe(false);
  });

  it("returns false for malformed or foreign hashes", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "$2y$10$abcdefghijklmnopqrstuuOq6g6Jc0R7bZ9ljH2j5c4uM5w1G1r9a")).toBe(false);
    expect(await verifyPassword("x", "scrypt$16384$8$1$c2FsdA==")).toBe(false);
  });

  it("verifies hashes created with older (weaker) parameters", async () => {
    // Hash with N=2^14 by rewriting a stored hash is not possible; build one via node:crypto directly.
    const { scryptSync, randomBytes } = await import("node:crypto");
    const salt = randomBytes(16);
    const key = scryptSync("old password!", salt, 64, { N: 2 ** 14, r: 8, p: 1 });
    const stored = ["scrypt", 2 ** 14, 8, 1, salt.toString("base64"), key.toString("base64")].join("$");
    expect(await verifyPassword("old password!", stored)).toBe(true);
    expect(needsRehash(stored)).toBe(true);
  });

  it("needsRehash is false for current defaults and true for foreign schemes", async () => {
    expect(needsRehash(await hashPassword("whatever123"))).toBe(false);
    expect(needsRehash("$2y$10$abc")).toBe(true);
    expect(needsRehash("scrypt$32768$4$1$a$b")).toBe(true);
  });

  it("getDummyHash returns one stable, valid hash", async () => {
    const a = await getDummyHash();
    expect(await getDummyHash()).toBe(a);
    expect(needsRehash(a)).toBe(false);
    expect(await verifyPassword("anything", a)).toBe(false);
  });
});

describe("legacy bcrypt dispatch", () => {
  // Laravel UserFactory hash of "password" (see legacy-bcrypt.test.ts for sources), as stored by the ETL.
  const LEGACY = "bcrypt$$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi";

  it("verifies bcrypt$ hashes without NFKC normalization", async () => {
    expect(await verifyPassword("password", LEGACY)).toBe(true);
    expect(await verifyPassword("passwor", LEGACY)).toBe(false);
    expect(await verifyPassword("password", "bcrypt$garbage")).toBe(false);
  });

  it("always needs a rehash", () => {
    expect(needsRehash(LEGACY)).toBe(true);
  });
});

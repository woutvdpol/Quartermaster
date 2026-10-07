import { describe, expect, it } from "vitest";
import {
  bcryptWithSetting,
  parseBcrypt,
  piHexWords,
  verifyBcrypt,
  verifyLegacyBcrypt,
} from "./legacy-bcrypt";

const bytes = (...b: number[]) => Uint8Array.from(b);

/*
 * Test vectors. Nothing here is invented:
 *
 * [OW]  OpenWall crypt_blowfish 1.3, wrapper.c `tests[]` (https://www.openwall.com/crypt/) — the
 *       implementation PHP uses. 8-bit vectors are given as byte arrays.
 * [PHP] Generated with PHP 8.4.16 `crypt($password, $setting)` (same algorithm as password_hash()
 *       with a fixed salt), e.g. php -r 'echo crypt("hunter2-legacy", "$2y$10$abcdefghijklmnopqrstuu");'
 * [LV]  Laravel's UserFactory default hash of "password" (laravel/laravel database/factories/UserFactory.php,
 *       Laravel 8–10; also in Concept500's own database/factories/UserFactory.php), cost 10.
 * Every value below was also cross-checked with PHP 8.4.16 crypt() while writing this test.
 */
const VECTORS: { hash: string; password: string | Uint8Array; source: string }[] = [
  { source: "OW", hash: "$2a$05$CCCCCCCCCCCCCCCCCCCCC.E5YPO9kmyuRGyh0XouQYb4YMJKvyOeW", password: "U*U" },
  { source: "OW", hash: "$2a$05$CCCCCCCCCCCCCCCCCCCCC.VGOzA784oUp/Z0DY336zx7pLYAy0lwK", password: "U*U*" },
  { source: "OW", hash: "$2a$05$XXXXXXXXXXXXXXXXXXXXXOAcXxm9kjPGEMsLznoKqmqw7tc8WCx4a", password: "U*U*U" },
  {
    source: "OW",
    hash: "$2a$05$abcdefghijklmnopqrstuu5s2v8.iXieOjg/.AySBTTZIIVFJeBui",
    password: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789chars after 72 are ignored",
  },
  { source: "OW", hash: "$2a$05$CCCCCCCCCCCCCCCCCCCCC.7uG0VCzI2bS7j6ymqJi9CdcdxiRTWNy", password: "" },
  { source: "OW", hash: "$2y$05$/OK.fbVrR/bpIqNJ5ianF.Sa7shbm4.OzKpvFnX1pQLmQW96oUlCq", password: bytes(0xa3) },
  { source: "OW", hash: "$2a$05$/OK.fbVrR/bpIqNJ5ianF.Sa7shbm4.OzKpvFnX1pQLmQW96oUlCq", password: bytes(0xa3) },
  { source: "OW", hash: "$2b$05$/OK.fbVrR/bpIqNJ5ianF.Sa7shbm4.OzKpvFnX1pQLmQW96oUlCq", password: bytes(0xa3) },
  { source: "PHP", hash: "$2y$05$/OK.fbVrR/bpIqNJ5ianF.nRht2l/HRhr6zmCp9vYUvvsqynflf9e", password: bytes(0xff, 0xa3, 0x33, 0x34, 0x35) },
  { source: "PHP", hash: "$2a$05$/OK.fbVrR/bpIqNJ5ianF.nRht2l/HRhr6zmCp9vYUvvsqynflf9e", password: bytes(0xff, 0xa3, 0x33, 0x34, 0x35) },
  // $2a$ safety countermeasure: "\xff\xff\xff" sign-extends identically, so 2a must differ from 2y.
  { source: "PHP", hash: "$2a$05$/OK.fbVrR/bpIqNJ5ianF.fz0PAsxs8/N1WDMGjhe9pSv1M3EaHle", password: bytes(0xff, 0xff, 0xff) },
  { source: "PHP", hash: "$2y$05$/OK.fbVrR/bpIqNJ5ianF.J/g/3vmHprg.qPkSbeCv3LYtSJZhaqi", password: bytes(0xff, 0xff, 0xff) },
  { source: "PHP", hash: "$2y$04$abcdefghijklmnopqrstuuYQzyYpuBlD9anKNO5exwCD0BATGyB9S", password: "hunter2-legacy" },
  { source: "PHP", hash: "$2y$10$abcdefghijklmnopqrstuuxro5W.chJB.wdd./xlOoXTl9ZHK4SmS", password: "hunter2-legacy" },
  { source: "PHP", hash: "$2a$04$......................GkM1WBAyKgzhLym8hdw2sTH2LcJOrNq", password: "hunter2-legacy" },
  { source: "PHP", hash: "$2y$05$/OK.fbVrR/bpIqNJ5ianF.EnxzkU/Oqc8217wpie2MwqZfKN4LtWm", password: "äöü € unicode" },
  { source: "LV", hash: "$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi", password: "password" },
];

describe("Blowfish initial state (π)", () => {
  it("starts and ends with the published P-array / S-box words", () => {
    const w = piHexWords();
    expect(w).toHaveLength(18 + 1024);
    // Schneier, Blowfish reference: P1 = 0x243F6A88, P18 = 0x8979FB1B, S1[0] = 0xD1310BA6, S4[255] = 0x3AC372E6.
    expect(w[0]).toBe(0x243f6a88);
    expect(w[1]).toBe(0x85a308d3);
    expect(w[17]).toBe(0x8979fb1b);
    expect(w[18]).toBe(0xd1310ba6);
    expect(w[18 + 1023]).toBe(0x3ac372e6);
  });
});

describe("verifyBcrypt — published vectors", () => {
  for (const v of VECTORS) {
    const label = typeof v.password === "string" ? JSON.stringify(v.password.slice(0, 20)) : `bytes(${[...v.password].map((b) => b.toString(16)).join(" ")})`;
    it(`[${v.source}] ${v.hash.slice(0, 7)} ${label}`, async () => {
      expect(await verifyBcrypt(v.password, v.hash)).toBe(true);
      // Re-deriving from the setting reproduces the exact string.
      expect(await bcryptWithSetting(v.password, v.hash.slice(0, 29))).toBe(v.hash);
    });
  }

  it("rejects wrong passwords", async () => {
    expect(await verifyBcrypt("U*U*", "$2a$05$CCCCCCCCCCCCCCCCCCCCC.E5YPO9kmyuRGyh0XouQYb4YMJKvyOeW")).toBe(false);
    expect(await verifyBcrypt("Password", "$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi")).toBe(false);
    expect(await verifyBcrypt("password ", "$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi")).toBe(false);
  });

  it("$2a$ and $2y$ differ exactly where the crypt_blowfish countermeasure applies", async () => {
    const twoA = "$2a$05$/OK.fbVrR/bpIqNJ5ianF.fz0PAsxs8/N1WDMGjhe9pSv1M3EaHle";
    expect(await verifyBcrypt(bytes(0xff, 0xff, 0xff), twoA.replace("$2a$", "$2y$"))).toBe(false);
  });

  it("truncates passwords to 72 bytes", async () => {
    // [PHP] crypt(str_repeat("a", 72) . "EXTRA", '$2y$05$/OK.fbVrR/bpIqNJ5ianF.') == crypt(str_repeat("a", 72), …)
    const h = "$2y$05$/OK.fbVrR/bpIqNJ5ianF.Tyda.o6kz4y.pokQa990nfo3hdXc8Ai";
    expect(await verifyBcrypt("a".repeat(72), h)).toBe(true);
    expect(await verifyBcrypt("a".repeat(72) + "EXTRA", h)).toBe(true);
    expect(await verifyBcrypt("a".repeat(71), h)).toBe(false);
  });
});

describe("parseBcrypt / malformed input", () => {
  const good = "$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi";

  it("parses the parts", () => {
    expect(parseBcrypt(good)).toEqual({ variant: "y", cost: 10, salt: "92IXUNpkjO0rOQ5byMi.Ye", digest: "4oKoEa3Ro9llC/.og/at2.uheWG/igi" });
  });

  it.each([
    ["empty", ""],
    ["too short", good.slice(0, -1)],
    ["too long", good + "a"],
    ["$2x$ (buggy variant)", good.replace("$2y$", "$2x$")],
    ["$2$ (original)", "$2$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi"],
    ["cost 03", good.replace("$10$", "$03$")],
    ["cost 16", good.replace("$10$", "$16$")],
    ["cost 31", good.replace("$10$", "$31$")],
    ["one-digit cost", good.replace("$10$", "$9$")],
    ["bad alphabet", good.replace("92IX", "92+X")],
    ["base64 padding", good.slice(0, -1) + "="],
  ])("rejects %s", async (_, hash) => {
    expect(parseBcrypt(hash)).toBeNull();
    expect(await verifyBcrypt("password", hash)).toBe(false);
  });

  it("accepts the cost bounds 4 and 15", () => {
    expect(parseBcrypt(good.replace("$10$", "$04$"))?.cost).toBe(4);
    expect(parseBcrypt(good.replace("$10$", "$15$"))?.cost).toBe(15);
  });

  it("rejects passwords with NUL bytes (PHP never hashed those as JS sees them)", async () => {
    expect(await verifyBcrypt("password\u0000x", good)).toBe(false);
  });
});

describe("verifyLegacyBcrypt (storage form from the ETL)", () => {
  it("requires the bcrypt$ prefix", async () => {
    const raw = "$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi";
    expect(await verifyLegacyBcrypt("password", `bcrypt$${raw}`)).toBe(true);
    expect(await verifyLegacyBcrypt("password", raw)).toBe(false);
    expect(await verifyLegacyBcrypt("password", `scrypt$${raw}`)).toBe(false);
  });
});

describe("timing", () => {
  it("cost 10 verifies in reasonable time and does not block the event loop for its duration", async () => {
    const hash = "$2y$10$abcdefghijklmnopqrstuuxro5W.chJB.wdd./xlOoXTl9ZHK4SmS";
    await verifyBcrypt("warm-up", hash); // π tables
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    const started = performance.now();
    expect(await verifyBcrypt("hunter2-legacy", hash)).toBe(true);
    const ms = performance.now() - started;
    clearInterval(timer);
    // Measured ≈ 60–80 ms on an Apple M-series laptop (Node 24); generous bound for CI.
    expect(ms).toBeLessThan(2000);
    expect(ticks).toBeGreaterThan(0);
  });
});

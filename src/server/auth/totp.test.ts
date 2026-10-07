import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, hotp, totp, totpUri, verifyTotp } from "./totp";

// RFC 6238 appendix B, SHA1 seed: ASCII "12345678901234567890".
const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");
const RFC_SECRET_B32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("base32", () => {
  it("encodes per RFC 4648 (unpadded)", () => {
    const vectors: [string, string][] = [
      ["", ""],
      ["f", "MY"],
      ["fo", "MZXQ"],
      ["foo", "MZXW6"],
      ["foob", "MZXW6YQ"],
      ["fooba", "MZXW6YTB"],
      ["foobar", "MZXW6YTBOI"],
    ];
    for (const [plain, enc] of vectors) {
      expect(base32Encode(Buffer.from(plain))).toBe(enc);
      expect(base32Decode(enc).toString()).toBe(plain);
    }
    expect(base32Encode(RFC_SECRET)).toBe(RFC_SECRET_B32);
  });

  it("decodes case-insensitively, ignoring padding and whitespace", () => {
    expect(base32Decode("mzxw 6ytb oi======").toString()).toBe("foobar");
  });

  it("rejects invalid characters", () => {
    expect(() => base32Decode("MZXW1")).toThrow();
  });

  it("round-trips random secrets", () => {
    for (let i = 0; i < 50; i++) {
      const s = generateTotpSecret();
      expect(s).toMatch(/^[A-Z2-7]{32}$/);
      expect(base32Decode(s)).toHaveLength(20);
      expect(base32Encode(base32Decode(s))).toBe(s);
    }
  });
});

describe("hotp (RFC 4226 appendix D)", () => {
  const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  it.each(expected.map((code, i) => [i, code]))("counter %i → %s", (counter, code) => {
    expect(hotp(RFC_SECRET, counter as number)).toBe(code);
  });
});

describe("totp (RFC 6238 appendix B, SHA1, 8 digits)", () => {
  const vectors: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];
  it.each(vectors)("T=%i → %s", (t, code) => {
    expect(totp(RFC_SECRET_B32, t * 1000, 8)).toBe(code);
    expect(hotp(RFC_SECRET, Math.floor(t / 30), 8)).toBe(code);
  });

  it("defaults to 6 digits (last 6 of the 8-digit value)", () => {
    expect(totp(RFC_SECRET_B32, 59_000)).toBe("287082");
    expect(totp(RFC_SECRET_B32, 1111111109_000)).toBe("081804");
  });
});

describe("verifyTotp", () => {
  const at = 1234567890_000;
  const step = Math.floor(at / 30_000);

  it("accepts the current code and returns its step", () => {
    expect(verifyTotp(RFC_SECRET_B32, totp(RFC_SECRET_B32, at), at)).toBe(step);
  });

  it("accepts ±1 step of drift and rejects ±2", () => {
    expect(verifyTotp(RFC_SECRET_B32, totp(RFC_SECRET_B32, at - 30_000), at)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET_B32, totp(RFC_SECRET_B32, at + 30_000), at)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET_B32, totp(RFC_SECRET_B32, at - 60_000), at)).toBeNull();
    expect(verifyTotp(RFC_SECRET_B32, totp(RFC_SECRET_B32, at + 60_000), at)).toBeNull();
  });

  it("allows a window of 0", () => {
    expect(verifyTotp(RFC_SECRET_B32, totp(RFC_SECRET_B32, at - 30_000), at, 0)).toBeNull();
  });

  it("tolerates spaces in the code", () => {
    const code = totp(RFC_SECRET_B32, at);
    expect(verifyTotp(RFC_SECRET_B32, `${code.slice(0, 3)} ${code.slice(3)}`, at)).toBe(step);
  });

  it("rejects malformed codes", () => {
    for (const bad of ["", "12345", "1234567", "abcdef", "12345a", "89005924"]) {
      expect(verifyTotp(RFC_SECRET_B32, bad, at)).toBeNull();
    }
  });

  it("rejects a code for another secret", () => {
    // Fixed secret whose codes around `at` differ from the RFC secret's.
    const other = "JBSWY3DPEHPK3PXP";
    const ours = [-1, 0, 1].map((i) => totp(RFC_SECRET_B32, at + i * 30_000));
    expect(ours).not.toContain(totp(other, at));
    expect(verifyTotp(RFC_SECRET_B32, totp(other, at), at)).toBeNull();
  });
});

describe("totpUri", () => {
  it("builds an otpauth URI authenticator apps understand", () => {
    const uri = new URL(totpUri("JBSWY3DPEHPK3PXP", "jan@example.nl"));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.host).toBe("totp");
    expect(decodeURIComponent(uri.pathname)).toBe("/Quartermaster:jan@example.nl");
    expect(uri.searchParams.get("secret")).toBe("JBSWY3DPEHPK3PXP");
    expect(uri.searchParams.get("issuer")).toBe("Quartermaster");
    expect(uri.searchParams.get("algorithm")).toBe("SHA1");
    expect(uri.searchParams.get("digits")).toBe("6");
    expect(uri.searchParams.get("period")).toBe("30");
  });
});

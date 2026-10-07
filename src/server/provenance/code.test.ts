import { describe, expect, it } from "vitest";
import { CERTIFICATE_CODE_PATTERN, CROCKFORD_ALPHABET, encodeCrockford, generateCertificateCode, isCertificateCode, normalizeCertificateCode } from "./code";

describe("certificate codes", () => {
  it("generates QM-XXXX-XXXX in Crockford base32", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateCertificateCode();
      expect(code).toMatch(CERTIFICATE_CODE_PATTERN);
      expect(code.slice(3)).not.toMatch(/[ILOU]/);
      expect(isCertificateCode(code)).toBe(true);
    }
  });

  it("is random enough not to repeat in a small sample", () => {
    const codes = new Set(Array.from({ length: 2000 }, () => generateCertificateCode()));
    expect(codes.size).toBe(2000);
  });

  it("encodes deterministically from the random bytes", () => {
    expect(generateCertificateCode(() => new Uint8Array(5))).toBe("QM-0000-0000");
    expect(generateCertificateCode(() => new Uint8Array([255, 255, 255, 255, 255]))).toBe("QM-ZZZZ-ZZZZ");
    expect(encodeCrockford(new Uint8Array([0, 0, 0, 0, 31]), 8)).toBe("0000000Z");
    expect(CROCKFORD_ALPHABET).toHaveLength(32);
    expect(CROCKFORD_ALPHABET).not.toMatch(/[ILOU]/);
  });

  it("normalises user input", () => {
    expect(normalizeCertificateCode("QM-7K4P-2XQ9")).toBe("QM-7K4P-2XQ9");
    expect(normalizeCertificateCode(" qm 7k4p 2xq9 ")).toBe("QM-7K4P-2XQ9");
    expect(normalizeCertificateCode("7k4p2xq9")).toBe("QM-7K4P-2XQ9");
    expect(normalizeCertificateCode("QM-OIL0-0000")).toBe("QM-0110-0000");
    expect(normalizeCertificateCode("QM-7K4P-2XQU")).toBeNull(); // U is not in the alphabet
    expect(normalizeCertificateCode("QM-7K4P-2XQ")).toBeNull();
    expect(normalizeCertificateCode("QM-7K4P-2XQ9A")).toBeNull();
    expect(normalizeCertificateCode("<script>")).toBeNull();
    expect(normalizeCertificateCode("")).toBeNull();
    expect(normalizeCertificateCode(null)).toBeNull();
    expect(normalizeCertificateCode("x".repeat(100))).toBeNull();
  });
});

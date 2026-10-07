import { randomBytes } from "node:crypto";

/*
 * Certificate verification codes: "QM-" + 8 Crockford base32 symbols in two groups, e.g. QM-7K4P-2XQ9.
 *
 * - 40 random bits (≈1.1 × 10¹² codes): unguessable enough for a public lookup that is also rate
 *   limited, short enough to type from a printed certificate.
 * - Crockford's alphabet has no I, L, O or U, so a code read aloud / typed by hand is unambiguous;
 *   `normalizeCertificateCode` maps the look-alikes (O→0, I/L→1) and ignores case, spaces and dashes.
 * - Uniqueness is guaranteed by the database (Certificate.code @unique); the issuer retries on a
 *   collision (see certificates.ts).
 * No server-only import so it can be unit tested; node:crypto keeps it server-side.
 */

export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_PREFIX = "QM";
export const CODE_SYMBOLS = 8;

/** Canonical format: QM-XXXX-XXXX. */
export const CERTIFICATE_CODE_PATTERN = /^QM-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** Encodes the low `symbols × 5` bits of `bytes` (at most 6 bytes) as Crockford base32, big-endian. */
export function encodeCrockford(bytes: Uint8Array, symbols: number): string {
  if (bytes.length > 6) throw new RangeError("At most 6 bytes (48 bits stay exact in a double)");
  let value = 0;
  for (const b of bytes) value = value * 256 + b;
  let out = "";
  for (let i = 0; i < symbols; i++) {
    out = CROCKFORD_ALPHABET[value % 32] + out;
    value = Math.floor(value / 32);
  }
  return out;
}

/** A fresh random code, e.g. "QM-7K4P-2XQ9". */
export function generateCertificateCode(random: (size: number) => Uint8Array = (n) => randomBytes(n)): string {
  const symbols = encodeCrockford(random(5), CODE_SYMBOLS); // 5 bytes = 40 bits = 8 symbols
  return `${CODE_PREFIX}-${symbols.slice(0, 4)}-${symbols.slice(4)}`;
}

/**
 * Canonical form of user input ("qm 7k4p 2xq9", "7K4P2XQ9", "QM-7K4P-2XQ9"), or null when it cannot
 * be a certificate code. The "QM" prefix is optional on input.
 */
export function normalizeCertificateCode(input: string | null | undefined): string | null {
  if (typeof input !== "string" || input.length > 64) return null;
  let s = input.toUpperCase().replace(/[\s\-_.]/g, "");
  if (s.startsWith(CODE_PREFIX) && s.length === CODE_PREFIX.length + CODE_SYMBOLS) s = s.slice(CODE_PREFIX.length);
  if (s.length !== CODE_SYMBOLS) return null;
  s = s.replace(/O/g, "0").replace(/[IL]/g, "1");
  for (const ch of s) if (!CROCKFORD_ALPHABET.includes(ch)) return null;
  return `${CODE_PREFIX}-${s.slice(0, 4)}-${s.slice(4)}`;
}

export function isCertificateCode(value: string): boolean {
  return CERTIFICATE_CODE_PATTERN.test(value);
}
